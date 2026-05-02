import { recordAICall, sanitizeAICallBody } from '../logContext.js';
// 宽高比 → Wan2.7-Image size 参数映射
const ASPECT_RATIO_MAP = {
    '1:1': '1024*1024',
    '16:9': '1280*720',
    '9:16': '720*1280',
    '4:3': '1024*768',
    '3:4': '768*1024',
};
/**
 * 将 aspectRatio 或 size 参数映射为 Wan2.7-Image 的 size 格式 ("WIDTH*HEIGHT")
 */
function mapSize(params) {
    // 精确像素尺寸优先（如 "1280x720" → "1280*720"）
    if (params.size && params.size.includes('x')) {
        return params.size.replace('x', '*');
    }
    // 宽高比映射
    if (params.aspectRatio && ASPECT_RATIO_MAP[params.aspectRatio]) {
        return ASPECT_RATIO_MAP[params.aspectRatio];
    }
    // 默认 1:1
    return '1024*1024';
}
/**
 * 同步调用 Wan2.7-Image 生成图片
 *
 * 使用 multimodal-generation 同步端点，直接返回图片 URL。
 * 无需异步提交+轮询，但响应可能耗时 30-120 秒。
 */
export async function generateWanxImage(config, params) {
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
    const model = config.model || 'wan2.7-image';
    const endpoint = `${baseUrl}/services/aigc/multimodal-generation/generation`;
    const startTime = Date.now();
    // 构建 messages content 数组
    const content = [];
    // 参考图片：每张一个 {"image": "URL"} 对象
    if (params.referenceImages?.length) {
        for (const img of params.referenceImages) {
            content.push({ image: img });
        }
        console.log(`Wan2.7-Image 图生图模式，参考图片数: ${params.referenceImages.length}`);
    }
    // 提示词
    content.push({ text: params.prompt });
    const sizeParam = mapSize(params);
    const requestBody = {
        model,
        input: {
            messages: [{
                    role: 'user',
                    content,
                }],
        },
        parameters: {
            size: sizeParam,
            n: 1,
        },
    };
    // 180 秒超时（同步 API 可能需要 30-120 秒响应）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000);
    try {
        console.log(`Wan2.7-Image 图片生成请求: model=${model}, size=${sizeParam}, 参考图=${params.referenceImages?.length || 0}`);
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
            let errorMessage = `Wan2.7-Image 图片生成失败 (${response.status}): ${errText}`;
            try {
                const errData = JSON.parse(errText);
                if (errData.message || errData.error?.message) {
                    errorMessage = `Wan2.7-Image 图片生成失败: ${errData.message || errData.error.message}`;
                }
            }
            catch { }
            recordAICall({
                provider: 'dashscope',
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
        // 尝试从两种响应格式中提取图片 URL
        let imageUrl;
        // 格式1: data.output.results[0].url
        if (data.output?.results?.[0]?.url) {
            imageUrl = data.output.results[0].url;
        }
        // 格式2: data.output.choices[0].message.content[0].image
        else if (data.output?.choices?.[0]?.message?.content?.[0]?.image) {
            imageUrl = data.output.choices[0].message.content[0].image;
        }
        if (!imageUrl) {
            recordAICall({
                provider: 'dashscope',
                model,
                endpoint,
                requestTime: Date.now() - startTime,
                status: 'failed',
                errorMessage: '图片生成失败：响应中未找到图片 URL',
                requestBody: sanitizeAICallBody(requestBody),
                responseBody: sanitizeAICallBody(data),
            });
            throw new Error('Wan2.7-Image 图片生成失败：响应中未找到图片 URL');
        }
        console.log(`Wan2.7-Image 图片生成成功，耗时 ${responseTime}ms`);
        recordAICall({
            provider: 'dashscope',
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
        // 避免重复记录（上面 response.ok 分支已记录）
        if (error.message?.startsWith('Wan2.7-Image 图片生成失败')) {
            throw error;
        }
        const isTimeout = error.name === 'AbortError';
        const errorMessage = isTimeout
            ? 'Wan2.7-Image 请求超时（180秒）'
            : (error.message || '未知错误');
        recordAICall({
            provider: 'dashscope',
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
// ========== 旧函数名兼容导出（已废弃） ==========
/**
 * @deprecated 已废弃。Wan2.7-Image 使用同步 API，无需异步提交+轮询。
 * 保留导出以兼容旧引用，调用会直接抛错提示迁移。
 */
export async function submitWanxTask(_config, _prompt) {
    throw new Error('submitWanxTask 已废弃，Wan2.7-Image 现使用同步 API，请改用 generateWanxImage()');
}
/**
 * @deprecated 已废弃。Wan2.7-Image 使用同步 API，无需异步提交+轮询。
 * 保留导出以兼容旧引用，调用会直接抛错提示迁移。
 */
export async function waitForWanxTask(_config, _taskId) {
    throw new Error('waitForWanxTask 已废弃，Wan2.7-Image 现使用同步 API，请改用 generateWanxImage()');
}
