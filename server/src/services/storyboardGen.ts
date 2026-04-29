/**
 * AI 分镜脚本生成模块
 * 生成扁平的镜头列表(每个镜头 = 一个分镜/segment)
 */
import type { ApiConfig, Shot, StoryboardProgressCallback } from '../types/index.js';
import { callAI, callOpenAIStreaming } from './apiClients.js';
import { recordAICall } from './logContext.js';

// 计算两段文本的相似度（0-1，基于共同子串）
function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length === 0) return 0;
  
  let matches = 0;
  const windowSize = Math.min(4, shorter.length);
  const longerStr = longer;
  for (let i = 0; i <= shorter.length - windowSize; i++) {
    const sub = shorter.substring(i, i + windowSize);
    if (longerStr.includes(sub)) matches++;
  }
  const total = shorter.length - windowSize + 1;
  return total > 0 ? matches / total : 0;
}

// ========== 主入口: 生成分镜脚本 ==========

export async function generateStoryboardScript(
  episodeContent: string,
  characters: Array<{ name: string; description: string }>,
  scenes: Array<{ name: string; description: string }>,
  config: ApiConfig,
  onProgress?: StoryboardProgressCallback,
  onContentStream?: (content: string) => void
): Promise<Shot[]> {
  console.log('\n\n========================================');
  console.log('🎬 开始生成分镜脚本(扁平镜头列表)');
  console.log('========================================');
  console.log(`📖 剧本内容长度: ${episodeContent.length} 字符`);
  console.log(`👥 角色数量: ${characters.length}`);
  console.log(`🎭 场景数量: ${scenes.length}`);
  console.log(`🤖 使用模型: ${config.provider}/${config.model}`);
  console.log('========================================\n');
  
  const characterInfo = characters.map(c => `${c.name}: ${typeof c.description === 'object' ? JSON.stringify(c.description) : c.description}`).join('\n');
  const sceneInfo = scenes.map(s => `${s.name}: ${typeof s.description === 'object' ? JSON.stringify(s.description) : s.description}`).join('\n');
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' 步骤 1/2: 划分镜头结构');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  onProgress?.('🎯 步骤 1/2: 正在分析剧本并划分镜头结构...', 1, 2);
  
  let streamedContent = '';
  const handleStreamChunk = (chunk: string) => {
    streamedContent += chunk;
    if (onContentStream) {
      onContentStream(chunk);
    }
  };
  
  const shotStructure = await splitShotsSimple(episodeContent, characterInfo, sceneInfo, config, handleStreamChunk);
  console.log(`✅ 步骤 1 完成: 划分了 ${shotStructure.length} 个镜头`);
  onProgress?.(`✅ 划分完成!共 ${shotStructure.length} 个镜头`, 1, 2);
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' 步骤 2/2: 逐个镜头完善设计');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  onProgress?.('🎨 步骤 2/2: 正在逐个镜头完善设计(添加摄影参数、台词、声音等)...', 2, 2);
  const enrichedShots = await enrichEachShot(shotStructure, episodeContent, characterInfo, sceneInfo, config, onProgress, onContentStream);
  console.log(`✅ 步骤 2 完成: 完善了 ${enrichedShots.length} 个镜头`);
  onProgress?.(`✅ 所有镜头设计完成!共 ${enrichedShots.length} 个镜头`, 2, 2);
  
  onContentStream?.('\n🔍 正在检测镜头内容重复...\n');
  
  const duplicatePairs: Array<{i: number, j: number, sim: number}> = [];
  for (let i = 0; i < enrichedShots.length; i++) {
    for (let j = i + 1; j < enrichedShots.length; j++) {
      const desc1 = enrichedShots[i].description || '';
      const desc2 = enrichedShots[j].description || '';
      if (desc1.length > 30 && desc2.length > 30) {
        const sim = textSimilarity(desc1, desc2);
        if (sim > 0.8) {
          duplicatePairs.push({i, j, sim});
          onContentStream?.(`⚠️ 镜头${enrichedShots[i].shotNumber}和镜头${enrichedShots[j].shotNumber}描述相似度${(sim*100).toFixed(0)}%\n`);
        }
      }
    }
  }
  
  if (duplicatePairs.length > 0) {
    onContentStream?.(`\n🔄 发现${duplicatePairs.length}组重复，正在自动修复...\n`);
    
    for (const dup of duplicatePairs) {
      const targetShot = enrichedShots[dup.j];
      const refShot = enrichedShots[dup.i];
      
      onContentStream?.(`  重新生成镜头${targetShot.shotNumber}...\n`);
      
      const regenStartTime = Date.now();
      try {
        const regenPrompt = `这个镜头的描述与镜头${refShot.shotNumber}高度重复，请完全重新设计。

【被重复的内容 - 严禁再次使用】
${refShot.description}

【该镜头对应的原文段落】
${targetShot.narrationSource || targetShot.description}

【要求】
1. 必须使用与上述"被重复内容"完全不同的表述
2. 从该镜头对应的原文段落中提取不同的细节来展开
3. 如果原文段落相同，则从不同角度（环境、动作、情绪、光线等）来设计画面
4. 返回完整JSON：{"description":"...", "action":"...", "cameraMovement":"...", "shotType":"...", "cameraAngle":"..."}`;

        const response = await callAI(config, [
          { role: 'system', content: '你是专业导演。该镜头与前面的镜头重复，请设计完全不同的画面内容。返回JSON。' },
          { role: 'user', content: regenPrompt }
        ]);
        
        recordAICall({
          provider: config.provider || 'unknown',
          model: config.model || '',
          endpoint: `${config.baseUrl || ''}/chat/completions`,
          requestTime: Date.now() - regenStartTime,
          status: 'success'
        });
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const newData = JSON.parse(jsonMatch[0]);
          if (newData.description && newData.description !== refShot.description) {
            enrichedShots[dup.j] = { ...targetShot, ...newData };
            onContentStream?.(`  ✅ 镜头${targetShot.shotNumber}已重新生成\n`);
          }
        }
      } catch (err) {
        onContentStream?.(`  ⚠️ 镜头${targetShot.shotNumber}重新生成失败，保留原内容\n`);
        recordAICall({
          provider: config.provider || 'unknown',
          model: config.model || '',
          endpoint: `${config.baseUrl || ''}/chat/completions`,
          requestTime: Date.now() - regenStartTime,
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : '重新生成失败'
        });
      }
    }
  } else {
    onContentStream?.('✅ 未检测到重复内容\n');
  }
  
  logFinalResult(enrichedShots);
  return enrichedShots;
}

