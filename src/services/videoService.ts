import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

interface MergeResult {
  success: boolean;
  output_path?: string;
  error?: string;
}

// 检查 FFmpeg 是否可用
export async function checkFFmpeg(): Promise<boolean> {
  try {
    return await invoke<boolean>('check_ffmpeg');
  } catch {
    return false;
  }
}

// 合并视频
export async function mergeVideos(videoUrls: string[]): Promise<MergeResult> {
  try {
    // 让用户选择保存位置
    const outputPath = await save({
      defaultPath: 'merged_video.mp4',
      filters: [{
        name: 'Video',
        extensions: ['mp4']
      }]
    });

    if (!outputPath) {
      return {
        success: false,
        error: '用户取消保存'
      };
    }

    const result = await invoke<MergeResult>('merge_videos', {
      videoUrls,
      outputPath
    });

    return result;
  } catch (error) {
    return {
      success: false,
      error: String(error)
    };
  }
}
