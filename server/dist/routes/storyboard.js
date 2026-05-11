import { Router } from 'express';
import { generateStoryboardScript, splitShotsSimple, enrichEachShot } from '../services/storyboardGen.js';
import { createApiConfig } from '../services/apiClients.js';
const router = Router();
// POST /api/storyboard/generate - SSE 流式生成分镜
router.post('/generate', async (req, res) => {
    // 禁用 socket 超时，允许长耗时分镜生成
    req.setTimeout(0);
    res.setTimeout(0);
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        const { episodeContent, characters, scenes, provider, model, options } = req.body;
        if (!episodeContent) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: '缺少剧本内容' })}\n\n`);
            res.end();
            return;
        }
        const config = provider
            ? createApiConfig(provider, model)
            : createApiConfig('deepseek');
        // 发送进度回调
        const onProgress = (message, step, totalSteps) => {
            res.write(`event: progress\ndata: ${JSON.stringify({ phase: step === 1 ? 'splitting' : 'enriching', current: step, total: totalSteps, message })}\n\n`);
        };
        // 发送内容流回调
        const onContentStream = (chunk) => {
            res.write(`event: content\ndata: ${JSON.stringify({ chunk })}\n\n`);
        };
        // 生成分镜
        const shots = await generateStoryboardScript(episodeContent, characters || [], scenes || [], config, onProgress, onContentStream);
        // 发送完成事件
        res.write(`event: done\ndata: ${JSON.stringify({ shots })}\n\n`);
        res.end();
    }
    catch (error) {
        const errorDetail = error?.message || error?.toString() || '分镜生成失败（未知原因）';
        console.error('Storyboard generate error:', errorDetail, error?.stack);
        res.write(`event: error\ndata: ${JSON.stringify({ message: errorDetail })}\n\n`);
        res.end();
    }
});
// POST /api/storyboard/split - 分阶段: 仅镜头划分
router.post('/split', async (req, res) => {
    // 禁用 socket 超时
    req.setTimeout(0);
    res.setTimeout(0);
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        const { episodeContent, characters, scenes, provider, model, options } = req.body;
        if (!episodeContent) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: '缺少剧本内容' })}\n\n`);
            res.end();
            return;
        }
        const config = provider
            ? createApiConfig(provider, model)
            : createApiConfig('deepseek');
        const characterInfo = (characters || []).map((c) => `${c.name}: ${typeof c.description === 'object' ? JSON.stringify(c.description) : c.description}`).join('\n');
        const sceneInfo = (scenes || []).map((s) => `${s.name}: ${typeof s.description === 'object' ? JSON.stringify(s.description) : s.description}`).join('\n');
        // 发送进度回调
        const onProgress = (message, step, totalSteps) => {
            res.write(`event: progress\ndata: ${JSON.stringify({ phase: 'splitting', current: step, total: totalSteps, message })}\n\n`);
        };
        // 发送内容流回调
        const onContentStream = (chunk) => {
            res.write(`event: content\ndata: ${JSON.stringify({ chunk })}\n\n`);
        };
        onProgress('🎯 正在分析剧本并划分镜头结构...', 1, 1);
        const shots = await splitShotsSimple(episodeContent, characterInfo, sceneInfo, config, onContentStream);
        onProgress(`✅ 划分完成!共 ${shots.length} 个镜头`, 1, 1);
        // 发送完成事件
        res.write(`event: done\ndata: ${JSON.stringify({ shots })}\n\n`);
        res.end();
    }
    catch (error) {
        const errorDetail = error?.message || error?.toString() || '镜头划分失败（未知原因）';
        console.error('Storyboard split error:', errorDetail, error?.stack);
        res.write(`event: error\ndata: ${JSON.stringify({ message: errorDetail })}\n\n`);
        res.end();
    }
});
// POST /api/storyboard/enrich-batch - 分阶段: 批量完善镜头
router.post('/enrich-batch', async (req, res) => {
    // 禁用 socket 超时
    req.setTimeout(0);
    res.setTimeout(0);
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        const { episodeContent, characters, scenes, shots, batchRange, usedContents, provider, model } = req.body;
        if (!shots || !Array.isArray(shots)) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: '缺少镜头数据' })}\n\n`);
            res.end();
            return;
        }
        if (!batchRange || typeof batchRange.start !== 'number' || typeof batchRange.end !== 'number') {
            res.write(`event: error\ndata: ${JSON.stringify({ message: '缺少 batchRange 参数' })}\n\n`);
            res.end();
            return;
        }
        const config = provider
            ? createApiConfig(provider, model)
            : createApiConfig('deepseek');
        const characterInfo = (characters || []).map((c) => `${c.name}: ${typeof c.description === 'object' ? JSON.stringify(c.description) : c.description}`).join('\n');
        const sceneInfo = (scenes || []).map((s) => `${s.name}: ${typeof s.description === 'object' ? JSON.stringify(s.description) : s.description}`).join('\n');
        // 发送进度回调
        const onProgress = (message, step, totalSteps) => {
            res.write(`event: progress\ndata: ${JSON.stringify({ phase: 'enriching', current: step, total: totalSteps, message })}\n\n`);
        };
        // 发送内容流回调
        const onContentStream = (chunk) => {
            res.write(`event: content\ndata: ${JSON.stringify({ chunk })}\n\n`);
        };
        const { enrichedShots, usedContents: updatedUsedContents } = await enrichEachShot(shots, episodeContent || '', characterInfo, sceneInfo, config, onProgress, onContentStream, batchRange.start, batchRange.end, usedContents, true // throwOnFail: 批量完善时失败即抛出，避免静默降级
        );
        // 发送完成事件
        res.write(`event: done\ndata: ${JSON.stringify({ enrichedShots, usedContents: updatedUsedContents })}\n\n`);
        res.end();
    }
    catch (error) {
        const errorDetail = error?.message || error?.toString() || '镜头完善失败（未知原因）';
        console.error('Storyboard enrich-batch error:', errorDetail, error?.stack);
        res.write(`event: error\ndata: ${JSON.stringify({ message: errorDetail })}\n\n`);
        res.end();
    }
});
export { router as storyboardRouter };
