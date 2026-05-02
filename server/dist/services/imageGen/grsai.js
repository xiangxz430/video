/**
 * Grsai 图片生成服务
 *
 * API 端点:
 *   提交: POST {baseUrl}/v1/draw/nano-banana
 *   查询: GET  {baseUrl}/v1/draw/result?taskId={id}
 * 认证方式: Bearer Token (Grsai API Key)
 * 任务模式: 流式 (EventStream) + 轮询双模式
 *
 * 参考图片格式 (顶级 urls 数组):
 *   requestBody.urls = ["https://...", "data:image/jpeg;base64,..."]
 *
 * 流式模式: 通过 EventStream 实时接收进度和结果，超时 300 秒
 * 轮询模式: 提交任务后轮询 /v1/draw/result，最多 60 次，间隔 2 秒
 *
 * 响应取值 (多格式兼容，按优先级):
 *   1. data.results[0].(url|content|image_url)
 *   2. data.url / data.content
 *   3. data.data.url / data.data.results[0].(url|content)
 *
 * 注意:
 *   - 不要与火山方舟的 requestBody.images 或 OpenRouter 的 vision 格式混淆
 *   - 流式模式下需检查 drawData.error 字段判断业务错误
 *   - 轮询模式下 status 字段为 succeeded/failed
 */
