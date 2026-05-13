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
 * 将分辨率快捷方式 (1k/2k/4k) 转换为具体像素尺寸
 */
function resolutionShortcutToSize(shortcut, aspectRatio) {
    const ar = aspectRatio && ASPECT_RATIO_SIZE_MAP[aspectRatio]
        ? aspectRatio
        : '16:9';
    const [w, h] = ASPECT_RATIO_SIZE_MAP[ar].split('*').map(Number);
    if (shortcut === '4k') {
        return `${w * 2}*${h * 2}`;
    }
    return `${w}*${h}`;
}
/**
 * 标准化 size 参数为 DashScope 兼容格式（* 分隔符）
 */
function normalizeSizeForDashScope(size) {
    if (/^\d+x\d+$/i.test(size)) {
        return size.replace('x', '*');
    }
    return size;
}
/**
 * 调用 TokenPlan 图片生成 API
 *
 * 统一使用 /chat/completions 端点，messages 格式。
 * 文生图和图生图仅在 content 数组中是否包含 image 对象上有区别。
 */
export async function generateTokenPlanImage(config, params) {
    const baseUrl = config.baseUrl || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
    const model = config.model || 'qwen-image-2.0';
    const endpoint = `${baseUrl}/chat/completions`;
    const startTime = Date.now();
    // 解析 size 参数
    const resolveSize = () => {
        if (params.size) {
            const sizeLower = params.size.toLowerCase();
            if (sizeLower === '1k') {
                const actualSize = resolutionShortcutToSize('2k', params.aspectRatio);
                console.log(`⚠️ 1K 分辨率不满足最小像素要求，自动升级到 ${actualSize}`);
                return actualSize;
            }
            else if (sizeLower === '2k' || sizeLower === '4k') {
                return resolutionShortcutToSize(sizeLower, params.aspectRatio);
            }
            else {
                return normalizeSizeForDashScope(params.size);
            }
        }
        else if (params.aspectRatio) {
            const mappedSize = ASPECT_RATIO_SIZE_MAP[params.aspectRatio];
            if (mappedSize)
                return mappedSize;
            console.log(`⚠️ 未知宽高比 ${params.aspectRatio}，默认使用 2K`);
            return resolutionShortcutToSize('2k');
        }
        else {
            console.log('⚠️ 未指定分辨率，默认使用 2K');
            return resolutionShortcutToSize('2k');
        }
    };
    const actualSize = resolveSize();
    // 构建 content 数组
    const content = [];
    // 过滤有效参考图片并添加到 content
    const validImages = params.referenceImages?.filter(img => img.startsWith('http://') ||
        img.startsWith('https://') ||
        img.startsWith('data:image/')) || [];
    if (validImages.length > 0) {
        for (const img of validImages) {
            content.push({ image: img });
        }
        console.log(`TokenPlan 图生图模式，参考图片数: ${validImages.length}`);
    }
    else {
        if (params.referenceImages?.length) {
            console.warn('⚠️ TokenPlan 参考图片格式无效，将使用文生图模式');
        }
        console.log('TokenPlan 文生图模式');
    }
    // 提示词始终作为 text 对象
    content.push({ text: params.prompt });
    // 统一请求体：model + messages + parameters
    const requestBody = {
        model,
        messages: [{ role: 'user', content }],
        parameters: { size: actualSize },
    };
    // 180 秒超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000);
    try {
        const refImgCount = validImages.length;
        const refImgPreview = refImgCount > 0
            ? `[${refImgCount} 张, 首张前60字符: ${validImages[0].substring(0, 60)}...]`
            : '无';
        console.log(`TokenPlan 图片生成请求: model=${model}, size=${actualSize}, endpoint=${endpoint}, 参考图=${refImgPreview}`);
        // 日志中省略 base64 内容
        const logSafe = { ...requestBody, messages: [{ role: 'user', content: refImgCount > 0 ? `[${refImgCount} image(s) + prompt]` : `[prompt only]` }] };
        console.log(`TokenPlan 完整请求体: ${JSON.stringify(logSafe)}`);
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
        // 从响应中提取图片 URL
        // 主格式: data.output.choices[0].message.content[0].image
        let imageUrl;
        if (data.output?.choices?.[0]?.message?.content?.[0]?.image) {
            imageUrl = data.output.choices[0].message.content[0].image;
        }
        // 兼容格式: data.data[0].url
        else if (data.data?.[0]?.url) {
            imageUrl = data.data[0].url;
        }
        // 兼容格式: data.output.results[0].url
        else if (data.output?.results?.[0]?.url) {
            imageUrl = data.output.results[0].url;
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
