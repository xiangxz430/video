use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::Duration;
use tauri_plugin_shell::ShellExt;
use tauri::Emitter;
use futures_util::StreamExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadResult {
    pub success: bool,
    pub data: Option<Vec<u8>>,
    pub content_type: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MergeResult {
    pub success: bool,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

/// 下载图片（使用 reqwest HTTP 库，避免 curl 命令行参数过长触发 ARG_MAX 限制）
#[tauri::command]
async fn download_image(url: String) -> Result<DownloadResult, String> {
    println!("[Rust] 开始下载图片: {}", url);

    // 使用 reqwest 下载，绕过系统代理，避免 curl ARG_MAX 限制
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("下载图片失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error_msg = format!("下载图片失败，HTTP状态码: {}", status);
        println!("[Rust] {}", error_msg);
        return Ok(DownloadResult {
            success: false,
            data: None,
            content_type: None,
            error: Some(error_msg),
        });
    }

    let bytes = response.bytes()
        .await
        .map_err(|e| format!("读取图片数据失败: {}", e))?;

    let bytes = bytes.to_vec();

    // 根据文件魔数检测真实图片格式
    let content_type = if bytes.len() >= 12 {
        if bytes[0] == 0x89 && bytes[1] == 0x50 { Some("image/png".to_string()) }
        else if bytes[0] == 0xFF && bytes[1] == 0xD8 { Some("image/jpeg".to_string()) }
        else if bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[8] == 0x57 && bytes[9] == 0x45 { Some("image/webp".to_string()) }
        else if bytes[0] == 0x47 && bytes[1] == 0x49 { Some("image/gif".to_string()) }
        else { Some("image/png".to_string()) }
    } else {
        Some("image/png".to_string())
    };

    println!("[Rust] 下载成功，数据大小: {} bytes, 格式: {:?}", bytes.len(), content_type);

    Ok(DownloadResult {
        success: true,
        data: Some(bytes),
        content_type,
        error: None,
    })
}

/// 解析域名获取 IP 地址
#[tauri::command]
fn resolve_domain(domain: String) -> Result<String, String> {
    // 添加默认端口用于解析
    let addr = format!("{}:443", domain);
    
    match addr.to_socket_addrs() {
        Ok(addrs) => {
            // 获取第一个 IP 地址
            for addr in addrs {
                return Ok(addr.ip().to_string());
            }
            Err("无法解析域名: 没有找到 IP 地址".to_string())
        }
        Err(e) => Err(format!("解析域名失败: {}", e)),
    }
}

/// 用系统默认程序打开本地文件
#[tauri::command]
async fn open_local_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    println!("[Rust] 打开本地文件: {}", path);
    
    let shell = app.shell();
    shell.open(path, None)
        .map_err(|e| format!("打开文件失败: {}", e))?;
    
    Ok(())
}

/// 检查 FFmpeg 是否可用
#[tauri::command]
fn check_ffmpeg() -> Result<bool, String> {
    let output = Command::new("ffmpeg")
        .arg("-version")
        .output();
    
    match output {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

/// 合并视频
#[tauri::command]
async fn merge_videos(video_urls: Vec<String>, output_path: String) -> Result<MergeResult, String> {
    println!("[Rust] 开始合并视频，输出: {}", output_path);
    
    if video_urls.is_empty() {
        return Ok(MergeResult {
            success: false,
            output_path: None,
            error: Some("视频列表为空".to_string()),
        });
    }
    
    // 如果只有一个视频，直接复制
    if video_urls.len() == 1 {
        let result = Command::new("cp")
            .args(&[&video_urls[0], &output_path])
            .output();
        
        match result {
            Ok(output) => {
                if output.status.success() {
                    return Ok(MergeResult {
                        success: true,
                        output_path: Some(output_path),
                        error: None,
                    });
                } else {
                    return Ok(MergeResult {
                        success: false,
                        output_path: None,
                        error: Some(format!("复制失败: {}", String::from_utf8_lossy(&output.stderr))),
                    });
                }
            }
            Err(e) => {
                return Ok(MergeResult {
                    success: false,
                    output_path: None,
                    error: Some(format!("执行 cp 失败: {}", e)),
                });
            }
        }
    }
    
    // 创建临时文件列表
    let list_file = "/tmp/video_list.txt";
    let mut list_content = String::new();
    for url in &video_urls {
        list_content.push_str(&format!("file '{}'\n", url));
    }
    
    // 写入文件列表
    if let Err(e) = std::fs::write(list_file, &list_content) {
        return Ok(MergeResult {
            success: false,
            output_path: None,
            error: Some(format!("写入文件列表失败: {}", e)),
        });
    }
    
    // 使用 ffmpeg 合并
    let output = Command::new("ffmpeg")
        .args(&[
            "-f", "concat",
            "-safe", "0",
            "-i", list_file,
            "-c", "copy",
            "-y",
            &output_path
        ])
        .output();
    
    // 清理临时文件
    let _ = std::fs::remove_file(list_file);
    
    match output {
        Ok(output) => {
            if output.status.success() {
                println!("[Rust] 视频合并成功");
                Ok(MergeResult {
                    success: true,
                    output_path: Some(output_path),
                    error: None,
                })
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("[Rust] 视频合并失败: {}", stderr);
                Ok(MergeResult {
                    success: false,
                    output_path: None,
                    error: Some(format!("ffmpeg 合并失败: {}", stderr)),
                })
            }
        }
        Err(e) => {
            println!("[Rust] 执行 ffmpeg 失败: {}", e);
            Ok(MergeResult {
                success: false,
                output_path: None,
                error: Some(format!("执行 ffmpeg 失败: {}", e)),
            })
        }
    }
}

/// 使用 reqwest 的 no_proxy 客户端发送通用 HTTP 请求（彻底绕过系统代理）
#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
async fn http_request(url: String, method: String, headers: HashMap<String, String>, body: Option<String>) -> Result<HttpResponse, String> {
    println!("[Rust] http_request: {} {}", method, url);

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let mut req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };

    for (key, value) in &headers {
        req = req.header(key.as_str(), value.as_str());
    }

    if let Some(body) = body {
        req = req.body(body);
    }

    let response = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
    let status = response.status().as_u16();
    let resp_body = response.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    println!("[Rust] http_request 完成: status={}", status);
    Ok(HttpResponse { status, body: resp_body })
}

/// 使用 reqwest 的 no_proxy 客户端发送 SSE 流式请求（彻底绕过系统代理）
#[tauri::command]
async fn http_sse_request(
    app: tauri::AppHandle,
    request_id: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
) -> Result<(), String> {
    println!("[Rust] http_sse_request: {}", url);

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let mut req = client.post(&url);
    for (key, value) in &headers {
        req = req.header(key.as_str(), value.as_str());
    }
    req = req.body(body);

    let response = req.send().await.map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        let _ = app.emit(&format!("sse-error-{}", request_id), &text);
        return Err(format!("服务端错误 {}: {}", status, text));
    }

    // 流式读取响应
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                let _ = app.emit(&format!("sse-chunk-{}", request_id), text.to_string());
            }
            Err(e) => {
                let _ = app.emit(&format!("sse-error-{}", request_id), e.to_string());
                return Err(format!("读取流失败: {}", e));
            }
        }
    }

    let _ = app.emit(&format!("sse-done-{}", request_id), "");
    println!("[Rust] http_sse_request 完成");
    Ok(())
}

