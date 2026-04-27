import { Router } from 'express';
import { generateStoryboardScript } from '../services/storyboardGen.js';
import { createApiConfig } from '../services/apiClients.js';

const router = Router();

// POST /api/storyboard/generate - SSE 流式生成分镜
router.post('/generate', async (req, res) => {
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
    const onProgress = (message: string, step?: number, totalSteps?: number) => {
      res.write(`event: progress\ndata: ${JSON.stringify({ phase: step === 1 ? 'splitting' : 'enriching', current: step, total: totalSteps, message })}\n\n`);
    };

    // 发送内容流回调
    const onContentStream = (chunk: string) => {
      res.write(`event: content\ndata: ${JSON.stringify({ chunk })}\n\n`);
    };

    // 生成分镜
    const shots = await generateStoryboardScript(
      episodeContent,
      characters || [],
      scenes || [],
      config,
      onProgress,
      onContentStream
    );

    // 发送完成事件
    res.write(`event: done\ndata: ${JSON.stringify({ shots })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error('Storyboard generate error:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || '分镜生成失败' })}\n\n`);
    res.end();
  }
});

export { router as storyboardRouter };