import { recordAICall, sanitizeAICallBody } from '../logContext.js';
export async function generateImageWithGrsai(params, apiKey, baseUrl = 'https://grsai.dakka.com.cn') {
    const { prompt, model = 'nano-banana-fast', size = '2K', aspectRatio = 'auto', referenceImages, useStream = true, onProgress } = params;
    // GPT 模型使用专用端点 /v1/draw/completions，其他模型使用 /v1/draw/nano-banana
    const modelLower = (model || '').toLowerCase().trim();
    const isGptModel = modelLower.startsWith('gpt-image') || modelLower.includes('gpt-image');
    const apiEndpoint = isGptModel
        ? `${baseUrl}/v1/draw/completions`
        : `${baseUrl}/v1/draw/nano-banana`;
    console.log(`[Grsai] 模型匹配: model="${model}", modelLower="${modelLower}", isGptModel=${isGptModel}`);
    console.log('Grsai 图片生成请求:', { model, promptLength: prompt.length, size, aspectRatio, useStream, baseUrl, isGptModel, apiEndpoint });
    const requestBody = {
        model,
        prompt,
        aspectRatio,
        imageSize: size,
        shutProgress: false
    };
    if (referenceImages?.length) {
        requestBody.urls = referenceImages;
    }
    console.log('🔑 Grsai API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : '未配置');
    console.log('📡 Grsai API Endpoint:', apiEndpoint);
    const startTime = Date.now();
    // GPT 模型端点可能不支持 SSE 流式，强制使用轮询模式
    const effectiveUseStream = isGptModel ? false : useStream;
    if (isGptModel && useStream) {
        console.log('⚠️ GPT 模型不支持流式模式，自动切换为轮询模式');
    }
    if (effectiveUseStream) {
        const controller = new AbortController();
        const streamTimeout = setTimeout(() => controller.abort(), 300_000);
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
            clearTimeout(streamTimeout);
            throw new Error('无法获取响应流');
        }
        try {
            const decoder = new TextDecoder();
            let buffer = '';
            let lastParsedData = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine)
                        continue;
                    let jsonStr = trimmedLine;
                    if (jsonStr.startsWith('data:')) {
                        jsonStr = jsonStr.substring(5).trim();
                    }
                    if (jsonStr) {
                        try {
                            const data = JSON.parse(jsonStr);
                            lastParsedData = data;
                            if (data.progress !== undefined && onProgress) {
                                onProgress(data.progress);
                            }
                            // 检查无 status 字段的纯错误响应 (如 {"error": "..."})
                            if (!data.status && (data.error || data.message || data.code === -1)) {
                                const errMsg = data.error || data.message || 'Grsai API 返回错误';
                                console.error('Grsai 流式错误响应:', errMsg, '完整数据:', JSON.stringify(data).substring(0, 1000));
                                recordAICall({
                                    provider: 'grsai',
                                    model,
                                    endpoint: apiEndpoint,
                                    requestTime: Date.now() - startTime,
                                    status: 'failed',
                                    errorMessage: errMsg,
                                    requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size }),
                                    responseBody: sanitizeAICallBody(data),
                                });
                                throw new Error(`Grsai API 错误: ${errMsg}`);
                            }
                            if (data.status === 'succeeded') {
                                // 兼容多种返回格式：results数组 或 直接返回url/content
                                let imageUrl = null;
                                if (data.results && data.results.length > 0) {
                                    const result = data.results[0];
                                    imageUrl = result.url || result.content || result.image_url;
                                }
                                else if (data.url) {
                                    imageUrl = data.url;
                                }
                                else if (data.content) {
                                    imageUrl = data.content;
                                }
                                else if (data.data?.url) {
                                    imageUrl = data.data.url;
                                }
                                else if (data.data?.results?.[0]) {
                                    imageUrl = data.data.results[0].url || data.data.results[0].content;
                                }
                                if (imageUrl) {
                                    console.log('Grsai 图片生成成功');
                                    recordAICall({
                                        provider: 'grsai',
                                        model,
                                        endpoint: apiEndpoint,
                                        requestTime: Date.now() - startTime,
                                        status: 'success',
                                        requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size, hasReferenceImages: !!referenceImages }),
                                        responseBody: sanitizeAICallBody({ imageUrl }),
                                    });
                                    return imageUrl;
                                }
                                // succeeded 但没有找到图片URL，记录数据以便排查
                                console.warn('Grsai 返回 succeeded 但未找到图片URL，响应数据:', JSON.stringify(data).substring(0, 500));
                            }
                            if (data.status === 'failed') {
                                const failMsg = data.failure_reason || data.error || data.message || '图片生成失败';
                                console.error('Grsai 图片生成失败:', failMsg);
                                console.error('Grsai 失败完整响应:', JSON.stringify(data).substring(0, 1000));
                                recordAICall({
                                    provider: 'grsai',
                                    model,
                                    endpoint: apiEndpoint,
                                    requestTime: Date.now() - startTime,
                                    status: 'failed',
                                    errorMessage: failMsg,
                                    requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size }),
                                    responseBody: sanitizeAICallBody(data),
                                });
                                // 对无意义错误消息添加上下文
                                const enhancedMsg = (failMsg === 'error' || failMsg === 'Error' || failMsg === 'unknown')
                                    ? `Grsai ${model} 模型生成失败 (端点: ${apiEndpoint})，请检查模型名称和参数是否正确`
                                    : failMsg;
                                throw new Error(enhancedMsg);
                            }
                        }
                        catch (e) {
                            // 区分业务错误和JSON解析错误
                            if (e instanceof SyntaxError) {
                                // JSON 解析失败，忽略非JSON行
                            }
                            else {
                                // 业务错误（如 status=failed），向上抛出
                                throw e;
                            }
                        }
                    }
                }
            }
            // 流结束但未获取到图片，输出最后收到的数据帮助排查
            console.error('Grsai 流式响应结束但未获取到图片，最后收到的数据:', lastParsedData ? JSON.stringify(lastParsedData).substring(0, 500) : '无');
            recordAICall({
                provider: 'grsai',
                model,
                endpoint: apiEndpoint,
                requestTime: Date.now() - startTime,
                status: 'failed',
                errorMessage: '流式响应结束但未获取到图片',
                requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size }),
            });
            throw new Error('流式响应结束但未获取到图片');
        }
        catch (e) {
            if (e.name === 'AbortError') {
                console.error('Grsai 流式图片生成超时（300秒）');
                recordAICall({
                    provider: 'grsai',
                    model,
                    endpoint: apiEndpoint,
                    requestTime: Date.now() - startTime,
                    status: 'timeout',
                    errorMessage: '图片生成超时（300秒），模型处理时间过长',
                    requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size }),
                });
                throw new Error('图片生成超时（300秒），模型处理时间过长');
            }
            throw e;
        }
        finally {
            clearTimeout(streamTimeout);
            reader.releaseLock();
        }
    }
    else {
        const drawResponse = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        if (!drawResponse.ok) {
            const errorText = await drawResponse.text();
            recordAICall({
                provider: 'grsai',
                model,
                endpoint: apiEndpoint,
                requestTime: Date.now() - startTime,
                status: 'failed',
                errorMessage: `HTTP ${drawResponse.status}: ${errorText || drawResponse.statusText}`,
                requestBody: sanitizeAICallBody(requestBody),
            });
            throw new Error(`HTTP ${drawResponse.status}: ${errorText || drawResponse.statusText}`);
        }
        const drawData = await drawResponse.json();
        console.log('Grsai 初始响应 (非流式):', JSON.stringify(drawData).substring(0, 500));
        if (drawData.error) {
            recordAICall({
                provider: 'grsai',
                model,
                endpoint: apiEndpoint,
                requestTime: Date.now() - startTime,
                status: 'failed',
                errorMessage: `Grsai API 错误: ${drawData.error}`,
                requestBody: sanitizeAICallBody(requestBody),
                responseBody: sanitizeAICallBody({ error: drawData.error }),
            });
            throw new Error(`Grsai API 错误: ${drawData.error}`);
        }
        if (drawData.data && (drawData.data.url || drawData.data.content)) {
            const imageUrl = drawData.data.url || drawData.data.content;
            recordAICall({
                provider: 'grsai',
                model,
                endpoint: apiEndpoint,
                requestTime: Date.now() - startTime,
                status: 'success',
                requestBody: sanitizeAICallBody(requestBody),
                responseBody: sanitizeAICallBody({ imageUrl }),
            });
            return imageUrl;
        }
        if (drawData.data && drawData.data.results && drawData.data.results.length > 0) {
            const imgResult = drawData.data.results[0];
            const imageUrl = imgResult.url || imgResult.content;
            if (imageUrl) {
                recordAICall({
                    provider: 'grsai',
                    model,
                    endpoint: apiEndpoint,
                    requestTime: Date.now() - startTime,
                    status: 'success',
                    requestBody: sanitizeAICallBody(requestBody),
                    responseBody: sanitizeAICallBody({ imageUrl }),
                });
                return imageUrl;
            }
        }
        if (drawData.data && typeof drawData.data === 'string' && drawData.data.startsWith('data:')) {
            recordAICall({
                provider: 'grsai',
                model,
                endpoint: apiEndpoint,
                requestTime: Date.now() - startTime,
                status: 'success',
                requestBody: sanitizeAICallBody(requestBody),
            });
            return drawData.data;
        }
        if (drawData.url || drawData.content) {
            const imageUrl = drawData.url || drawData.content;
            recordAICall({
                provider: 'grsai',
                model,
                endpoint: apiEndpoint,
                requestTime: Date.now() - startTime,
                status: 'success',
                requestBody: sanitizeAICallBody(requestBody),
                responseBody: sanitizeAICallBody({ imageUrl }),
            });
            return imageUrl;
        }
        if (drawData.code !== 0 || !drawData.data || !drawData.data.id) {
            recordAICall({
                provider: 'grsai',
                model,
                endpoint: apiEndpoint,
                requestTime: Date.now() - startTime,
                status: 'failed',
                errorMessage: drawData.msg || drawData.message || drawData.error || '绘画请求失败',
                requestBody: sanitizeAICallBody(requestBody),
                responseBody: sanitizeAICallBody({ msg: drawData.msg, error: drawData.error }),
            });
            throw new Error(drawData.msg || drawData.message || drawData.error || '绘画请求失败');
        }
        const taskId = drawData.data.id;
        console.log('Grsai 任务ID:', taskId);
        const maxAttempts = 60;
        const interval = 2000;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));
            const resultResponse = await fetch(`${baseUrl}/v1/draw/result`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: taskId })
            });
            const resultData = await resultResponse.json();
            if (resultData.code === 0 && resultData.data) {
                const result = resultData.data;
                if (result.progress !== undefined && onProgress) {
                    onProgress(result.progress);
                }
                if (result.status === 'succeeded' && result.results && result.results.length > 0) {
                    const imgResult = result.results[0];
                    const imageUrl = imgResult.url || imgResult.content;
                    if (imageUrl) {
                        console.log('Grsai 图片生成成功');
                        recordAICall({
                            provider: 'grsai',
                            model,
                            endpoint: apiEndpoint,
                            requestTime: Date.now() - startTime,
                            status: 'success',
                            pollAttempts: attempt + 1,
                            taskId,
                            requestBody: sanitizeAICallBody(requestBody),
                            responseBody: sanitizeAICallBody({ imageUrl }),
                        });
                        return imageUrl;
                    }
                }
                if (result.status === 'failed') {
                    // 对无意义错误消息添加上下文（与流式模式保持一致）
                    const failMsg = result.failure_reason || result.error || '图片生成失败';
                    const enhancedMsg = (failMsg === 'error' || failMsg === 'Error' || failMsg === 'unknown')
                        ? `Grsai ${model} 模型生成失败 (端点: ${apiEndpoint}, taskId: ${taskId})，请检查模型名称和参数是否正确`
                        : failMsg;
                    console.error('Grsai 轮询图片生成失败:', enhancedMsg, '完整响应:', JSON.stringify(resultData).substring(0, 1000));
                    recordAICall({
                        provider: 'grsai',
                        model,
                        endpoint: apiEndpoint,
                        requestTime: Date.now() - startTime,
                        status: 'failed',
                        errorMessage: enhancedMsg,
                        pollAttempts: attempt + 1,
                        taskId,
                        requestBody: sanitizeAICallBody(requestBody),
                        responseBody: sanitizeAICallBody({ failure_reason: result.failure_reason, error: result.error }),
                    });
                    throw new Error(enhancedMsg);
                }
            }
            else {
                if (resultData.code !== 0) {
                    const errorMsg = resultData.msg || resultData.message || 'apikey error';
                    const enhancedMsg = (errorMsg === 'error' || errorMsg === 'Error' || errorMsg === 'unknown')
                        ? `Grsai ${model} 模型轮询结果失败 (端点: ${apiEndpoint}, taskId: ${taskId})，请检查 API Key 和模型配置`
                        : errorMsg;
                    console.error('Grsai 轮询结果错误:', enhancedMsg, '完整响应:', JSON.stringify(resultData).substring(0, 1000));
                    recordAICall({
                        provider: 'grsai',
                        model,
                        endpoint: apiEndpoint,
                        requestTime: Date.now() - startTime,
                        status: 'failed',
                        errorMessage: enhancedMsg,
                        pollAttempts: attempt + 1,
                        taskId,
                        requestBody: sanitizeAICallBody(requestBody),
                        responseBody: sanitizeAICallBody({ msg: resultData.msg, code: resultData.code }),
                    });
                    throw new Error(enhancedMsg);
                }
            }
        }
        recordAICall({
            provider: 'grsai',
            model,
            endpoint: apiEndpoint,
            requestTime: Date.now() - startTime,
            status: 'timeout',
            pollAttempts: maxAttempts,
            taskId,
            requestBody: sanitizeAICallBody(requestBody),
        });
        throw new Error('图片生成超时');
    }
}
export async function getGrsaiResult(taskId, apiKey, baseUrl = 'https://grsai.dakka.com.cn') {
    console.log('Grsai 获取结果:', { taskId, baseUrl });
    const response = await fetch(`${baseUrl}/v1/draw/result`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId })
    });
    const data = await response.json();
    console.log('Grsai 结果查询响应:', data);
    if (data.code !== 0) {
        throw new Error(data.msg || '查询结果失败');
    }
    const result = data.data;
    return {
        status: result.status,
        url: result.results?.[0]?.url,
        content: result.results?.[0]?.content,
        progress: result.progress,
        failureReason: result.failure_reason,
        error: result.error
    };
}