/// 使用纯标准库 TCP 连接检查服务端健康状态（绕过 reqwest 的代理干扰）
#[tauri::command]
async fn check_server_health(url: String) -> Result<serde_json::Value, String> {
    println!("[Rust] check_server_health: {}", url);

    // 解析 URL，提取 host 和 port
    let stripped = url.strip_prefix("http://").unwrap_or(&url);
    let (host, port, path) = if let Some(idx) = stripped.find('/') {
        let host_port = &stripped[..idx];
        let path = &stripped[idx..];
        if let Some(colon) = host_port.rfind(':') {
            (&host_port[..colon], host_port[colon + 1..].parse::<u16>().unwrap_or(80), path.to_string())
        } else {
            (host_port, 80u16, path.to_string())
        }
    } else {
        if let Some(colon) = stripped.rfind(':') {
            (&stripped[..colon], stripped[colon + 1..].parse::<u16>().unwrap_or(80), "/".to_string())
        } else {
            (stripped, 80u16, "/".to_string())
        }
    };

    println!("[Rust] TCP 连接: {}:{}", host, port);

    // 解析地址
    let addr_str = format!("{}:{}", host, port);
    let addrs: Vec<SocketAddr> = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("DNS 解析失败: {}", e))?
        .collect();

    let addr = addrs.first().ok_or("无可用地址")?;
    println!("[Rust] 解析地址: {}", addr);

    // 建立原始 TCP 连接（绕过 reqwest 代理层）
    let mut stream = TcpStream::connect_timeout(addr, Duration::from_secs(10))
        .map_err(|e| format!("TCP 连接 {} 失败: {}", addr, e))?;

    // 设置读写超时
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| format!("设置读超时: {}", e))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| format!("设置写超时: {}", e))?;

    // 发送 HTTP GET 请求
    let http_req = format!(
        "GET {} HTTP/1.0\r\nHost: {}\r\nConnection: close\r\n\r\n",
        path, host
    );
    stream
        .write_all(http_req.as_bytes())
        .map_err(|e| format!("发送请求失败: {}", e))?;
    println!("[Rust] HTTP 请求已发送");

    // 读取响应
    let mut reader = BufReader::new(&mut stream);
    let mut status_line = String::new();
    reader
        .read_line(&mut status_line)
        .map_err(|e| format!("读取响应失败: {}", e))?;
    println!("[Rust] 状态行: {}", status_line.trim());

    // 解析状态码
    let parts: Vec<&str> = status_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(serde_json::json!({"ok": false, "error": "无效的 HTTP 响应"}));
    }
    let status_code: u16 = parts[1]
        .parse()
        .map_err(|_| "无法解析状态码".to_string())?;

    // 跳过头部
    loop {
        let mut header_line = String::new();
        reader
            .read_line(&mut header_line)
            .map_err(|e| format!("读取头部失败: {}", e))?;
        if header_line.trim().is_empty() {
            break;
        }
    }

    // 读取 body
    let mut body = String::new();
    reader
        .read_line(&mut body)
        .map_err(|e| format!("读取响应体失败: {}", e))?;

    if status_code == 200 {
        println!("[Rust] 健康检查成功: {}", body.trim());
        Ok(serde_json::json!({"ok": true, "data": {"status": "ok"}}))
    } else {
        Ok(serde_json::json!({
            "ok": false,
            "error": format!("服务端返回状态码: {}", status_code)
        }))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![resolve_domain, download_image, open_local_file, check_ffmpeg, merge_videos, check_server_health, http_request, http_sse_request])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
