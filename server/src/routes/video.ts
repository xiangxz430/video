import { Router } from 'express';
import { generateVideo, submitVolcVideoTask, waitForVolcVideo, queryVolcVideoTask } from '../services/videoGen.js';
import { createApiConfig } from '../services/apiClients.js';

const router = Router();

// POST /api/video/generate - SSE 流式生成视频
router.post('/generate', async (req, res) => {
  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  try {
    const { 
      prompt, 
      provider, 
      model, 
      firstFrameImage, 
      lastFrameImage, 
      referenceImages,
      aspectRatio,
      duration,
      enableAudio
    } = req.body;
    
    if (!prompt) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: '缺少提示词' })}\n\n`);
      res.end();
      return;
    }

    const config = provider 
      ? createApiConfig(provider, model)
      : createApiConfig('volcengine');

    // 检查 provider 类型，决定使用轮询还是直接生成
    const providerLower = (provider || 'volcengine').toLowerCase();
    
    if (providerLower === 'volcengine' || providerLower === 'volc' || providerLower === 'ark') {
      // 火山引擎使用提交+轮询模式
      try {
        // 提交任务
        res.write(`event: progress\ndata: ${JSON.stringify({ phase: 'submitting', message: '提交视频生成任务...' })}\n\n`);
        
        const { taskId, mode } = await submitVolcVideoTask({
          prompt,
          firstFrameImage,
          lastFrameImage,
          referenceImages,
          aspectRatio,
          duration,
          enableAudio
        }, config);
        
        res.write(`event: progress\ndata: ${JSON.stringify({ phase: 'submitted', taskId, mode, message: `任务已提交，ID: ${taskId}` })}\n\n`);
        
        // 轮询等待结果
        const videoUrl = await waitForVolcVideo(
          taskId,
          config,
          120, // maxRetries
          5000, // intervalMs
          (status, attempt) => {
            res.write(`event: progress\ndata: ${JSON.stringify({ 
              phase: 'polling', 
              status, 
              attempt,
              message: `正在生成视频... (${attempt}/120) 状态: ${status}` 
            })}\n\n`);
          }
        );
        
        // 发送完成事件
        res.write(`event: done\ndata: ${JSON.stringify({ videoUrl, taskId })}\n\n`);
        res.end();
      } catch (error: any) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || '视频生成失败' })}\n\n`);
        res.end();
      }
    } else {
      // 其他 provider（GRSai, OpenRouter）使用带进度回调的生成
      const onProgress = (progress: number | string) => {
        const progressValue = typeof progress === 'number' ? progress : 0;
        const status = typeof progress === 'string' ? progress : 'processing';
        res.write(`event: progress\ndata: ${JSON.stringify({ 
          phase: 'generating', 
          progress: progressValue,
          status,
          message: typeof progress === 'number' ? `生成进度: ${progress}%` : `状态: ${progress}` 
        })}\n\n`);
      };
      
      const videoUrl = await generateVideo({
        prompt,
        firstFrameImage,
        lastFrameImage,
        referenceImages,
        aspectRatio,
        duration,
        enableAudio
      }, config, onProgress);
      
      // 发送完成事件
      res.write(`event: done\ndata: ${JSON.stringify({ videoUrl })}\n\n`);
      res.end();
    }
  } catch (error: any) {
    console.error('Video generate error:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || '视频生成失败' })}\n\n`);
    res.end();
  }
});

// POST /api/video/query - 查询视频任务状态
router.post('/query', async (req, res) => {
  try {
    const { taskId, provider, model } = req.body;
    
    if (!taskId) {
      return res.status(400).json({ error: '缺少任务ID' });
    }

    const config = provider 
      ? createApiConfig(provider, model)
      : createApiConfig('volcengine');

    const result = await queryVolcVideoTask(taskId, config);
    
    res.json(result);
  } catch (error: any) {
    console.error('Video query error:', error);
    res.status(500).json({ error: error.message || '查询视频任务失败' });
  }
});

export { router as videoRouter };
