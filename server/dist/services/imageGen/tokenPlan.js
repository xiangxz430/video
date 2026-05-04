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
 * 宽高比映射 (qwen-image-2.0 官方推荐分辨率，使用 DashScope * 分隔符):
 *   16:9 → 2688*1536, 9:16 → 1536*2688, 1:1 → 2048*2048
 *   4:3 → 2368*1728, 3:4 → 1728*2368
 *
 * 响应取值: result.data[0].url
 */
import { recordAICall, sanitizeAICallBody } from '../logContext.js';
// 宽高比 → 像素尺寸映射 (qwen-image-2.0 官方推荐分辨率，2K 基准)
const ASPECT_RATIO_SIZE_MAP = {
    '16:9': '2688*1536',
    '9:16': '1536*2688',
    '1:1': '2048*2048',
    '4:3': '2368*1728',
    '3:4': '1728*2368',
};
/**
 * 将分辨率快捷方式 (1k/2k/4k) 转换为 DashScope 兼容的具体像素尺寸
 *
 * DashScope / Qwen-Image-2.0 不接受 '2k' 等简写，必须传入具体像素尺寸
 * （如 '2688*1536'）。根据宽高比从官方推荐值中选择对应尺寸。
 */
function resolutionShortcutToSize(shortcut, aspectRatio) {
    // 使用官方推荐尺寸作为基准
    const ar = aspectRatio && ASPECT_RATIO_SIZE_MAP[aspectRatio]
        ? aspectRatio
        : '16:9'; // 默认 16:9
    const [w, h] = ASPECT_RATIO_SIZE_MAP[ar].split('*').map(Number);
    if (shortcut === '4k') {
        return `${w * 2}*${h * 2}`;
    }
    // 2k (及自动升级的 1k)
    return `${w}*${h}`;
}
/**
 * 标准化 size 参数为 DashScope 兼容格式
 * - 将 'x' 分隔符替换为 '*'
 * - 保留已是 '*' 分隔符的格式
 */
function normalizeSizeForDashScope(size) {
    if (/^\d+x\d+$/i.test(size)) {
        return size.replace('x', '*');
    }
    return size;
}
/**
 * 同步调用 TokenPlan 图片生成 API
 *
 * 使用 OpenAI-compatible /images/generations 端点。
 * TokenPlan 作为代理会将请求转发到百炼 DashScope 后端。
 */
