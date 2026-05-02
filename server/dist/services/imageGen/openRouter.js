import { recordAICall, sanitizeAICallBody } from '../logContext.js';
export async function generateImageWithOpenRouter(params, config) {
    const { prompt, aspectRatio, size, referenceImages } = params;
    const model = config.model || 'black-forest-labs/flux.2-pro';
    const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    const endpoint = `${baseUrl}/chat/completions`;
    const startTime = Date.now();
    console.log('OpenRouter 图片生成请求:', { model, promptLength: prompt.length });
    // 构建 content 数组
    const content = [{ type: 'text', text: prompt }];
    // 添加参考图片（统一数组格式）
    if (referenceImages?.length) {
        for (const img of referenceImages) {
            if (img) {
                content.push({
                    type: 'image_url',
                    image_url: { url: img }
                });
            }
        }
    }
    const requestBody = {
        model: model,
        messages: [
            {
                role: 'user',
                content: content
            }
        ],
        modalities: ['image']
    };
    if (aspectRatio || size) {
        requestBody.image_config = {};
        if (aspectRatio) {
            requestBody.image_config.aspect_ratio = aspectRatio;
        }
        if (size) {
            requestBody.image_config.image_size = size;
        }
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'HTTP-Referer': 'https://video-generator.app',
            'X-Title': 'Video Generator'
        },
        body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API 请求失败: ${response.status} ${errorText}`);
    }
    const result = await response.json();
    console.log('OpenRouter 图片生成结果:', result);
    if (result.error) {
        throw new Error(`OpenRouter 错误: ${result.error.message || JSON.stringify(result.error)}`);
    }
    if (result.choices?.[0]?.message?.images && result.choices[0].message.images.length > 0) {
        const imageUrl = result.choices[0].message.images[0]?.image_url?.url;
        if (imageUrl) {
            console.log('OpenRouter 图片生成成功');
            recordAICall({
                provider: 'openrouter',
                model,
                endpoint,
                requestTime: Date.now() - startTime,
                status: 'success',
                requestBody: sanitizeAICallBody({ model, prompt: prompt.slice(0, 200), modalities: ['image'] }),
                responseBody: sanitizeAICallBody({ hasImage: true }),
            });
            return imageUrl;
        }
    }
    recordAICall({
        provider: 'openrouter',
        model,
        endpoint,
        requestTime: Date.now() - startTime,
        status: 'failed',
        errorMessage: 'OpenRouter 返回格式错误,未找到生成的图片',
        requestBody: sanitizeAICallBody({ model, prompt: prompt.slice(0, 200), modalities: ['image'] }),
    });
    throw new Error('OpenRouter 返回格式错误,未找到生成的图片');
}
