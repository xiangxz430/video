/**
 * OpenRouter 图片生成服务
 *
 * API 端点: POST https://openrouter.ai/api/v1/chat/completions
 * 认证方式: Bearer Token (OpenRouter API Key)
 * 任务模式: 同步返回
 *
 * 参考图片格式 (vision 格式，与其他提供商完全不同):
 *   messages[].content = [
 *     { type: 'text', text: prompt },
 *     { type: 'image_url', image_url: { url: 'base64或URL' } }
 *   ]
 *   注意: content 必须是数组格式，不能是纯字符串
 *
 * 响应取值: result.choices[0].message.images[0].image_url.url
 *
 * 注意:
 *   - 不要与火山方舟的 requestBody.images 或 Grsai 的 requestBody.urls 混淆
 *   - 默认模型: black-forest-labs/flux.2-pro
 *   - 支持 image_config 配置宽高比和尺寸
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
export declare function generateImageWithOpenRouter(params: ImageGenParams, config: ApiConfig): Promise<string>;
