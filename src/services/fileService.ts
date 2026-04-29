import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile, mkdir, copyFile, exists, readDir } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { fetch } from '@tauri-apps/plugin-http';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';

// 页面调试框日志回调（由页面组件设置）
let pageLogCallback: ((log: string) => void) | null = null;

export function setPageLogCallback(cb: ((log: string) => void) | null) {
  pageLogCallback = cb;
}

// 记录日志到页面调试框
function pageLog(log: string) {
  pageLogCallback?.(log);
}

// 确保图片目录存在
async function ensureImagesDir(): Promise<string> {
  const appData = await appDataDir();
  const imagesDir = await join(appData, 'images');
  
  const dirExists = await exists(imagesDir);
  if (!dirExists) {
    await mkdir(imagesDir, { recursive: true });
  }
  
  return imagesDir;
}

// 选择并上传图片，返回本地路径
export async function uploadImage(subfolder?: string): Promise<string | null> {
  try {
    const selected = await open({
      multiple: false,
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
      ]
    });
    
    if (!selected || typeof selected !== 'string') return null;
    
    const imagesDir = await ensureImagesDir();
    const targetDir = subfolder 
      ? await join(imagesDir, subfolder)
      : imagesDir;
    
    const subfDirExists = subfolder ? await exists(targetDir) : true;
    if (subfolder && !subfDirExists) {
      await mkdir(targetDir, { recursive: true });
    }
    
    // 获取文件名
    const fileName = selected.split('/').pop() || `image_${Date.now()}.png`;
    const uniqueName = `${Date.now()}_${fileName}`;
    const destPath = await join(targetDir, uniqueName);
    
    // 复制文件到应用数据目录
    await copyFile(selected, destPath);
    
    return destPath;
  } catch (error) {
    console.error('Failed to upload image:', error);
    return null;
  }
}

