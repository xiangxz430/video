/**
 * 阿里云通义万相 (Qwen Wanx) 图片生成服务
 *
 * API 端点: POST /api/v1/services/aigc/text2image/image-synthesis (提交)
 *           GET  /api/v1/tasks/{taskId} (查询)
 * 认证方式: Bearer Token (DashScope API Key)
 * 任务模式: 异步 (提交任务 → 轮询状态 → 获取结果)
 *
 * 参考图片: 不支持
 *
 * 响应取值: result.output.results[0].url
 *
 * 注意: 当前 generateImage() 统一入口中未接入此提供商，
 *       函数保留供未来使用
 */
import type { ApiConfig } from '../../types/index.js';
export declare function submitWanxTask(config: ApiConfig, prompt: string): Promise<string>;
export declare function waitForWanxTask(config: ApiConfig, taskId: string, maxRetries?: number): Promise<string>;
