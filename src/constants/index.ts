/**
 * 全局常量配置
 */

// 分镜相关
export const DEFAULT_SHOT_DURATION = 5;  // 默认镜头时长（秒）

// 视频轮询相关
export const VIDEO_POLL_INTERVAL_MS = 5000;  // 轮询间隔（5秒）
export const VIDEO_MAX_POLL_RETRIES = 120;   // 最大轮询次数（10分钟）
export const VIDEO_MAX_WAIT_MS = VIDEO_POLL_INTERVAL_MS * VIDEO_MAX_POLL_RETRIES;  // 最大等待时间

// AI 调用相关
export const AI_TIMEOUT_MS = 120000;  // AI 调用超时（2分钟）
export const AI_MAX_RETRIES = 3;      // 最大重试次数

// 分镜生成相关
export const STORYBOARD_MIN_DESCRIPTION_LENGTH = 50;  // 最小描述长度
export const STORYBOARD_MIN_ACTION_LENGTH = 30;       // 最小动作长度
export const STORYBOARD_SHOT_DURATION_MIN = 5;        // 镜头最短时长
export const STORYBOARD_SHOT_DURATION_MAX = 10;       // 镜头最长时长

// 文件相关
export const DEFAULT_MERGED_VIDEO_NAME = 'merged_video.mp4';

// UI 相关
export const MAX_VISIBLE_LOGS = 100;  // 最大显示日志条数
