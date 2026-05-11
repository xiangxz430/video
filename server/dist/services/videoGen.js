import { generateVolcSignature } from './apiClients.js';
import { recordAICall, sanitizeAICallBody } from './logContext.js';
// 视频轮询相关常量
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_MAX_POLL_RETRIES = 120;
// ========== 火山引擎视频生成 ==========
function parseVolcCredentials(apiKey) {
    if (apiKey.includes(':')) {
        const [accessKey, secretKey] = apiKey.split(':');
        return { accessKey, secretKey };
    }
    return null;
}
const DEFAULT_VOLC_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
async function callVolcEngine(config, path, method, body, retryCount = 2) {
    let authHeader;
    if (config.apiKey.includes(':')) {
        const parsed = parseVolcCredentials(config.apiKey);
        if (!parsed)
            throw new Error('火山引擎 API Key 格式错误，请输入：AccessKeyID:SecretAccessKey');
        const query = '';
        authHeader = await generateVolcSignature(parsed.accessKey, parsed.secretKey, method, path, query, body);
    }
    else {
        authHeader = `Bearer ${config.apiKey}`;
    }
    const baseUrl = config.baseUrl || DEFAULT_VOLC_ARK_BASE_URL;
    const url = `${baseUrl}${path}`;
    console.log(`[VolcEngine] 请求: ${method} ${url}`);
    let lastError;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
        if (attempt > 0) {
            console.log(`[VolcEngine] 第 ${attempt} 次重试...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: method !== 'GET' ? body : undefined
            });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`火山引擎 API 请求失败 (${response.status}): ${errText}`);
            }
            return await response.json();
        }
        catch (error) {
            lastError = error;
            console.error(`[VolcEngine] 第 ${attempt + 1} 次请求失败:`, error.message);
            if (!error.message?.includes('error sending request')) {
                throw error;
            }
        }
    }
    console.error(`[VolcEngine] 请求失败，已重试 ${retryCount} 次`);
    throw new Error(`网络请求失败，请检查：1.网络连接 2.能否访问 ${baseUrl} 3.防火墙/代理设置`);
}
export async function submitVolcVideoTask(params, config) {
    const { prompt, firstFrameImage, lastFrameImage, referenceImages, aspectRatio, duration, enableAudio = true } = params;
    const content = [];
    if (prompt) {
        content.push({ type: 'text', text: prompt });
    }
    let mode = 'text-to-video';
    if (firstFrameImage && lastFrameImage) {
        mode = 'first-last-frame';
        content.push({ type: 'image_url', image_url: { url: firstFrameImage }, role: 'first_frame' });
        content.push({ type: 'image_url', image_url: { url: lastFrameImage }, role: 'last_frame' });
    }
    else if (firstFrameImage) {
        mode = 'image-to-video';
        content.push({ type: 'image_url', image_url: { url: firstFrameImage }, role: 'first_frame' });
    }
    else if (referenceImages && referenceImages.length > 0) {
        mode = 'image-to-video';
        referenceImages.forEach((imgUrl) => {
            content.push({ type: 'image_url', image_url: { url: imgUrl }, role: 'reference_image' });
        });
    }
    const model = config.model || 'doubao-seedance-1-5-pro-251215';
    const requestBody = {
        model,
        content
    };
    if (aspectRatio)
        requestBody.ratio = aspectRatio;
    const MIN_DURATION = 5;
    const MAX_DURATION = 10;
    if (duration !== undefined) {
        requestBody.duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration));
    }
    else {
        requestBody.duration = MIN_DURATION;
    }
    requestBody.motion_duration = requestBody.duration;
    requestBody.resolution = '720p';
    requestBody.generate_audio = enableAudio;
    requestBody.watermark = false;
    const body = JSON.stringify(requestBody);
    console.log(`视频生成请求 [${mode}]：`, JSON.stringify(requestBody, null, 2));
    const data = await callVolcEngine(config, '/contents/generations/tasks', 'POST', body);
    return { taskId: data.id || data.task_id || '', mode };
}
export async function queryVolcVideoTask(taskId, config) {
    const data = await callVolcEngine(config, `/contents/generations/tasks/${taskId}`, 'GET', '');
    const status = data.status || '';
    console.log('视频任务状态:', status, '响应:', data);
    if (status === 'succeeded') {
        const videoUrl = data.content?.video_url ||
            data.output?.video_url ||
            (data.output?.videos && data.output.videos[0]?.url) ||
            data.video_url || null;
        return { status: 'finished', videoUrl: videoUrl || undefined, duration: data.duration, ratio: data.ratio, resolution: data.resolution };
    }
    else if (status === 'failed') {
        throw new Error('视频生成失败: ' + (data.error?.message || '未知错误'));
    }
    else if (status === 'expired') {
        throw new Error('视频生成任务超时');
    }
    else if (status === 'cancelled') {
        throw new Error('视频生成任务已取消');
    }
    return { status };
}
export async function waitForVolcVideo(taskId, config, maxRetries = VIDEO_MAX_POLL_RETRIES, intervalMs = VIDEO_POLL_INTERVAL_MS, onProgress) {
    console.log(`开始等待视频生成，任务ID: ${taskId}，查询间隔: ${intervalMs / 1000}秒`);
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        const result = await queryVolcVideoTask(taskId, config);
        onProgress?.(result.status, attempt + 1);
        if (result.status === 'finished' && result.videoUrl) {
            return result.videoUrl;
        }
        console.log(`[VolcVideo] 第 ${attempt + 1}/${maxRetries} 次查询，状态: ${result.status}`);
    }
    throw new Error('视频生成超时');
}
export async function generateVideoWithVolcEngine(params, config) {
    const startTime = Date.now();
    const model = config.model || 'doubao-seedance-1-5-pro-251215';
    const baseUrl = config.baseUrl || DEFAULT_VOLC_ARK_BASE_URL;
    let pollAttempts = 0;
    try {
        const { taskId } = await submitVolcVideoTask(params, config);
        const videoUrl = await waitForVolcVideo(taskId, config, VIDEO_MAX_POLL_RETRIES, VIDEO_POLL_INTERVAL_MS, (_status, attempt) => {
            pollAttempts = attempt;
        });
        recordAICall({
            provider: 'volcengine',
            model,
            endpoint: `${baseUrl}/contents/generations/tasks`,
            requestTime: Date.now() - startTime,
            status: 'success',
            pollAttempts,
            taskId,
            requestBody: sanitizeAICallBody({ prompt: params.prompt?.slice(0, 200), mode: 'volcengine-video', aspectRatio: params.aspectRatio, duration: params.duration }),
            responseBody: sanitizeAICallBody({ videoUrl }),
        });
        return videoUrl;
    }
    catch (error) {
        recordAICall({
            provider: 'volcengine',
            model,
            endpoint: `${baseUrl}/contents/generations/tasks`,
            requestTime: Date.now() - startTime,
            status: error.message?.includes('超时') ? 'timeout' : 'failed',
            errorMessage: error.message,
            pollAttempts,
            requestBody: sanitizeAICallBody({ prompt: params.prompt?.slice(0, 200), mode: 'volcengine-video', aspectRatio: params.aspectRatio, duration: params.duration }),
        });
        throw error;
    }
}
// ========== Wan 2.6 视频生成 ==========
export async function generateVideoWithWan26(params, config, onProgress) {
    const startTime = Date.now();
    const { prompt, firstFrameImage, lastFrameImage, referenceImages, aspectRatio = '16:9', duration = 5, seed, size, callbackUrl, providerOptions } = params;
    const baseUrl = 'https://openrouter.ai/api/v1';
    const model = config.model || 'alibaba/wan-2.6';
    const requestBody = { model, prompt: prompt || '' };
    if (duration)
        requestBody.duration = duration;
    if (size) {
        requestBody.size = size;
    }
    else {
        if (aspectRatio)
            requestBody.aspect_ratio = aspectRatio;
        if (params.resolution)
            requestBody.resolution = params.resolution;
    }
    if (seed !== undefined)
        requestBody.seed = seed;
    if (callbackUrl)
        requestBody.callback_url = callbackUrl;
    if (providerOptions)
        requestBody.provider = providerOptions;
    // 图片转视频：首帧/尾帧 → frame_images
    if (firstFrameImage) {
        const frameImages = [
            { type: 'image_url', image_url: { url: firstFrameImage }, frame_type: 'first_frame' }
        ];
        if (lastFrameImage) {
            frameImages.push({ type: 'image_url', image_url: { url: lastFrameImage }, frame_type: 'last_frame' });
        }
        requestBody.frame_images = frameImages;
    }
    else if (referenceImages?.length) {
        // 参考图转视频 → input_references
        requestBody.input_references = referenceImages.map((url) => ({
            type: 'image_url',
            image_url: { url }
        }));
    }
    const bodyStr = JSON.stringify(requestBody);
    console.log(`[Wan2.6] 提交请求 → POST ${baseUrl}/videos, model: ${model}`);
    // 提交任务（带超时和重试）
    const SUBMIT_TIMEOUT_MS = 120_000; // 2分钟超时
    const MAX_RETRIES = 2;
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            const delayMs = 2000 * attempt;
            console.log(`[Wan2.6] 第 ${attempt} 次重试提交，等待 ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
            const submitResponse = await fetch(`${baseUrl}/videos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' },
                body: bodyStr,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!submitResponse.ok) {
                const errText = await submitResponse.text();
                throw new Error(`Wan 2.6 提交失败: ${submitResponse.status} ${errText}`);
            }
            const submitResult = await submitResponse.json();
            if (submitResult.error)
                throw new Error(`Wan 2.6 错误: ${submitResult.error.message || JSON.stringify(submitResult.error)}`);
            const pollingUrl = submitResult.polling_url;
            if (!pollingUrl)
                throw new Error('Wan 2.6 返回缺少 polling_url');
            try {
                const videoUrl = await waitForWan26Video(pollingUrl, config.apiKey, 600000, onProgress);
                recordAICall({
                    provider: 'openrouter',
                    model,
                    endpoint: `${baseUrl}/videos`,
                    requestTime: Date.now() - startTime,
                    status: 'success',
                    taskId: submitResult.id,
                    requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), aspectRatio, duration }),
                    responseBody: sanitizeAICallBody({ videoUrl }),
                });
                return videoUrl;
            }
            catch (error) {
                recordAICall({
                    provider: 'openrouter',
                    model,
                    endpoint: `${baseUrl}/videos`,
                    requestTime: Date.now() - startTime,
                    status: error.message?.includes('超时') ? 'timeout' : 'failed',
                    errorMessage: error.message,
                    taskId: submitResult.id,
                    requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), aspectRatio, duration }),
                });
                throw error;
            }
        }
        catch (error) {
            lastError = error;
            const msg = error?.message || '';
            console.error(`[Wan2.6] 第 ${attempt + 1} 次提交失败:`, msg);
            // 非网络错误（如 API 返回的业务错误）不重试
            const isNetworkError = msg.includes('fetch failed') ||
                msg.includes('AbortError') ||
                msg.includes('network') ||
                msg.includes('connect') ||
                msg.includes('timeout') ||
                msg.includes('ECONN');
            if (!isNetworkError)
                throw error;
        }
    }
    console.error(`[Wan2.6] 提交失败，已重试 ${MAX_RETRIES} 次`);
    throw new Error(`Wan 2.6 网络请求失败（已重试${MAX_RETRIES}次）: ${lastError?.message || '未知错误'}。请检查网络连接或稍后重试`);
}
async function waitForWan26Video(pollingUrl, apiKey, maxWaitMs = 600000, onProgress) {
    const startTime = Date.now();
    // 指数退避：初始 3s，每次增长 1.5x，上限 20s
    let intervalMs = 3000;
    const maxIntervalMs = 20000;
    const backoffFactor = 1.5;
    while (Date.now() - startTime < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        const pollResponse = await fetch(pollingUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' }
        });
        if (!pollResponse.ok) {
            intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
            continue;
        }
        const pollResult = await pollResponse.json();
        onProgress?.(pollResult.status);
        if (pollResult.status === 'completed' && pollResult.unsigned_urls?.length)
            return pollResult.unsigned_urls[0];
        if (['failed', 'cancelled', 'expired'].includes(pollResult.status))
            throw new Error(`Wan 2.6 视频生成失败: ${pollResult.error || pollResult.status}`);
        // 任务仍在进行，递增退避间隔
        intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
    }
    throw new Error('Wan 2.6 视频生成超时（超过 10 分钟）');
}
// ========== OpenRouter 视频生成 ==========
export async function generateVideoWithOpenRouter(params, config, onProgress) {
    const startTime = Date.now();
    const { prompt, firstFrameImage, lastFrameImage, referenceImages, aspectRatio = '16:9', duration, seed, size, callbackUrl, providerOptions } = params;
    const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    const model = config.model || 'kwaivgi/kling-v3.0-std';
    // 构建符合 OpenRouter Video API 规范的请求体
    const requestBody = { model, prompt };
    // 图片转视频：首帧/尾帧 → frame_images
    if (firstFrameImage) {
        const frameImages = [
            { type: 'image_url', image_url: { url: firstFrameImage }, frame_type: 'first_frame' }
        ];
        if (lastFrameImage) {
            frameImages.push({ type: 'image_url', image_url: { url: lastFrameImage }, frame_type: 'last_frame' });
        }
        requestBody.frame_images = frameImages;
    }
    else if (referenceImages?.length) {
        // 参考图转视频 → input_references
        requestBody.input_references = referenceImages.map((url) => ({
            type: 'image_url',
            image_url: { url }
        }));
    }
    if (duration)
        requestBody.duration = duration;
    if (size) {
        requestBody.size = size;
    }
    else {
        if (aspectRatio)
            requestBody.aspect_ratio = aspectRatio;
        if (params.resolution)
            requestBody.resolution = params.resolution;
    }
    if (params.enableAudio !== undefined)
        requestBody.generate_audio = params.enableAudio;
    if (seed !== undefined)
        requestBody.seed = seed;
    if (callbackUrl)
        requestBody.callback_url = callbackUrl;
    if (providerOptions)
        requestBody.provider = providerOptions;
    const sanitizedBody = sanitizeAICallBody(requestBody);
    const bodyStr = JSON.stringify(requestBody);
    console.log(`[OpenRouter] 提交视频请求 → POST ${baseUrl}/videos, model: ${model}, body: ${JSON.stringify(sanitizedBody)}`);
    // 提交任务（带超时和重试）
    const SUBMIT_TIMEOUT_MS = 120_000;
    const MAX_RETRIES = 2;
    let lastError;
    let result;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            const delayMs = 2000 * attempt;
            console.log(`[OpenRouter] 第 ${attempt} 次重试提交，等待 ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
            const response = await fetch(`${baseUrl}/videos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' },
                body: bodyStr,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errText = await response.text();
                console.error(`[OpenRouter] API 返回错误: ${response.status} ${errText}`);
                throw new Error(`OpenRouter 视频API请求失败: ${response.status} ${errText}`);
            }
            result = await response.json();
            console.log(`[OpenRouter] 提交响应: id=${result.id}, status=${result.status}, polling_url=${result.polling_url}`);
            if (result.error)
                throw new Error(`OpenRouter 错误: ${result.error.message || JSON.stringify(result.error)}`);
            break; // 成功，跳出重试循环
        }
        catch (error) {
            lastError = error;
            const msg = error?.message || '';
            console.error(`[OpenRouter] 第 ${attempt + 1} 次提交失败:`, msg);
            const isNetworkError = msg.includes('fetch failed') ||
                msg.includes('AbortError') ||
                msg.includes('network') ||
                msg.includes('connect') ||
                msg.includes('timeout') ||
                msg.includes('ECONN');
            if (!isNetworkError)
                throw error;
        }
    }
    if (!result) {
        throw new Error(`OpenRouter 网络请求失败（已重试${MAX_RETRIES}次）: ${lastError?.message || '未知错误'}。请检查网络连接或稍后重试`);
    }
    // 使用 API 返回的 polling_url 进行轮询
    const pollingUrl = result.polling_url;
    const jobId = result.id;
    if (!pollingUrl) {
        recordAICall({
            provider: 'openrouter',
            model,
            endpoint: `${baseUrl}/videos`,
            requestTime: Date.now() - startTime,
            status: 'failed',
            errorMessage: 'OpenRouter 返回缺少 polling_url',
            requestBody: sanitizedBody,
        });
        throw new Error('OpenRouter 返回缺少 polling_url');
    }
    try {
        const videoUrl = await waitForOpenRouterVideo(pollingUrl, config.apiKey, 1200000, onProgress);
        recordAICall({
            provider: 'openrouter',
            model,
            endpoint: `${baseUrl}/videos`,
            requestTime: Date.now() - startTime,
            status: 'success',
            taskId: jobId,
            requestBody: sanitizedBody,
            responseBody: sanitizeAICallBody({ videoUrl }),
        });
        return videoUrl;
    }
    catch (error) {
        recordAICall({
            provider: 'openrouter',
            model,
            endpoint: `${baseUrl}/videos`,
            requestTime: Date.now() - startTime,
            status: error.message?.includes('超时') ? 'timeout' : 'failed',
            errorMessage: error.message,
            taskId: jobId,
            requestBody: sanitizedBody,
        });
        throw error;
    }
}
async function waitForOpenRouterVideo(pollingUrl, apiKey, maxWaitTime = 600000, onProgress) {
    const startTime = Date.now();
    // 指数退避：初始 3s，每次增长 1.5x，上限 20s
    let intervalMs = 3000;
    const maxIntervalMs = 20000;
    const backoffFactor = 1.5;
    while (Date.now() - startTime < maxWaitTime) {
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const response = await fetch(pollingUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' }
        });
        if (!response.ok) {
            console.log(`[OpenRouter] 轮询请求失败: url=${pollingUrl}, status=${response.status}, elapsed=${elapsedSec}s`);
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
            continue;
        }
        const result = await response.json();
        onProgress?.(result.status);
        console.log(`[OpenRouter] 轮询状态: status=${result.status}, ` +
            `unsigned_urls=${Array.isArray(result.unsigned_urls) ? result.unsigned_urls.length : 'N/A'}, ` +
            `elapsed=${elapsedSec}s, url=${pollingUrl}`);
        // 视频生成完成，从 unsigned_urls 获取视频地址
        // OpenRouter 轮询响应中完成状态可能是 "complete" 或 "completed"
        const isCompleted = result.status === 'completed' || result.status === 'complete';
        if (isCompleted && result.unsigned_urls?.length) {
            console.log(`[OpenRouter] 视频生成完成，获取 URL: ${result.unsigned_urls[0]}`);
            return result.unsigned_urls[0];
        }
        if (result.status === 'failed') {
            throw new Error(`OpenRouter 视频生成失败: ${result.error?.message || result.error || '未知错误'}`);
        }
        if (result.status === 'cancelled') {
            throw new Error('OpenRouter 视频生成任务已取消');
        }
        if (result.status === 'expired') {
            throw new Error('OpenRouter 视频生成任务已过期');
        }
        // 任务仍在进行，递增退避间隔
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
    }
    const timeoutMin = Math.round(maxWaitTime / 60000);
    throw new Error(`OpenRouter 视频生成超时（超过 ${timeoutMin} 分钟）`);
}
// ========== 统一入口：根据 provider 自动路由 ==========
// Seedance 1.x 模型名映射：OpenRouter ID → 火山引擎模型名
// 注意：Seedance 2.x 仅 OpenRouter 支持，不可映射到火山引擎
const SEEDANCE_OR_TO_VOLC = {
    'bytedance/seedance-1.5-pro': 'doubao-seedance-1-5-pro-251215',
    'bytedance/seedance-1-5-pro': 'doubao-seedance-1-5-pro-251215',
};
export async function generateVideo(params, config, onProgress) {
    const provider = (config.provider || '').toLowerCase();
    const model = (config.model || '').toLowerCase();
    console.log(`[generateVideo] provider=${provider}, model=${model}, prompt=${params.prompt?.substring(0, 50)}...`);
    // Seedance 1.x 直连火山引擎；Seedance 2.x 保留在 OpenRouter（火山引擎不支持）
    if (model.includes('seedance') && (provider === 'openrouter' || !provider)) {
        const isSeedance2 = model.includes('seedance-2') || model.includes('2.0');
        if (!isSeedance2) {
            console.log(`[generateVideo] Seedance 1.x 模型自动路由到火山引擎: ${model}`);
            const volcModel = SEEDANCE_OR_TO_VOLC[config.model || ''] || 'doubao-seedance-1-5-pro-251215';
            const { createApiConfig } = await import('./apiClients.js');
            const volcConfig = createApiConfig('volcengine', volcModel);
            return generateVideoWithVolcEngine(params, volcConfig);
        }
    }
    switch (provider) {
        case 'volcengine':
        case 'volc':
        case 'ark':
            return generateVideoWithVolcEngine(params, config);
        case 'openrouter':
            if (model.includes('wan-2.6') || model.includes('wan-2.7')) {
                return generateVideoWithWan26(params, config, onProgress);
            }
            return generateVideoWithOpenRouter(params, config, onProgress);
        default:
            throw new Error(`不支持的视频生成 provider: ${config.provider}。支持的 provider: volcengine, openrouter, dashscope`);
    }
}
// ========== 便捷方法 ==========
export async function generateVideoFromText(prompt, config) {
    return generateVideo({ prompt }, config);
}
export async function generateVideoFromImage(prompt, firstFrameImage, config) {
    return generateVideo({ prompt, firstFrameImage }, config);
}
export async function generateVideoFromFirstLastFrame(prompt, firstFrameImage, lastFrameImage, config) {
    return generateVideo({ prompt, firstFrameImage, lastFrameImage }, config);
}
export async function generateVideoFromReferenceImages(prompt, referenceImages, config) {
    return generateVideo({ prompt, referenceImages }, config);
}
// ========== DashScope 视频生成 (wan2.7 / happyhorse-1.0) ==========
function resolveDashScopeModel(configModel, params) {
    const isWan = configModel.includes('wan2.7');
    const isHappyHorse = configModel.includes('happyhorse');
    // video-edit 模式：优先级最高（inputVideo > referenceImages > firstFrameImage > t2v）
    if (params.inputVideo) {
        if (isHappyHorse) {
            return 'happyhorse-1.0-video-edit';
        }
        // wan 系列不支持 video-edit
        throw new Error('wan2.7 模型不支持视频编辑(video-edit)模式，请使用 HappyHorse 模型');
    }
    if (params.referenceImages?.length) {
        return isWan ? 'wan2.7-r2v' : 'happyhorse-1.0-r2v';
    }
    if (params.firstFrameImage) {
        return isWan ? 'wan2.7-i2v' : 'happyhorse-1.0-i2v';
    }
    return isWan ? 'wan2.7-t2v-2026-04-25' : 'happyhorse-1.0-t2v';
}
export async function generateVideoWithDashScope(params, config, onProgress) {
    const startTime = Date.now();
    const configModel = config.model || 'dashscope/wan2.7';
    const actualModel = resolveDashScopeModel(configModel, params);
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
    // 判断模式
    const isVideoEdit = actualModel.includes('video-edit');
    const isI2v = actualModel.includes('i2v');
    const isHappyHorse = actualModel.includes('happyhorse');
    // 构建请求体
    const requestBody = {
        model: actualModel,
        input: { prompt: params.prompt },
        parameters: {
            resolution: params.resolution === '1080' ? '1080P' : '720P',
        }
    };
    // ratio: i2v 模式不包含（宽高比自动跟随首帧图像），video-edit 也不支持
    if (!isI2v && !isVideoEdit) {
        requestBody.parameters.ratio = params.aspectRatio || '16:9';
    }
    // duration: video-edit 不包含（输出时长跟随输入视频，最长15秒自动截取）
    if (!isVideoEdit) {
        const minDuration = isI2v ? 3 : 2;
        requestBody.parameters.duration = Math.max(minDuration, Math.min(15, params.duration || 5));
    }
    // HappyHorse 模型默认关闭水印
    if (isHappyHorse) {
        requestBody.parameters.watermark = false;
    }
    // video-edit 模式额外参数
    if (isVideoEdit) {
        requestBody.parameters.audio_setting = params.audioSetting || 'auto';
    }
    // seed
    if (params.seed !== undefined) {
        requestBody.parameters.seed = params.seed;
    }
    // 构建 media 数组
    if (isVideoEdit) {
        // video-edit 模式：输入视频 + 参考图
        const media = [{ type: 'video', url: params.inputVideo }];
        if (params.referenceImages?.length) {
            params.referenceImages.forEach(url => {
                media.push({ type: 'reference_image', url });
            });
        }
        requestBody.input.media = media;
    }
    else if (params.firstFrameImage) {
        // i2v 模型：首帧/尾帧
        const media = [];
        media.push({ type: 'first_frame', url: params.firstFrameImage });
        if (params.lastFrameImage) {
            media.push({ type: 'last_frame', url: params.lastFrameImage });
        }
        requestBody.input.media = media;
    }
    else if (params.referenceImages?.length) {
        // r2v 模型：参考图
        const media = params.referenceImages.map(url => ({
            type: 'reference_image', url
        }));
        requestBody.input.media = media;
    }
    // t2v 模型：不设置 media 字段
    const bodyStr = JSON.stringify(requestBody);
    console.log(`[DashScope] 提交视频请求 → POST ${baseUrl}/services/aigc/video-generation/video-synthesis, model: ${actualModel}`);
    // 提交任务（带超时和重试）
    const SUBMIT_TIMEOUT_MS = 120_000;
    const MAX_RETRIES = 2;
    let lastError;
    let submitResult;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            const delayMs = 2000 * attempt;
            console.log(`[DashScope] 第 ${attempt} 次重试提交，等待 ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
            const response = await fetch(`${baseUrl}/services/aigc/video-generation/video-synthesis`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                    'X-DashScope-Async': 'enable',
                },
                body: bodyStr,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errText = await response.text();
                console.error(`[DashScope] API 返回错误: ${response.status} ${errText}`);
                throw new Error(`DashScope 视频API请求失败: ${response.status} ${errText}`);
            }
            submitResult = await response.json();
            console.log(`[DashScope] 提交响应: task_id=${submitResult.output?.task_id}, task_status=${submitResult.output?.task_status}`);
            const taskId = submitResult.output?.task_id;
            if (!taskId) {
                throw new Error('DashScope 返回缺少 task_id');
            }
            // 轮询等待视频生成完成
            try {
                const videoUrl = await waitForDashScopeVideo(taskId, config.apiKey, baseUrl, 600000, onProgress);
                recordAICall({
                    provider: 'dashscope',
                    model: actualModel,
                    endpoint: `${baseUrl}/services/aigc/video-generation/video-synthesis`,
                    requestTime: Date.now() - startTime,
                    status: 'success',
                    taskId,
                    requestBody: sanitizeAICallBody({ model: actualModel, prompt: params.prompt?.slice(0, 200), aspectRatio: params.aspectRatio, duration: params.duration }),
                    responseBody: sanitizeAICallBody({ videoUrl }),
                });
                return videoUrl;
            }
            catch (error) {
                recordAICall({
                    provider: 'dashscope',
                    model: actualModel,
                    endpoint: `${baseUrl}/services/aigc/video-generation/video-synthesis`,
                    requestTime: Date.now() - startTime,
                    status: error.message?.includes('超时') ? 'timeout' : 'failed',
                    errorMessage: error.message,
                    taskId,
                    requestBody: sanitizeAICallBody({ model: actualModel, prompt: params.prompt?.slice(0, 200), aspectRatio: params.aspectRatio, duration: params.duration }),
                });
                throw error;
            }
        }
        catch (error) {
            lastError = error;
            const msg = error?.message || '';
            console.error(`[DashScope] 第 ${attempt + 1} 次提交失败:`, msg);
            // 非网络错误（如 API 返回的业务错误）不重试
            const isNetworkError = msg.includes('fetch failed') ||
                msg.includes('AbortError') ||
                msg.includes('network') ||
                msg.includes('connect') ||
                msg.includes('timeout') ||
                msg.includes('ECONN');
            if (!isNetworkError)
                throw error;
        }
    }
    console.error(`[DashScope] 提交失败，已重试 ${MAX_RETRIES} 次`);
    throw new Error(`DashScope 网络请求失败（已重试${MAX_RETRIES}次）: ${lastError?.message || '未知错误'}。请检查网络连接或稍后重试`);
}
export async function waitForDashScopeVideo(taskId, apiKey, baseUrl, maxWaitMs = 600000, onProgress) {
    const startTime = Date.now();
    // 指数退避：初始 5s，每次增长 1.5x，上限 20s
    let intervalMs = 5000;
    const maxIntervalMs = 20000;
    const backoffFactor = 1.5;
    while (Date.now() - startTime < maxWaitMs) {
        try {
            const response = await fetch(`${baseUrl}/tasks/${taskId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!response.ok) {
                // 网络错误时继续轮询
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
                continue;
            }
            const result = await response.json();
            const taskStatus = result.output?.task_status;
            onProgress?.(taskStatus);
            console.log(`[DashScope] 轮询状态: ${taskStatus}`);
            if (taskStatus === 'SUCCEEDED') {
                const videoUrl = result.output?.video_url;
                if (!videoUrl)
                    throw new Error('DashScope 视频生成成功但未返回 video_url');
                return videoUrl;
            }
            if (taskStatus === 'FAILED') {
                throw new Error(`DashScope 视频生成失败: ${result.output?.message || result.output?.code || '未知错误'}`);
            }
            if (taskStatus === 'CANCELED') {
                throw new Error('DashScope 视频生成任务已取消');
            }
            if (taskStatus === 'UNKNOWN') {
                throw new Error('DashScope 视频生成任务状态异常 (UNKNOWN)');
            }
            // PENDING / RUNNING → 继续轮询
        }
        catch (error) {
            // 非 DashScope 业务错误（网络错误等），继续轮询
            const msg = error?.message || '';
            const isBusinessError = msg.includes('DashScope 视频生成失败') ||
                msg.includes('DashScope 视频生成任务已取消') ||
                msg.includes('DashScope 视频生成任务状态异常') ||
                msg.includes('DashScope 视频生成成功但未返回');
            if (isBusinessError)
                throw error;
            // 网络错误，继续轮询
            console.warn(`[DashScope] 轮询网络错误，继续等待: ${msg}`);
        }
        // 等待后再次轮询
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
    }
    throw new Error('DashScope 视频生成超时（超过 10 分钟）');
}
