/**
 * TokenPlan (百炼包月) 图片生成服务
 *
 * TokenPlan 是百炼的包月代理服务，通过 OpenAI-compatible API 提供
 * 图片生成能力。其 compatible-mode 端点将请求转发到百炼 DashScope 后端。
 *
 * API 端点: POST {baseUrl}/images/generations
 * 认证方式: Bearer Token (TokenPlan API Key, sk-sp- 前缀)
 * 任务模式: 同步返回
 *
 * 两种请求格式（根据是否有参考图自动切换）:
 *
 * 1. 文生图（无参考图）— OpenAI-compatible 格式:
 *    { model, prompt, size }
 *
 * 2. 图生图（有参考图）— DashScope 原生 input.messages 格式:
 *    { model, input: { messages: [{ role: "user", content: [
 *      { image: "data:image/jpeg;base64,..." },
 *      { text: "prompt..." }
 *    ]}]}, parameters: { size } }
 *    注意: TokenPlan 的 images 数组不支持 base64 data URL（报 url error），
 *    必须用 DashScope 原生的 content[] 格式
 *
 * 宽高比映射 (qwen-image-2.0 官方推荐分辨率，使用 DashScope * 分隔符):
 *   16:9 → 2688*1536, 9:16 → 1536*2688, 1:1 → 2048*2048
 *   4:3 → 2368*1728, 3:4 → 1728*2368
 *
 * 响应取值（兼容多种格式）:
 *   - data.data[0].url (OpenAI-compatible)
 *   - data.output.results[0].url (DashScope 原生)
 *   - data.output.choices[0].message.content[0].image (DashScope 原生)
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
/**
 * 同步调用 TokenPlan 图片生成 API
 *
 * 使用 OpenAI-compatible /images/generations 端点。
 * TokenPlan 作为代理会将请求转发到百炼 DashScope 后端。
 */
export declare function generateTokenPlanImage(config: ApiConfig, params: ImageGenParams): Promise<string>;