function logFinalResult(shots: Shot[]) {
  console.log('\n🎉 分镜脚本生成完成！');
  console.log(`📊 最终结果: ${shots.length} 个镜头`);
  shots.forEach((shot, idx) => {
    console.log(`  镜头 ${idx + 1}: ${shot.scene} - ${shot.description?.substring(0, 30)}...`);
  });
  console.log('========================================\n\n');
}

// ========== 辅助函数 1: 简单镜头结构划分 ==========

async function splitShotsSimple(
  episodeContent: string,
  characterInfo: string,
  sceneInfo: string,
  config: ApiConfig,
  onContentStream?: (chunk: string) => void
): Promise<Shot[]> {
  const prompt = `请分析剧本，按镜头划分分镜结构。

【剧本】
${episodeContent}

【要求】
1. 把剧本拆分成多个镜头（每个镜头 = 一个视频片段）
2. 每个镜头 5-10 秒
3. 相邻镜头可能在同一场景，也可能切换场景
4. 只返回JSON，不要其他内容

【返回格式】
[
  {"shotNumber":1,"duration":5,"description":"一句话描述画面","action":"一句话描述动作","characters":["角色名"],"scene":"场景名称","narrationSource":"该镜头对应的原文原句"},
  {"shotNumber":2,"duration":5,"description":"一句话","action":"一句话","characters":["角色名"],"scene":"场景名称","narrationSource":"该镜头对应的原文原句"}
]

【注意】
- description 和 action 只需一句话概括，不要详细描述
- 详细描述会在后续步骤中设计
- 确保 JSON 完整，不要截断
- 镜头之间要有连贯性
- 每个镜头必须对应原文中不同的段落或句子，严禁多个镜头引用同一段内容
- 镜头按原文顺序排列，每个镜头的 narration/dialogue 必须是原文中连续且不重叠的部分
- 原文内容应尽量完整分配到各镜头中，不遗漏不重复
- narrationSource 字段必须标注该镜头对应的原文段落，必须是原文中连续且不重叠的部分
- 每个镜头的 narrationSource 必须完全不同，严禁重复

返回JSON：`;

  let content: string;
  
  onContentStream?.(`\n[使用模型: ${config.model} (${config.provider})]\n`);
  
  const callStartTime = Date.now();
  const endpoint = `${config.baseUrl || ''}/chat/completions`;
  
  if (onContentStream && (config.provider === 'deepseek' || config.provider === 'openai')) {
    content = await callOpenAIStreaming(config, [
      { role: 'system', content: '你是分镜助手。请划分镜头结构，返回简短JSON。每个镜头的描述限制在一句话以内。' },
      { role: 'user', content: prompt }
    ], onContentStream);
  } else {
    content = await callAI(config, [
      { role: 'system', content: '你是分镜助手。请划分镜头结构，返回简短JSON。每个镜头的描述限制在一句话以内。' },
      { role: 'user', content: prompt }
    ]);
  }
  
  recordAICall({
    provider: config.provider || 'unknown',
    model: config.model || '',
    endpoint,
    requestTime: Date.now() - callStartTime,
    status: 'success'
  });

  const shots = parseStoryboardJSON(content);
  return shots.map((shot: any, idx: number) => ({
    ...shot,
    shotNumber: idx + 1
  }));
}

