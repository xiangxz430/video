/**
 * AI 分镜脚本生成模块
 * 生成扁平的镜头列表(每个镜头 = 一个分镜/segment)
 */
import type { ApiConfig, Shot } from '../../types';
import { callAI, callOpenAIStreaming } from './apiClients';

// 计算两段文本的相似度（0-1，基于共同子串）
function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length === 0) return 0;
  
  // 基于共同字符的简化相似度
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

// 进度回调类型
export type StoryboardProgressCallback = (message: string, step?: number, totalSteps?: number) => void;

// ========== 主入口: 生成分镜脚本 ==========

export async function generateStoryboardScript(
  episodeContent: string,
  characters: Array<{ name: string; description: string }>,
  scenes: Array<{ name: string; description: string }>,
  config: ApiConfig,
  onProgress?: StoryboardProgressCallback,
  onContentStream?: (content: string) => void  // 流式内容回调
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
  
  // ========== 第一步:简单镜头结构划分 ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' 步骤 1/2: 划分镜头结构');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  onProgress?.('🎯 步骤 1/2: 正在分析剧本并划分镜头结构...', 1, 2);
  
  // 收集流式内容用于显示
  let streamedContent = '';
  const handleStreamChunk = (chunk: string) => {
    streamedContent += chunk;
    // 实时通知 UI（可选）
    if (onContentStream) {
      onContentStream(chunk);
    }
  };
  
  const shotStructure = await splitShotsSimple(episodeContent, characterInfo, sceneInfo, config, handleStreamChunk);
  console.log(`✅ 步骤 1 完成: 划分了 ${shotStructure.length} 个镜头`);
  onProgress?.(`✅ 划分完成!共 ${shotStructure.length} 个镜头`, 1, 2);
  
  // ========== 第二步:逐个镜头完善设计 ==========
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' 步骤 2/2: 逐个镜头完善设计');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  onProgress?.('🎨 步骤 2/2: 正在逐个镜头完善设计(添加摄影参数、台词、声音等)...', 2, 2);
  const enrichedShots = await enrichEachShot(shotStructure, episodeContent, characterInfo, sceneInfo, config, onProgress, onContentStream);
  console.log(`✅ 步骤 2 完成: 完善了 ${enrichedShots.length} 个镜头`);
  onProgress?.(`✅ 所有镜头设计完成!共 ${enrichedShots.length} 个镜头`, 2, 2);
  
  // 检查镜头间内容重复并自动修复
  onContentStream?.('\n🔍 正在检测镜头内容重复...\n');
  
  // 检测重复
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
    
    // 对每组重复，重新生成后面那个镜头
    for (const dup of duplicatePairs) {
      const targetShot = enrichedShots[dup.j];
      const refShot = enrichedShots[dup.i];
      
      onContentStream?.(`  重新生成镜头${targetShot.shotNumber}...\n`);
      
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

// ========== 阶段 1: 生成初始分镜 ==========

async function generateInitialStoryboard(
  episodeContent: string,
  characterInfo: string,
  sceneInfo: string,
  config: ApiConfig
): Promise<any[]> {
  const prompt = `你是一位获得过奥斯卡奖的电影导演。请根据以下原剧本原文生成专业级分镜脚本。

【核心原则 - 绝对禁止违反】
1. 绝对禁止概括、压缩、缩写原剧本原文
2. 绝对禁止将多段文字合并为一句话
3. 绝对禁止生成"XX在XX地方做XX"这类概括句

【字数硬性要求 - 必须达标】
每个镜头的 description 必须至少 50 个字，目标 100 字以上。
如果原文内容不足 50 字，则基于原文细节进行合理的画面展开和补充（如环境细节、角色状态、光影氛围等）。
每个镜头的 action 也必须至少 30 个字，详细描述角色的动作、表情、肢体语言。
场景级 description 必须至少 50 个字，描述场景的氛围、时间、环境。

【具体要求】
1. 把原剧本按场景拆分为多个分镜
2. 每个分镜的 description 必须从原文提取并展开：原文内容 + 合理的画面补充（光影、色彩、空间感、角色姿态等）
3. 每个分镜的 action 必须从原文提取并展开：原文动作 + 具体的肢体语言、表情变化、移动路线
4. 如果原文描述简短，你作为专业导演必须补充合理的视觉细节

【原剧本原文】
${episodeContent}

角色信息（参考）：
${characterInfo}

场景信息（参考）：
${sceneInfo}

【专业要求】
1. 镜头设计：每个场景 3-8 个镜头，遵循 180 度轴线规则
2. 台词设计：必须写出完整台词内容，标注情绪和演绎方式
3. 摄影参数：焦段、构图、光线
4. 声音设计：环境音、音效、BGM
5. 转场：cut/fade-in/dissolve/match-cut

【输出格式 - 严格JSON数组】
[
  {
    "sceneNumber": 1,
    "scene": "场景名称（必须来自场景信息的name字段，只使用名称字符串）",
    "description": "场景描述，至少50字，包含氛围、时间、环境、空间布局等",
    "mood": "tense/calm/joyful/sad",
    "pacing": "slow/medium/fast",
    "transition": "cut/fade-in/dissolve",
    "shots": [
      {
        "shotNumber": 1,
        "duration": 5,
        "shotType": "LS/MS/CU/ECU",
        "cameraAngle": "eye-level/high-angle/low-angle",
        "cameraMovement": "static/pan/tilt/dolly/zoom",
        "lens": "24mm/35mm/50mm/85mm/135mm",
        "composition": "rule-of-thirds/centered/leading-lines",
        "lighting": "natural/key-light/backlit",
        "description": "镜头画面描述，至少50字，目标100字。包含画面内容、环境细节、光影效果、色彩氛围、角色位置和姿态",
        "action": "动作描述，至少30字。包含角色具体动作、表情变化、移动路线、肢体语言",
        "characters": ["角色名"],
        "scene": "场景名称（必须来自场景信息的name字段）",
        "dialogue": [
          {
            "character": "角色名",
            "line": "完整台词内容",
            "emotion": "sad/angry/calm",
            "delivery": "slow/fast/whisper"
          }
        ],
        "audio": {
          "dialogue": "对白摘要",
          "sfx": ["音效"],
          "ambience": "环境音",
          "bgm": "BGM描述",
          "volume": "dialogue-focused/balanced"
        },
        "continuity": {
          "followsFrom": null,
          "leadsTo": 2,
          "axisRule": "maintained",
          "eyelineMatch": false
        },
        "notes": "导演备注"
      }
    ]
  }
]

【关键约束】
1. description 每个 shot 至少 50 字！action 每个 shot 至少 30 字！这是硬性要求！
2. 台词必须具体完整
3. 场景/角色名称必须来自输入信息
4. 返回严格合法的 JSON 数组`;

  const content = await callAI(config, [
    { role: 'system', content: '你是专业电影导演。生成分镜脚本时，每个镜头的 description 必须至少50字，action 至少30字。从原文提取内容并展开视觉细节（光影、色彩、空间、姿态）。绝对禁止只写一两句话的简略描述。请返回合法JSON。' },
    { role: 'user', content: prompt }
  ]);
  
  return parseStoryboardJSON(content);
}

// ========== 阶段 2: 逐场景质量检查和优化 ==========

async function optimizeEachShot(
  storyboard: any[],
  episodeContent: string,
  characterInfo: string,
  sceneInfo: string,
  config: ApiConfig
): Promise<any[]> {
  const optimizedStoryboard = [...storyboard];
  const MIN_DESC_LENGTH = 50;  // 每个 shot 的 description 最低字数
  const MIN_ACTION_LENGTH = 30; // 每个 shot 的 action 最低字数
  const TARGET_DESC_LENGTH = 100; // 目标字数
  
  console.log(`[optimizeEachShot] 开始检查 ${storyboard.length} 个场景...`);
  console.log(`[optimizeEachShot] 字数标准: description ≥${MIN_DESC_LENGTH}字(目标${TARGET_DESC_LENGTH}字), action ≥${MIN_ACTION_LENGTH}字`);
  
  for (let i = 0; i < storyboard.length; i++) {
    const scene = storyboard[i];
    
    // 统计当前场景各镜头的字数
    const shotStats = (scene.shots || []).map((shot: any, si: number) => ({
      index: si,
      descLen: shot.description?.length || 0,
      actionLen: shot.action?.length || 0,
      needsFix: (shot.description?.length || 0) < MIN_DESC_LENGTH || (shot.action?.length || 0) < MIN_ACTION_LENGTH
    }));
    const shortShots = shotStats.filter((s: any) => s.needsFix);
    
    console.log(`[optimizeEachShot] 场景 ${i + 1}/${storyboard.length}: ${scene.scene}`);
    console.log(`  镜头数: ${scene.shots?.length || 0}, 不达标镜头: ${shortShots.length}`);
    shotStats.forEach((s: any) => {
      const status = s.needsFix ? '⚠️ 不达标' : '✅';
      console.log(`  镜头${s.index + 1}: description=${s.descLen}字, action=${s.actionLen}字 ${status}`);
    });
    
    // 如果所有镜头都达标，跳过此场景
    if (shortShots.length === 0) {
      console.log(`  ✅ 场景 ${i + 1} 所有镜头字数达标，跳过优化`);
      continue;
    }
    
    // 需要优化的镜头索引列表
    const shortShotIndices = shortShots.map((s: any) => s.index);
    const shortShotDetails = shortShots.map((s: any) => 
      `镜头${s.index + 1}: description=${s.descLen}字(需≥${MIN_DESC_LENGTH}), action=${s.actionLen}字(需≥${MIN_ACTION_LENGTH})`
    ).join('\n');
    
    let currentScene = { ...scene, shots: [...(scene.shots || [])] };
    let maxRetries = 2;
    
    for (let retry = 0; retry < maxRetries; retry++) {
      const currentSceneJSON = JSON.stringify(currentScene, null, 2);
      
      const contextPrompt = `请扩展以下分镜中不达标镜头的 description 和 action。

【原剧本参考（必须从这里面提取细节）】
${episodeContent}

【不达标镜头列表】
${shortShotDetails}

【字数要求】
- description 每个镜头至少 ${MIN_DESC_LENGTH} 字，目标 ${TARGET_DESC_LENGTH} 字
- action 每个镜头至少 ${MIN_ACTION_LENGTH} 字
- 达标的镜头保持不变，只扩展不达标的镜头

【扩展方法】
1. 从原剧本中提取该镜头对应的原文段落，逐字引用
2. 补充画面视觉细节：光影方向、色彩氛围、空间纵深、角色位置
3. 补充动作细节：肢体语言、表情变化、移动路线、微动作
4. 保持原有 JSON 结构，只修改 description 和 action 字段

【当前场景JSON】
${currentSceneJSON}

【返回格式】
返回完整的JSON场景对象（包含所有字段，达标的镜头内容保持不变）`;

      try {
        const aiResponse = await callAI(config, [
          { role: 'system', content: `你是专业电影导演。扩展分镜描述时：description 每个镜头至少${MIN_DESC_LENGTH}字(目标${TARGET_DESC_LENGTH}字)，action 至少${MIN_ACTION_LENGTH}字。从原文提取细节并补充视觉/动作描写。返回完整JSON。` },
          { role: 'user', content: contextPrompt }
        ]);

        const trimmed = aiResponse.trim();
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const expandedScene = JSON.parse(jsonMatch[0]);
            if (expandedScene.scene && expandedScene.shots) {
              // 检查优化后是否改善
              const newShortShots = (expandedScene.shots || []).filter((shot: any) => 
                (shot.description?.length || 0) < MIN_DESC_LENGTH || (shot.action?.length || 0) < MIN_ACTION_LENGTH
              );
              const newDescTotal = expandedScene.shots?.reduce((sum: number, shot: any) => sum + (shot.description?.length || 0), 0) || 0;
              const oldDescTotal = currentScene.shots?.reduce((sum: number, shot: any) => sum + (shot.description?.length || 0), 0) || 0;
              
              console.log(`  优化第${retry + 1}次: description总字数 ${oldDescTotal}→${newDescTotal}, 不达标镜头 ${shortShots.length}→${newShortShots.length}`);
              
              currentScene = expandedScene;
              
              // 如果已经全部达标，退出重试
              if (newShortShots.length === 0) {
                console.log(`  ✅ 场景 ${i + 1} 所有镜头已达标`);
                break;
              }
              // 如果没有改善，也退出
              if (newDescTotal <= oldDescTotal) {
                console.log(`  ⚠️ 优化后字数未增长，停止重试`);
                break;
              }
            } else {
              console.log(`  ⚠️ AI返回格式不对，跳过`);
              break;
            }
          } catch (parseError) {
            console.warn(`  ⚠️ JSON解析失败，跳过`, parseError);
            break;
          }
        } else {
          console.log(`  ⚠️ AI返回非JSON，跳过`);
          break;
        }
      } catch (error) {
        console.warn(`  ⚠️ 优化失败:`, error);
        break;
      }
    }
    
    optimizedStoryboard[i] = currentScene;
  }
  
  // 输出最终统计
  let totalShots = 0, qualifiedShots = 0;
  optimizedStoryboard.forEach(scene => {
    (scene.shots || []).forEach((shot: any) => {
      totalShots++;
      if ((shot.description?.length || 0) >= MIN_DESC_LENGTH && (shot.action?.length || 0) >= MIN_ACTION_LENGTH) {
        qualifiedShots++;
      }
    });
  });
  console.log(`[optimizeEachShot] ✅ 完成: ${qualifiedShots}/${totalShots} 个镜头字数达标 (≥${MIN_DESC_LENGTH}字description, ≥${MIN_ACTION_LENGTH}字action)`);
  return optimizedStoryboard;
}

