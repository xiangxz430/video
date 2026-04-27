import { Router } from 'express';
import { splitScriptWithConfig, generateScriptWithFallback, extractEpisodesFromScript } from '../services/scriptSplitting.js';
import { createApiConfig } from '../services/apiClients.js';

const router = Router();

// POST /api/script/split - 拆分剧本
router.post('/split', async (req, res) => {
  try {
    const { script, episodeCount, provider, model } = req.body;
    
    if (!script) {
      return res.status(400).json({ error: '缺少剧本内容' });
    }

    let result;
    
    if (provider) {
      // 使用指定的 provider
      const config = createApiConfig(provider, model);
      if (episodeCount && episodeCount > 1) {
        // 需要按集拆分
        const episodes = await extractEpisodesFromScript(script, episodeCount, config);
        const splitResult = await splitScriptWithConfig(script, config);
        result = {
          ...splitResult,
          episodes: episodes.map(ep => ({
            title: ep.title,
            episodeNumber: ep.episodeNumber,
            content: ep.content
          }))
        };
      } else {
        result = await splitScriptWithConfig(script, config);
      }
    } else {
      // 使用默认配置（自动 fallback）
      result = await splitScriptWithConfig(script, createApiConfig('deepseek'));
    }

    res.json({
      characters: result.characters,
      scenes: result.scenes,
      episodes: result.episodes
    });
  } catch (error: any) {
    console.error('Script split error:', error);
    res.status(500).json({ error: error.message || '剧本拆分失败' });
  }
});

// POST /api/script/generate - 生成脚本
router.post('/generate', async (req, res) => {
  try {
    const { prompt, systemPrompt, provider, model } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: '缺少提示词' });
    }

    let result;
    
    if (provider) {
      // 使用指定的 provider
      const config = createApiConfig(provider, model);
      const content = systemPrompt 
        ? await generateScriptWithFallback(prompt, systemPrompt, [config])
        : await generateScriptWithFallback(prompt, undefined, [config]);
      result = content;
    } else {
      // 使用默认配置（自动 fallback）
      result = await generateScriptWithFallback(prompt, systemPrompt);
    }

    res.json({
      content: result.content,
      provider: result.provider,
      providerName: result.providerName
    });
  } catch (error: any) {
    console.error('Script generate error:', error);
    res.status(500).json({ error: error.message || '脚本生成失败' });
  }
});

export { router as scriptRouter };
