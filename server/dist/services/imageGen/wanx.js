import { recordAICall, sanitizeAICallBody } from '../logContext.js';
export async function submitWanxTask(config, prompt) {
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
    const model = config.model || 'wanx-v1';
    const endpoint = `${baseUrl}/services/aigc/text2image/image-synthesis`;
    const startTime = Date.now();
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'X-DashScope-Async': 'enable'
            },
            body: JSON.stringify({
                model,
                input: { prompt },
                parameters: {
                    size: '768*1024',
                    n: 1,
                    style: '<auto>'
                }
            })
        });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`图片生成任务提交失败 (${response.status}): ${errText}`);
        }
        const data = await response.json();
        const taskId = data.output.task_id;
        const reqBody = { model, input: { prompt }, parameters: { size: '768*1024', n: 1, style: '<auto>' } };
        recordAICall({
            provider: 'qwen',
            model,
            endpoint,
            requestTime: Date.now() - startTime,
            status: 'success',
            taskId,
            requestBody: sanitizeAICallBody(reqBody),
            responseBody: sanitizeAICallBody({ taskId, taskStatus: data.output.task_status }),
        });
        return taskId;
    }
    catch (error) {
        const reqBody = { model, input: { prompt }, parameters: { size: '768*1024', n: 1, style: '<auto>' } };
        recordAICall({
            provider: 'qwen',
            model,
            endpoint,
            requestTime: Date.now() - startTime,
            status: 'failed',
            errorMessage: error.message || '未知错误',
            requestBody: sanitizeAICallBody(reqBody),
        });
        throw error;
    }
}
async function queryWanxTask(config, taskId) {
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
    const response = await fetch(`${baseUrl}/tasks/${taskId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${config.apiKey}`
        }
    });
    if (!response.ok) {
        throw new Error(`查询任务失败 (${response.status})`);
    }
    const data = await response.json();
    if (data.output.task_status === 'SUCCEEDED') {
        return data.output.results?.[0]?.url || null;
    }
    else if (data.output.task_status === 'FAILED') {
        throw new Error('图片生成失败');
    }
    return null;
}
export async function waitForWanxTask(config, taskId, maxRetries = 30) {
    const startTime = Date.now();
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
    for (let i = 0; i < maxRetries; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const url = await queryWanxTask(config, taskId);
        if (url) {
            recordAICall({
                provider: 'qwen',
                model: config.model || 'wanx-v1',
                endpoint: `${baseUrl}/tasks/${taskId}`,
                requestTime: Date.now() - startTime,
                status: 'success',
                pollAttempts: i + 1,
                taskId,
                responseBody: sanitizeAICallBody({ imageUrl: url }),
            });
            return url;
        }
    }
    recordAICall({
        provider: 'qwen',
        model: config.model || 'wanx-v1',
        endpoint: `${baseUrl}/tasks/${taskId}`,
        requestTime: Date.now() - startTime,
        status: 'timeout',
        pollAttempts: maxRetries,
        taskId,
        responseBody: sanitizeAICallBody({ maxRetries }),
    });
    throw new Error('图片生成超时');
}