// ========== 辅助函数 1: 简单镜头结构划分 ==========
async function splitShotsSimple(
  episodeContent: string,
  characterInfo: string,
  sceneInfo: string,
  config: ApiConfig,
  onContentStream?: (chunk: string) => void
): Promise<Shot[]> {
  // 使用完整原文，不截断
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

  // 如果支持流式，使用流式调用
  let content: string;
  
  // 在调用前显示使用的模型信息
  onContentStream?.(`\n[使用模型: ${config.model} (${config.provider})]\n`);
  
  if (onContentStream && (config.provider === 'deepseek' || config.provider === 'openai')) {
    content = await callOpenAIStreaming(config, [
      { role: 'system', content: '你是分镜助手。请划分镜头结构，返回简短JSON。每个镜头的描述限制在一句话以内。' },
      { role: 'user', content: prompt }
    ], onContentStream);
  } else {
    // 回退到普通调用
    content = await callAI(config, [
      { role: 'system', content: '你是分镜助手。请划分镜头结构，返回简短JSON。每个镜头的描述限制在一句话以内。' },
      { role: 'user', content: prompt }
    ]);
  }

  const shots = parseStoryboardJSON(content);
  // 给每个 shot 添加 shotNumber
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
  onContentStream?: (content: string) => void  // 流式内容回调
): Promise<Shot[]> {
  const enriched: Shot[] = [];
  // 维护已使用内容的数组，用于防止内容重复分配
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
    
    // 构造已使用内容的提示
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
    
    // 提取该镜头的原文段落
    const shotNarration = shot.narrationSource || shot.description || '';

    // 构造相邻镜头上下文
    // 前一个镜头的信息（已完善的版本）
    let prevShotContext = '';
    if (i > 0) {
      const prev = enriched[i - 1] || shots[i - 1];
      prevShotContext = `\n【前一个镜头（镜头${prev.shotNumber || i}）- 请确保与之自然衔接】
画面: ${prev.description || '(无)'}
动作: ${prev.action || '(无)'}
镜头类型: ${prev.shotType || '(无)'}
运镜: ${prev.cameraMovement || '(无)'}`;
    }

    // 下一个镜头的预览信息（尚未完善，只有基础信息）
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
    let maxRetries = 2; // 最多重试2次
    
    for (let retry = 0; retry < maxRetries && !success; retry++) {
      if (retry > 0) {
        console.log(`    🔄 第 ${retry} 次重试...`);
        onProgress?.(`🔄 第 ${i + 1}/${shots.length} 个镜头第 ${retry} 次重试...`, 2, 2);
      }
      
      try {
        let aiResponse: string;
        
        // 如果支持流式，使用流式调用
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
        
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const enrichedShot = JSON.parse(jsonMatch[0]);
          enriched.push(enrichedShot);
          // 将当前镜头的完整内容加入已使用内容列表，用于后续镜头去重
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
          // 即使解析失败，也将原始镜头的完整内容加入已使用内容
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
          success = true; // 即使解析失败，也算完成（使用了原始数据）
        }
      } catch (error: any) {
        console.error(`    ❌ 第 ${retry + 1} 次尝试失败: ${error?.message || error}`);
        if (retry === maxRetries - 1) {
          // 最后一次重试也失败了
          onProgress?.(`❌ 第 ${i + 1}/${shots.length} 个镜头生成失败: ${error?.message || '未知错误'}，使用原始数据`, 2, 2);
          enriched.push(shot);
          success = true; // 强制标记为完成，继续下一个镜头
        }
        // 否则继续重试
      }
    }
  }
  
  return enriched;
}