// 选择并上传多张图片，返回本地路径数组
export async function uploadMultipleImages(maxCount: number = 3, subfolder?: string): Promise<string[]> {
  try {
    const selected = await open({
      multiple: true,
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
      ]
    });
    
    if (!selected) return [];
    
    // 确保是数组
    const files = Array.isArray(selected) ? selected : [selected];
    // 限制数量
    const limitedFiles = files.slice(0, maxCount);
    
    const imagesDir = await ensureImagesDir();
    const targetDir = subfolder 
      ? await join(imagesDir, subfolder)
      : imagesDir;
    
    const subfDirExists = subfolder ? await exists(targetDir) : true;
    if (subfolder && !subfDirExists) {
      await mkdir(targetDir, { recursive: true });
    }
    
    const paths: string[] = [];
    for (const file of limitedFiles) {
      if (typeof file === 'string') {
        const fileName = file.split('/').pop() || `image_${Date.now()}.png`;
        const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${fileName}`;
        const destPath = await join(targetDir, uniqueName);
        await copyFile(file, destPath);
        paths.push(destPath);
      }
    }
    
    return paths;
  } catch (error) {
    console.error('Failed to upload multiple images:', error);
    return [];
  }
}

// 将 base64 图片数据保存到本地
export async function saveBase64Image(base64Data: string, subfolder?: string): Promise<string | null> {
  try {
    const imagesDir = await ensureImagesDir();
    const targetDir = subfolder 
      ? await join(imagesDir, subfolder)
      : imagesDir;
    
    if (subfolder) {
      const subfDirExists = await exists(targetDir);
      if (!subfDirExists) {
        await mkdir(targetDir, { recursive: true });
      }
    }
    
    const fileName = `${Date.now()}.png`;
    const destPath = await join(targetDir, fileName);
    
    // 解码 base64 并写入文件
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const binaryStr = atob(base64Clean);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
    await writeFile(destPath, bytes);
    return destPath;
  } catch (error) {
    console.error('Failed to save base64 image:', error);
    return null;
  }
}

// 将 URL 图片保存到本地（通过 Rust 端下载）
// 按日期分文件夹存储，格式：images/YYYY-MM-DD/xxx.png
export async function saveUrlImage(url: string, subfolder?: string): Promise<string | null> {
  try {
    console.log('saveUrlImage: 开始处理图片:', url.substring(0, 100) + '...');
    
    let bytes: Uint8Array;
    let contentType = '';
    
    // 处理 Base64 格式的图片
    if (url.startsWith('data:')) {
      console.log('saveUrlImage: 检测到 Base64 格式图片');
      const base64Data = url.split(',')[1];
      if (!base64Data) {
        throw new Error('Base64 数据格式错误');
      }
      // 从 data:image/png;base64,xxx 中提取 content type
      const mimeMatch = url.match(/data:([^;]+);/);
      if (mimeMatch) {
        contentType = mimeMatch[1];
      }
      // 使用 atob 解码 Base64
      const binaryString = atob(base64Data);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      console.log('saveUrlImage: Base64 解码成功，大小:', bytes.length, 'bytes (', (bytes.length / 1024).toFixed(2), 'KB )');
    } else {
      // 使用 Rust 端下载图片
      const result = await invoke<{
        success: boolean;
        data?: number[];
        content_type?: string;
        error?: string;
      }>('download_image', { url });
      
      console.log('saveUrlImage: 下载结果:', result.success, result.error);
      
      if (!result.success) {
        throw new Error(result.error || '下载失败');
      }
      
      if (!result.data || result.data.length === 0) {
        throw new Error('下载的数据为空');
      }
      
      bytes = new Uint8Array(result.data);
      contentType = result.content_type || '';
    }
    
    console.log('saveUrlImage: 数据大小:', bytes.length, 'bytes (', (bytes.length / 1024).toFixed(2), 'KB )');
    
    // 尝试解析图片尺寸
    if (bytes.length > 24) {
      // PNG
      if (bytes[0] === 0x89 && bytes[1] === 0x50) {
        const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
        console.log('saveUrlImage: PNG 图片尺寸:', width, 'x', height);
      }
      // JPEG
      else if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        console.log('saveUrlImage: JPEG 格式');
      }
    }
    
    const imagesDir = await ensureImagesDir();
    console.log('saveUrlImage: 图片目录:', imagesDir);
    
    // 生成日期文件夹名称，格式：YYYY-MM-DD
    const now = new Date();
    const dateFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // 构建目标目录：images/YYYY-MM-DD/ 或 images/YYYY-MM-DD/subfolder/
    let targetDir = await join(imagesDir, dateFolder);
    if (subfolder) {
      targetDir = await join(targetDir, subfolder);
    }
    
    // 确保目录存在
    const dirExists = await exists(targetDir);
    if (!dirExists) {
      console.log('saveUrlImage: 创建日期目录:', targetDir);
      await mkdir(targetDir, { recursive: true });
    }
    
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
      : contentType.includes('webp') ? 'webp'
      : contentType.includes('gif') ? 'gif'
      : 'png';
    const fileName = `${Date.now()}.${ext}`;
    const destPath = await join(targetDir, fileName);
    console.log('saveUrlImage: 保存路径:', destPath);
    
    await writeFile(destPath, bytes);
    console.log('saveUrlImage: 文件写入成功，大小:', bytes.length);
    return destPath;
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    console.error('saveUrlImage: 保存失败:', error);
    pageLog(`[文件服务] 图片下载失败: ${errMsg}，使用远程URL作为fallback`);
    // 下载失败时返回远程 URL 作为 fallback
    return url;
  }
}

// 读取本地文件为 Data URL
export async function readImageAsDataUrl(filePath: string): Promise<string | null> {
  try {
    const fileExists = await exists(filePath);
    if (!fileExists) return null;
    
    const bytes = await readFile(filePath);
    const base64 = btoa(String.fromCharCode(...bytes));
    
    // 根据文件扩展名判断 MIME 类型
    const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
    const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' 
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/png';
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Failed to read image:', error);
    return null;
  }
}

// 选择视频导出路径并导出
export async function exportVideo(videoData: Uint8Array, defaultName?: string): Promise<string | null> {
  try {
    const savePath = await save({
      defaultPath: defaultName || 'video_export.mp4',
      filters: [
        { name: 'Videos', extensions: ['mp4', 'mov', 'avi'] }
      ]
    });
    
    if (!savePath) return null;
    
    await writeFile(savePath, videoData);
    return savePath;
  } catch (error) {
    console.error('Failed to export video:', error);
    return null;
  }
}

// 根据文件魔数检测图片格式并返回扩展名
function detectImageExtension(bytes: Uint8Array): string {
  if (bytes.length >= 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpg';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'webp';
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
  }
  return 'png';
}

// 导出图片文件到用户选择的位置
export async function exportImageFile(sourcePath: string, defaultName?: string): Promise<string | null> {
  try {
    // 先读取源文件，检测真实图片格式
    let fileData: Uint8Array;
    try {
      fileData = await readFile(sourcePath);
    } catch {
      console.error('exportImageFile: 无法读取源文件（可能是远程URL）:', sourcePath);
      return null;
    }

    // 根据魔数检测真实格式，自动确定扩展名
    const ext = detectImageExtension(fileData);

    const savePath = await save({
      defaultPath: defaultName || `image_export.${ext}`,
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]
    });

    if (!savePath) return null;

    await writeFile(savePath, fileData);
    return savePath;
  } catch (error) {
    console.error('Failed to export image:', error);
    return null;
  }
}

// 将文件路径转为可在 img src 中显示的格式
export function localPathToSrc(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  // Tauri v2 使用 convertFileSrc 生成正确的 asset URL
  return convertFileSrc(filePath);
}

// 将本地图片文件转换为 Base64 编码（用于火山方舟API图生图）
// 通过 Canvas 压缩图片，使其 base64 大小不超过 maxBytes（默认 8MB）
async function compressImageToBase64(dataUrl: string, maxBytes = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      
      // 最大边长限制（2048px），按比例缩小
      const MAX_SIDE = 2048;
      if (width > MAX_SIDE || height > MAX_SIDE) {
        const ratio = Math.min(MAX_SIDE / width, MAX_SIDE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      
      // 逐步降低质量直到满足大小限制
      let quality = 0.92;
      let result = canvas.toDataURL('image/jpeg', quality);
      
      // base64 大小估算：base64长度 * 0.75 ≈ 原始字节数
      while (result.length * 0.75 > maxBytes && quality > 0.1) {
        quality -= 0.1;
        result = canvas.toDataURL('image/jpeg', quality);
      }
      
      resolve(result);
    };
    img.onerror = () => resolve(dataUrl); // 失败时返回原始数据
    img.src = dataUrl;
  });
}

export async function localImageToBase64(filePath: string): Promise<string | null> {
  try {
    // 读取文件内容
    const bytes = await readFile(filePath);
    
    // 根据文件扩展名确定图片格式
    const ext = filePath.toLowerCase().split('.').pop() || 'png';
    let mimeType = 'image/png';
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        mimeType = 'image/jpeg';
        break;
      case 'png':
        mimeType = 'image/png';
        break;
      case 'webp':
        mimeType = 'image/webp';
        break;
      case 'gif':
        mimeType = 'image/gif';
        break;
      case 'bmp':
        mimeType = 'image/bmp';
        break;
      case 'tiff':
        mimeType = 'image/tiff';
        break;
    }
    
    // 将字节数组转换为Base64
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    // 若图片超过 8MB，使用 Canvas 压缩后再返回
    const MAX_BYTES = 8 * 1024 * 1024;
    if (bytes.byteLength > MAX_BYTES) {
      console.log(`[localImageToBase64] 图片过大 (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)，压缩中...`);
      const compressed = await compressImageToBase64(dataUrl, MAX_BYTES);
      console.log(`[localImageToBase64] 压缩后大小: ${(compressed.length * 0.75 / 1024 / 1024).toFixed(1)} MB`);
      return compressed;
    }
    
    // 返回 data:image/<格式>;base64,<base64编码> 格式
    return dataUrl;
  } catch (error) {
    console.error('Failed to convert local image to base64:', error);
    return null;
  }
}

// 检查是否为本地文件路径
export function isLocalFilePath(path: string | undefined | null): boolean {
  if (!path) return false;
  // 本地路径通常以 / 或盘符开头（Windows），且不以 http 开头
  return !path.startsWith('http://') && !path.startsWith('https://') && (
    path.startsWith('/') || 
    path.startsWith('file://') ||
    /^[A-Za-z]:/.test(path) // Windows 盘符路径
  );
}

// ========== 视频相关 ==========

// 下载视频文件到本地（通过 Rust 端下载）
export async function downloadVideo(videoUrl: string, subfolder?: string): Promise<string | null> {
  try {
    console.log('downloadVideo: 开始下载视频:', videoUrl);
    
    // 使用 Rust 端下载
    const result = await invoke<{
      success: boolean;
      data?: number[];
      content_type?: string;
      error?: string;
    }>('download_image', { url: videoUrl });
    
    console.log('downloadVideo: 下载结果:', result.success, result.error);
    
    if (!result.success) {
      throw new Error(result.error || '下载失败');
    }
    
    if (!result.data || result.data.length === 0) {
      throw new Error('下载的数据为空');
    }
    
    const bytes = new Uint8Array(result.data);
    console.log('downloadVideo: 数据大小:', bytes.length);
    
    // 确保目录存在
    const appData = await appDataDir();
    const videosDir = await join(appData, 'videos');
    
    const dirExists = await exists(videosDir);
    if (!dirExists) {
      console.log('downloadVideo: 创建视频目录:', videosDir);
      await mkdir(videosDir, { recursive: true });
    }
    
    const targetDir = subfolder 
      ? await join(videosDir, subfolder)
      : videosDir;
    
    const targetDirExists = await exists(targetDir);
    if (!targetDirExists) {
      console.log('downloadVideo: 创建子目录:', targetDir);
      await mkdir(targetDir, { recursive: true });
    }
    
    // 生成文件名
    const fileName = `${Date.now()}.mp4`;
    const destPath = await join(targetDir, fileName);
    console.log('downloadVideo: 保存路径:', destPath);
    
    await writeFile(destPath, bytes);
    console.log('downloadVideo: 文件写入成功，大小:', bytes.length);
    return destPath;
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    console.error('downloadVideo: 下载视频失败:', error);
    pageLog(`[文件服务] 视频下载失败: ${errMsg}，使用远程URL作为fallback`);
    // 下载失败时返回远程 URL 作为 fallback
    return videoUrl;
  }
}

// 将本地视频路径转为可播放的 URL
export function localVideoPathToSrc(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  return convertFileSrc(filePath);
}

// 获取图片尺寸（返回宽x高）
export async function getImageDimensions(filePath: string): Promise<{ width: number; height: number; pixels: number } | null> {
  try {
    // 读取文件内容
    const bytes = await readFile(filePath);
    
    // 从图片数据中解析尺寸
    // 支持 PNG, JPEG, WebP, GIF
    let width = 0;
    let height = 0;
    
    const arr = new Uint8Array(bytes);
    
    // PNG: 前8字节是签名，IHDR块在8-24字节
    if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47) {
      // PNG 格式
      width = (arr[16] << 24) | (arr[17] << 16) | (arr[18] << 8) | arr[19];
      height = (arr[20] << 24) | (arr[21] << 16) | (arr[22] << 8) | arr[23];
    }
    // JPEG: 查找 SOF 标记
    else if (arr[0] === 0xFF && arr[1] === 0xD8) {
      // JPEG 格式 - 需要查找 SOF0 或 SOF2 标记
      let i = 2;
      while (i < arr.length - 4) {
        if (arr[i] === 0xFF) {
          const marker = arr[i + 1];
          // SOF0, SOF1, SOF2 等标记
          if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3) {
            height = (arr[i + 5] << 8) | arr[i + 6];
            width = (arr[i + 7] << 8) | arr[i + 8];
            break;
          }
          // 跳过当前段
          if (marker !== 0xD8 && marker !== 0xD9) {
            const len = (arr[i + 2] << 8) | arr[i + 3];
            i += 2 + len;
          } else {
            i += 2;
          }
        } else {
          i++;
        }
      }
    }
    // WebP
    else if (arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46) {
      // WebP 格式
      const webp = arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50;
      if (webp) {
        // VP8 格式
        if (arr[12] === 0x56 && arr[13] === 0x50 && arr[14] === 0x38 && arr[15] === 0x20) {
          // 简单解析 VP8
          const signature = arr[23];
          if (signature === 0x9D || signature === 0x01 || signature === 0x2A) {
            width = ((arr[26] | (arr[27] << 8)) & 0x3FFF);
            height = ((arr[28] | (arr[29] << 8)) & 0x3FFF);
          }
        }
      }
    }
    
    if (width > 0 && height > 0) {
      return {
        width,
        height,
        pixels: width * height
      };
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get image dimensions:', error);
    return null;
  }
}

// 检查图片是否满足最小像素要求（火山方舟要求 3686400 像素）
export function checkImageMeetsMinPixels(pixels: number): { valid: boolean; minPixels: number; diff: number } {
  const MIN_PIXELS = 3686400;
  return {
    valid: pixels >= MIN_PIXELS,
    minPixels: MIN_PIXELS,
    diff: MIN_PIXELS - pixels
  };
}

// 扫描本地视频目录，返回所有视频文件路径
export async function scanLocalVideos(): Promise<string[]> {
  try {
    const appData = await appDataDir();
    const videosDir = await join(appData, 'videos');
    
    const dirExists = await exists(videosDir);
    if (!dirExists) {
      return [];
    }
    
    const videoFiles: string[] = [];
    
    // 递归扫描目录
    const scanDir = async (dir: string) => {
      try {
        const entries = await readDir(dir);
        for (const entry of entries) {
          const entryPath = await join(dir, entry.name);
          if (entry.isDirectory) {
            // 是目录，递归扫描
            await scanDir(entryPath);
          } else if (entry.name.endsWith('.mp4') || entry.name.endsWith('.mov') || entry.name.endsWith('.webm')) {
            // 是视频文件
            videoFiles.push(entryPath);
          }
        }
      } catch (e) {
        console.error('扫描目录失败:', dir, e);
      }
    };
    
    await scanDir(videosDir);
    return videoFiles;
  } catch (error) {
    console.error('扫描本地视频失败:', error);
    return [];
  }
}