// ========== 辅助函数 2: 逐个镜头完善设计 ==========

async function enrichEachShot(
  shots: Shot[],
  episodeContent: string,
  characterInfo: string,
  sceneInfo: string,
  config: ApiConfig,
  onProgress?: StoryboardProgressCallback,
  onContentStream?: (content: string) => void
): Promise<Shot[]> {
  const enriched: Shot[] = [];
  const usedContents: Array<{
    shotNumber: number;
    description?: string;
    action?: string;
    dialogue?: string;
  }> = [];
  
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    console.log(`  [镜头 ${i + 1}/${shots.length}] 完善设计...`);
    onProgress?.(`🎬 正在设计第 ${i + 1}/${shots.length} 个镜头...`, 2, 2);
    
    let usedContentHint = '';
    if (usedContents.length > 0) {
      const usedList = usedContents.map((item) => {
        const parts = [];
        if (item.description) parts.push(`描述: ${item.description}`);
        if (item.action) parts.push(`动作: ${item.action}`);
        if (item.dialogue) parts.push(`台词: ${item.dialogue}`);
        return `镜头${item.shotNumber}: ${parts.join(' | ')}`;
      }).join('\n');
      
      usedContentHint = `\n\n【已分配内容 - 严禁重复使用】\n以下内容已分配给前面的镜头，你必须使用完全不同的原文段落，严禁使用相同或相似的措辞：\n${usedList}\n\n请从原文中选择尚未被任何镜头使用的段落来设计当前镜头。`;
    }
    
    const shotNarration = shot.narrationSource || shot.description || '';

    let prevShotContext = '';
    if (i > 0) {
      const prev = enriched[i - 1] || shots[i - 1];
      prevShotContext = `\n【前一个镜头（镜头${prev.shotNumber || i}）- 请确保与之自然衔接】
画面: ${prev.description || '(无)'}
动作: ${prev.action || '(无)'}
镜头类型: ${prev.shotType || '(无)'}
运镜: ${prev.cameraMovement || '(无)'}`;
    }

    let nextShotContext = '';
    if (i < shots.length - 1) {
      const next = shots[i + 1];
      nextShotContext = `\n【下一个镜头（镜头${next.shotNumber || i + 2}）- 请为过渡做好准备】
原文段落: ${next.narrationSource || next.description || '(无)'}
场景: ${next.scene || '(无)'}`;
    }

    const prompt = `请设计这个镜头的完整分镜。从原剧本中提取详细内容,不要压缩缩写。

【这个镜头的基本信息】
镜头编号: ${shot.shotNumber}
场景: ${shot.scene}
当前描述: ${shot.description}
动作: ${shot.action}
出场角色: ${shot.characters?.join(', ')}

【该镜头对应的原文段落 - 必须仅从这里提取内容】
${shotNarration}
${prevShotContext}
${nextShotContext}

【完整原剧本 - 仅供理解上下文，严禁从其他镜头的段落中提取内容】
${episodeContent}

【角色信息】
${characterInfo}

【场景信息】
${sceneInfo}
${usedContentHint}

【设计要求】
1. description（画面描述，至少50字）：必须基于"该镜头对应的原文段落"展开设计，从原文中提取环境、场景、光影、色彩、空间布局等视觉信息，描述画面构图和氛围
2. action（角色动作，至少30字）：必须基于"该镜头对应的原文段落"展开设计，从原文中提取角色的具体动作、表情变化、肢体语言、移动路线，不要重复 description 中的环境描述
3. description 和 action 必须仅基于"该镜头对应的原文段落"展开设计，严禁引用其他段落的内容
4. description 和 action 必须互补，不能重复同一内容
5. 补充完整的摄影参数(shotType、cameraAngle、cameraMovement、lens、composition、lighting)
6. 如果有台词,提取完整 dialogue 信息
7. 补充声音设计(audio)
8. 绝对禁止压缩缩写
9. 确保返回的 JSON 完整,不要截断

【严格去重要求】
- 每个镜头必须对应原文中不同的段落，严禁两个镜头使用相同的原文内容
- 当前镜头必须仅使用"该镜头对应的原文段落"中的内容来设计，严禁从其他段落提取内容
- 如果发现当前镜头的描述与已分配内容相似，必须选择原文中其他未使用的段落
- description和action中不得出现已分配内容中已有的句子或短语

【镜头连续性要求】
- 如果有前一个镜头信息，当前镜头的开场应与前一镜头的结尾自然衔接
- 运镜设计要考虑前后镜头的过渡流畅性（如前镜头以推镜结束，当前镜头可以全景开始）
- 保持角色位置、光线方向、情绪基调的连续性
- 如果有下一个镜头信息，当前镜头的结尾应为下一镜头的过渡留有空间

【当前JSON结构】
${JSON.stringify(shot, null, 2)}

【返回格式】
返回完善后的完整JSON镜头对象。确保 JSON 完整,最后一个字符是 }`;

    let success = false;
    let maxRetries = 2;
    
    for (let retry = 0; retry < maxRetries && !success; retry++) {
      if (retry > 0) {
        console.log(`    🔄 第 ${retry} 次重试...`);
        onProgress?.(`🔄 第 ${i + 1}/${shots.length} 个镜头第 ${retry} 次重试...`, 2, 2);
      }
      
      const shotStartTime = Date.now();
      try {
        let aiResponse: string;
        const endpoint = `${config.baseUrl || ''}/chat/completions`;
        
        if (onContentStream && (config.provider === 'deepseek' || config.provider === 'openai')) {
          onContentStream?.(`\n[镜头 ${i + 1}/${shots.length} 使用模型: ${config.model} (${config.provider})]\n`);
          aiResponse = await callOpenAIStreaming(config, [
            { role: 'system', content: '你是专业导演。design：description=画面环境描述，action=角色动作表情，两者不能重复。每个镜头必须对应原文中不同的段落，严禁两个镜头使用相同的原文内容。从原文提取丰富细节,设计镜头的完整分镜。禁止压缩。返回完整JSON。' },
            { role: 'user', content: prompt }
          ], onContentStream);
        } else {
          aiResponse = await callAI(config, [
            { role: 'system', content: '你是专业导演。design：description=画面环境描述，action=角色动作表情，两者不能重复。每个镜头必须对应原文中不同的段落，严禁两个镜头使用相同的原文内容。从原文提取丰富细节,设计镜头的完整分镜。禁止压缩。返回完整JSON。' },
            { role: 'user', content: prompt }
          ]);
        }
        
        recordAICall({
          provider: config.provider || 'unknown',
          model: config.model || '',
          endpoint,
          requestTime: Date.now() - shotStartTime,
          status: 'success'
        });
        
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const enrichedShot = JSON.parse(jsonMatch[0]);
          enriched.push(enrichedShot);
          if (enrichedShot) {
            usedContents.push({
              shotNumber: i + 1,
              description: enrichedShot.description || '',
              action: enrichedShot.action || '',
              dialogue: Array.isArray(enrichedShot.dialogue)
                ? enrichedShot.dialogue.map((d: any) => typeof d === 'string' ? d : d.line || '').join(' ')
                : (typeof enrichedShot.dialogue === 'string' ? enrichedShot.dialogue : '')
            });
          }
          console.log(`    ✓ 完成`);
          onProgress?.(`✅ 第 ${i + 1}/${shots.length} 个镜头设计完成`, 2, 2);
          success = true;
        } else {
          console.warn(`    ⚠️ 解析失败,使用原始镜头`);
          onProgress?.(`⚠️ 第 ${i + 1}/${shots.length} 个镜头解析失败，使用原始数据`, 2, 2);
          enriched.push(shot);
          if (shot) {
            usedContents.push({
              shotNumber: i + 1,
              description: shot.description || '',
              action: shot.action || '',
              dialogue: Array.isArray(shot.dialogue)
                ? shot.dialogue.map((d: any) => typeof d === 'string' ? d : d.line || '').join(' ')
                : (typeof shot.dialogue === 'string' ? shot.dialogue : '')
            });
          }
          success = true;
        }
      } catch (error: any) {
        console.error(`    ❌ 第 ${retry + 1} 次尝试失败: ${error?.message || error}`);
        recordAICall({
          provider: config.provider || 'unknown',
          model: config.model || '',
          endpoint: `${config.baseUrl || ''}/chat/completions`,
          requestTime: Date.now() - shotStartTime,
          status: 'failed',
          errorMessage: error?.message || '未知错误'
        });
        if (retry === maxRetries - 1) {
          onProgress?.(`❌ 第 ${i + 1}/${shots.length} 个镜头生成失败: ${error?.message || '未知错误'}，使用原始数据`, 2, 2);
          enriched.push(shot);
          success = true;
        }
      }
    }
  }
  
  return enriched;
}

