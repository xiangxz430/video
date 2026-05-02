/**
 * TokenPlan (百炼包月) 图片生成服务
 *
 * TokenPlan 是百炼的包月代理服务，通过 OpenAI-compatible API 提供
 * 图片生成能力。其 compatible-mode 端点将请求转发到百炼 DashScope
 * 后端，因此 API 格式与火山方舟等 OpenAI-compatible provider 一致。
 *
 * API 端点: POST {baseUrl}/images/generations
 * 认证方式: Bearer Token (TokenPlan API Key, sk-sp- 前缀)
 * 任务模式: 同步返回
 *
 * 参考图片格式 (顶级 images 数组):
 *   requestBody.images = ["https://...", "data:image/jpeg;base64,..."]
 *   支持 http/https URL 和 base64 data URL
 *
 * 宽高比映射 (与 volcEngine 一致):
 *   16:9 → 2560x1440, 9:16 → 1440x2560, 1:1 → 1920x1920
 *   4:3 → 2400x1800, 3:4 → 1800x2400
 *
 * 响应取值: result.data[0].url
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
/**
 * 同步调用 TokenPlan 图片生成 API
 *
 * 使用 OpenAI-compatible /images/generations 端点。
 * TokenPlan 作为代理会将请求转发到百炼 DashScope 后端。
 */
export declare function generateTokenPlanImage(config: ApiConfig, params: ImageGenParams): Promise<string>;
