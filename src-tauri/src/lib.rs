use serde::{Deserialize, Serialize};
use std::net::ToSocketAddrs;
use std::process::Command;
use tauri_plugin_shell::ShellExt;

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

/// 下载图片（使用 curl 命令）
#[tauri::command]
async fn download_image(url: String) -> Result<DownloadResult, String> {
    println!("[Rust] 开始下载图片: {}", url);
    
    // 生成唯一临时文件名，避免并发冲突
    let temp_file = format!("/tmp/downloaded_image_{}.tmp", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());
    
    // 使用 curl 下载，curl 能正确处理重定向和特殊 URL
    // 添加 -v 来查看详细的下载过程，包括重定向
    let output = Command::new("curl")
        .args(&[
            "-L",                      // 跟随重定向
            "-s",                      // 静默模式
            "-o", &temp_file,          // 输出到临时文件
            &url
        ])
        .output();
    
    match output {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let error_msg = format!("curl 下载失败: {} - stderr: {}", output.status, stderr);
                println!("[Rust] {}", error_msg);
                // 清理临时文件
                let _ = std::fs::remove_file(&temp_file);
                return Ok(DownloadResult {
                    success: false,
                    data: None,
                    content_type: None,
                    error: Some(error_msg),
                });
            }
            
            // 读取临时文件
            let bytes = match std::fs::read(&temp_file) {
                Ok(b) => b,
                Err(e) => {
                    let error_msg = format!("读取临时文件失败: {}", e);
                    println!("[Rust] {}", error_msg);
                    let _ = std::fs::remove_file(&temp_file);
                    return Ok(DownloadResult {
                        success: false,
                        data: None,
                        content_type: None,
                        error: Some(error_msg),
                    });
                }
            };
            
            // 获取 content-type（curl 输出了到 stderr）
            let content_type = Some("image/png".to_string()); // 默认 png
            
            println!("[Rust] 下载成功，数据大小: {} bytes", bytes.len());
            
            // 清理临时文件
            let _ = std::fs::remove_file(&temp_file);
            
            Ok(DownloadResult {
                success: true,
                data: Some(bytes),
                content_type,
                error: None,
            })
        }
        Err(e) => {
            let error_msg = format!("执行 curl 失败: {}", e);
            println!("[Rust] {}", error_msg);
            Ok(DownloadResult {
                success: false,
                data: None,
                content_type: None,
                error: Some(error_msg),
            })
        }
    }
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
    .invoke_handler(tauri::generate_handler![resolve_domain, download_image, open_local_file, check_ffmpeg, merge_videos])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