// ========== JSON 解析（带容错） ==========

function parseStoryboardJSON(content: string): any[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI返回的内容无法解析为JSON');
  
  let rawJson = jsonMatch[0];
  
  try {
    return JSON.parse(rawJson);
  } catch (e1) {
    console.warn('[Storyboard] JSON解析失败，尝试修复...', (e1 as Error).message);
    
    rawJson = rawJson.replace(/,\s*([\]}])/g, '$1');
    rawJson = rawJson.replace(/"([^"]*?)(?=[\s,}\]])/g, '"$1"');
    
    const lastCompleteObj = findLastCompleteObject(rawJson);
    if (lastCompleteObj) {
      console.log('[Storyboard] 使用最后完整对象修复');
      return lastCompleteObj;
    }
    
    try {
      return JSON.parse(rawJson);
    } catch (e2) {
      console.log('[Storyboard] JSON解析失败，尝试流式提取...');
      const arrayStart = rawJson.indexOf('[');
      const arrayEnd = rawJson.lastIndexOf(']');
      
      if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
        try {
          return JSON.parse(rawJson.substring(arrayStart, arrayEnd + 1));
        } catch (e3) {
          throw new Error(`AI 返回内容无法解析：${(e3 as Error).message}`);
        }
      }
      throw new Error(`AI 返回内容无法解析：${(e2 as Error).message}`);
    }
  }
}

function findLastCompleteObject(jsonStr: string): any[] | null {
  try {
    return JSON.parse(jsonStr);
  } catch {
    const trimmed = jsonStr.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      let lastCompletePos = 0;
      
      for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];
        
        if (escapeNext) { escapeNext = false; continue; }
        if (char === '\\') { escapeNext = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        
        if (!inString) {
          if (char === '{' || char === '[') depth++;
          else if (char === '}' || char === ']') depth--;
          if (depth === 0 && i > 0) lastCompletePos = i + 1;
        }
      }
      
      if (lastCompletePos > 10) {
        try { return JSON.parse(trimmed.substring(0, lastCompletePos)); }
        catch { return null; }
      }
    }
    return null;
  }
}
