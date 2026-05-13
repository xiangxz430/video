/**
 * TokenPlan (百炼包月) 图片生成服务
 *
 * TokenPlan 是百炼的包月代理服务，通过 compatible-mode API 提供图片生成能力。
 *
 * API 端点: POST {baseUrl}/chat/completions
 * 认证方式: Bearer Token (TokenPlan API Key, sk-sp- 前缀)
 * 任务模式: 同步返回
 *
 * 文生图和图生图统一使用 messages + content 格式:
 *
 * 文生图:
 *   { model, messages: [{role: "user", content: [{text: "提示词"}]}], parameters: {size} }
 *
 * 图生图:
 *   { model, messages: [{role: "user", content: [
 *     {image: "https://xxx.png"},
 *     {text: "提示词"}
 *   ]}], parameters: {size} }
 *
 * 响应格式:
 *   { output: { choices: [{ message: { content: [{ image: "url" }] } }] } }
 *
 * 宽高比映射 (qwen-image-2.0 官方推荐分辨率，使用 * 分隔符):
 *   16:9 → 2688*1536, 9:16 → 1536*2688, 1:1 → 2048*2048
 *   4:3 → 2368*1728, 3:4 → 1728*2368
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
/**
 * 调用 TokenPlan 图片生成 API
 *
 * 统一使用 /chat/completions 端点，messages 格式。
 * 文生图和图生图仅在 content 数组中是否包含 image 对象上有区别。
 */
export declare function generateTokenPlanImage(config: ApiConfig, params: ImageGenParams): Promise<string>;
