/**
 * 火山方舟 Seedream (Volcengine) 图片生成服务
 *
 * API 端点: POST {baseUrl}/images/generations
 * 认证方式: Bearer Token (火山方舟 ark- 前缀 API Key)
 * 任务模式: 同步返回
 *
 * 参考图片格式 (顶级 images 数组):
 *   requestBody.images = ["https://...", "data:image/jpeg;base64,..."]
 *   支持 http/https URL 和 base64 data URL
 *
 * 宽高比映射:
 *   16:9 → 2688x1536, 9:16 → 1536x2688, 1:1 → 2048x2048
 *   4:3 → 2368x1728, 3:4 → 1728x2368
 *
 * 响应取值: result.data[0].url
 *
 * 注意:
 *   - 有敏感内容检测 (InputImageSensitiveContentDetected)
 *   - 分辨率 1K 会自动升级到 2K
 *   - 不要与 OpenRouter 的 vision 格式或 Grsai 的 urls 字段混淆
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
export declare function generateVolcImage(params: ImageGenParams, config: ApiConfig): Promise<string>;
export declare function generateImageWithVolcEngine(params: ImageGenParams, config: ApiConfig): Promise<string>;