export async function generateTokenPlanImage(config, params) {
    const baseUrl = config.baseUrl || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
    const model = config.model || 'qwen-image-2.0';
    const endpoint = `${baseUrl}/images/generations`;
    const startTime = Date.now();
    const requestBody = {
        model,
        prompt: params.prompt,
    };
    // 参考图片：使用 images 数组（OpenAI-compatible 格式）
    if (params.referenceImages?.length) {
        const validImages = params.referenceImages.filter(img => img.startsWith('http://') ||
            img.startsWith('https://') ||
            img.startsWith('data:image/'));
        if (validImages.length > 0) {
            requestBody.images = validImages;
            console.log(`TokenPlan 图生图模式，参考图片数: ${validImages.length}`);
        }
        else {
            console.warn('⚠️ TokenPlan 参考图片格式无效，将使用文生图模式');
        }
    }
    // 尺寸处理（确保输出格式兼容 DashScope 原生 API）
    // 注意: DashScope 不接受 '2k'/'4k' 简写，必须转换为具体像素尺寸
    if (params.size) {
        const sizeLower = params.size.toLowerCase();
        if (sizeLower === '1k') {
            const actualSize = resolutionShortcutToSize('2k', params.aspectRatio);
            requestBody.size = actualSize;
            console.log(`⚠️ 1K 分辨率不满足最小像素要求，自动升级到 ${actualSize}`);
        }
        else if (sizeLower === '2k' || sizeLower === '4k') {
            const actualSize = resolutionShortcutToSize(sizeLower, params.aspectRatio);
            requestBody.size = actualSize;
        }
        else {
            // 精确像素尺寸（如 "1440x2560" 或 "1440*2560"），统一转为 DashScope * 格式
            requestBody.size = normalizeSizeForDashScope(params.size);
        }
    }
    else if (params.aspectRatio) {
        const mappedSize = ASPECT_RATIO_SIZE_MAP[params.aspectRatio];
        if (mappedSize) {
            requestBody.size = mappedSize;
        }
        else {
            requestBody.size = resolutionShortcutToSize('2k');
            console.log(`⚠️ 未知宽高比 ${params.aspectRatio}，默认使用 2K`);
        }
    }
    else {
        requestBody.size = resolutionShortcutToSize('2k');
        console.log('⚠️ 未指定分辨率，默认使用 2K');
    }
    // 180 秒超时（图片生成可能较慢）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000);
    try {
        const refImgCount = params.referenceImages?.length || 0;
        const refImgPreview = refImgCount > 0
            ? `[${refImgCount} 张, 首张前60字符: ${params.referenceImages[0].substring(0, 60)}...]`
            : '无';
        console.log(`TokenPlan 图片生成请求: model=${model}, size=${requestBody.size}, 参考图=${refImgPreview}`);
        console.log(`TokenPlan 完整请求体: ${JSON.stringify({
            ...requestBody,
            images: refImgCount > 0 ? `[${refImgCount} base64 images omitted]` : undefined,
        })}`);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });
        const responseTime = Date.now() - startTime;
        clearTimeout(timeoutId);
        if (!response.ok) {
            const errText = await response.text();
            let errorMessage = `TokenPlan 图片生成失败 (${response.status}): ${errText}`;
            try {
                const errData = JSON.parse(errText);
                if (errData.message || errData.error?.message) {
                    errorMessage = `TokenPlan 图片生成失败: ${errData.message || errData.error.message}`;
                }
            }
            catch { }
            recordAICall({
                provider: 'tokenplan',
                model,
                endpoint,
                requestTime: responseTime,
                status: 'failed',
                errorMessage,
                requestBody: sanitizeAICallBody(requestBody),
            });
            throw new Error(errorMessage);
        }
        const data = await response.json();
        // 尝试多种响应格式提取图片 URL
        let imageUrl;
        // 格式1: data.data[0].url (OpenAI-compatible)
        if (data.data?.[0]?.url) {
            imageUrl = data.data[0].url;
        }
        // 格式2: data.output.results[0].url (DashScope 透传)
        else if (data.output?.results?.[0]?.url) {
            imageUrl = data.output.results[0].url;
        }
        // 格式3: data.output.choices[0].message.content[0].image
        else if (data.output?.choices?.[0]?.message?.content?.[0]?.image) {
            imageUrl = data.output.choices[0].message.content[0].image;
        }
        if (!imageUrl) {
            recordAICall({
                provider: 'tokenplan',
                model,
                endpoint,
                requestTime: Date.now() - startTime,
                status: 'failed',
                errorMessage: '图片生成失败：响应中未找到图片 URL',
                requestBody: sanitizeAICallBody(requestBody),
                responseBody: sanitizeAICallBody(data),
            });
            throw new Error('TokenPlan 图片生成失败：响应中未找到图片 URL');
        }
        console.log(`TokenPlan 图片生成成功，耗时 ${responseTime}ms`);
        recordAICall({
            provider: 'tokenplan',
            model,
            endpoint,
            requestTime: Date.now() - startTime,
            status: 'success',
            requestBody: sanitizeAICallBody(requestBody),
            responseBody: sanitizeAICallBody({ imageUrl }),
        });
        return imageUrl;
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.message?.startsWith('TokenPlan 图片生成失败')) {
            throw error;
        }
        const isTimeout = error.name === 'AbortError';
        const errorMessage = isTimeout
            ? 'TokenPlan 请求超时（180秒）'
            : (error.message || '未知错误');
        recordAICall({
            provider: 'tokenplan',
            model,
            endpoint,
            requestTime: Date.now() - startTime,
            status: isTimeout ? 'timeout' : 'failed',
            errorMessage,
            requestBody: sanitizeAICallBody(requestBody),
        });
        throw new Error(errorMessage);
    }
}