// ========== 辅助函数 3: AI 自我评估质量 ==========

interface QualityIssue {
  severity: 'critical' | 'major' | 'minor';
  type: string;
  description: string;
  shotIndex?: number;
  sceneIndex?: number;
}

interface QualityAssessment {
  score: number;
  issues: QualityIssue[];
  summary: string;
}

async function assessStoryboardQuality(
  storyboard: any[],
  episodeContent: string,
  characterInfo: string,
  sceneInfo: string,
  config: ApiConfig
): Promise<QualityAssessment> {
  const storyboardJSON = JSON.stringify(storyboard, null, 2);
  
  const prompt = `你是资深电影制片人，请评估以下分镜脚本的质量。

【剧情内容】
${episodeContent}

【分镜脚本】
${storyboardJSON.substring(0, 30000)}${storyboardJSON.length > 30000 ? '...(truncated)' : ''}

【评估标准】
1. 台词质量（25分）：台词是否具体、符合角色、逻辑连贯
2. 镜头连贯性（25分）：镜头之间是否流畅、符合轴线规则
3. 声音设计（20分）：环境音、音效、BGM是否具体合理
4. 画面描述（20分）：是否包含构图、光影、色彩、动作
5. 转场和节奏（10分）：转场是否合理、节奏是否符合情绪

【要求】
返回 JSON 格式：
{
  "score": 85,
  "issues": [
    {
      "severity": "critical",
      "type": "dialogue",
      "description": "第2场第3镜头的台词缺少具体内容",
      "sceneIndex": 1,
      "shotIndex": 2
    }
  ],
  "summary": "总体评价..."
}

severity 分级：
- critical: 严重影响使用
- major: 影响质量但不影响使用
- minor: 小瑕疵

只返回 JSON，不要其他内容。`;

  try {
    const content = await callAI(config, [
      { role: 'system', content: '你是资深电影制片人，擅长评估分镜脚本质量。请返回JSON。' },
      { role: 'user', content: prompt }
    ]);
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { score: 70, issues: [], summary: '评估失败，默认分数' };
  } catch (error) {
    console.error('[Storyboard] 质量评估失败:', error);
    return { score: 70, issues: [], summary: '评估失败' };
  }
}

