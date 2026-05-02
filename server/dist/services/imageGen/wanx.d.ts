/**
 * 阿里云 Wan2.7-Image 图片生成服务
 *
 * API 端点: POST {baseUrl}/services/aigc/multimodal-generation/generation (同步)
 * 认证方式: Bearer Token (DashScope API Key)
 * 任务模式: 同步返回（无需异步提交+轮询）
 *
 * 参考图片格式 (messages content 数组):
 *   {"image": "参考图URL"}  — 每张参考图一个对象
 *
 * 宽高比映射 (parameters.size，格式 "WIDTH*HEIGHT"):
 *   1:1 → 1024*1024, 16:9 → 1280*720, 9:16 → 720*1280
 *   4:3 → 1024*768, 3:4 → 768*1024
 *
 * 响应取值:
 *   data.output.results[0].url 或
 *   data.output.choices[0].message.content[0].image
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
/**
 * 同步调用 Wan2.7-Image 生成图片
 *
 * 使用 multimodal-generation 同步端点，直接返回图片 URL。
 * 无需异步提交+轮询，但响应可能耗时 30-120 秒。
 */
export declare function generateWanxImage(config: ApiConfig, params: ImageGenParams): Promise<string>;
/**
 * @deprecated 已废弃。Wan2.7-Image 使用同步 API，无需异步提交+轮询。
 * 保留导出以兼容旧引用，调用会直接抛错提示迁移。
 */
export declare function submitWanxTask(_config: ApiConfig, _prompt: string): Promise<string>;
/**
 * @deprecated 已废弃。Wan2.7-Image 使用同步 API，无需异步提交+轮询。
 * 保留导出以兼容旧引用，调用会直接抛错提示迁移。
 */
export declare function waitForWanxTask(_config: ApiConfig, _taskId: string): Promise<string>;