// ========== 阶段 4: 修复问题 ==========

async function fixStoryboardIssues(
  storyboard: any[],
  issues: QualityIssue[],
  episodeContent: string,
  characterInfo: string,
  sceneInfo: string,
  config: ApiConfig
): Promise<any[]> {
  const criticalIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'major');
  
  if (criticalIssues.length === 0) {
    return storyboard;
  }
  
  const storyboardJSON = JSON.stringify(storyboard, null, 2);
  const issuesText = criticalIssues.map((issue, idx) => 
    `${idx + 1}. [${issue.severity}] ${issue.description}${issue.sceneIndex !== undefined ? ` (场景${issue.sceneIndex + 1}` + (issue.shotIndex !== undefined ? `,镜头${issue.shotIndex + 1}` : '') + ')' : ''}`
  ).join('\n');
  
  const prompt = `你是专业电影导演，请修复以下分镜脚本中的问题。

【绝对禁止事项】
1. 禁止修改 description 和 action 的文字内容
2. 禁止概括、压缩、缩写原文
3. 只能修改元数据字段（shotType、cameraAngle、transition 等）

【原分镜脚本】
${storyboardJSON.substring(0, 10000)}${storyboardJSON.length > 10000 ? '...(truncated)' : ''}

【需要修复的问题】
${issuesText}

【修复要求】
1. 只修复列出的问题，不要改动 description 和 action 的文字
2. 保持原有结构和格式
3. 只修改元数据字段，不要修改内容
4. 返回完整的修复后的 JSON 数组

返回严格合法的 JSON 数组。`;

  try {
    const content = await callAI(config, [
      { role: 'system', content: '你是专业电影导演。修复分镜问题时，绝对禁止修改 description 和 action 的文字，只修改元数据。请返回完整JSON。' },
      { role: 'user', content: prompt }
    ]);
    
    return parseStoryboardJSON(content);
  } catch (error) {
    console.error('[Storyboard] 修复失败:', error);
    return storyboard;
  }
}

// ========== 本地质量评分 ==========

function calculateLocalQualityScore(storyboard: any[]): number {
  let score = 100;
  
  for (const scene of storyboard) {
    if (!scene.shots || !Array.isArray(scene.shots)) {
      score -= 10;
      continue;
    }
    
    for (const shot of scene.shots) {
      if (shot.dialogue && shot.dialogue.length > 0) {
        for (const d of shot.dialogue) {
          if (!d.line || d.line.length < 5) score -= 3;
          if (!d.emotion) score -= 1;
        }
      }
      if (!shot.description || shot.description.length < 50) score -= 5;
      if (!shot.audio || typeof shot.audio === 'string') score -= 2;
      else {
        if (!shot.audio.sfx || shot.audio.sfx.length === 0) score -= 1;
        if (!shot.audio.bgm) score -= 1;
      }
      if (!shot.shotType) score -= 1;
      if (!shot.lens) score -= 1;
      if (!shot.lighting) score -= 1;
    }
  }
  
  return Math.max(0, Math.min(100, score));
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
