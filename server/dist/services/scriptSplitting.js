import { callAI, callOpenAICompatible, callIdealab, SCRIPT_PROVIDERS } from './apiClients.js';
import { getProviderConfig } from '../config/index.js';
import { recordAICall, sanitizeAICallBody } from './logContext.js';
// ========== JSON 修复工具函数 ==========
/**
 * 线性扫描补全JSON中缺失的闭合引号（O(n) 单遍扫描，替换原 O(n²) 惰性正则）
 * 场景：AI 返回的 JSON 中，某些字符串值缺少闭合引号，如 "key": "value, 或 "key": "value]
 */
function fixMissingClosingQuotes(json) {
    const result = [];
    let inString = false;
    let escapeNext = false;
    for (let i = 0; i < json.length; i++) {
        const ch = json[i];
        if (escapeNext) {
            result.push(ch);
            escapeNext = false;
            continue;
        }
        if (ch === '\\') {
            escapeNext = true;
            result.push(ch);
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            result.push(ch);
            continue;
        }
        // 如果在字符串内部遇到了结构性字符（逗号、闭合括号、换行），说明前面的引号没有闭合
        if (inString && (ch === ',' || ch === '}' || ch === ']' || ch === '\n' || ch === '\r')) {
            result.push('"'); // 补上缺失的闭合引号
            inString = false;
        }
        result.push(ch);
    }
    // 如果遍历完还在字符串中，补最后的引号
    if (inString) {
        result.push('"');
    }
    return result.join('');
}
// ========== 剧本拆分：提取角色和场景 ==========
export async function splitScriptWithAI(scriptContent, config) {
    const prompt = `请分析以下剧本，提取角色、场景和分集信息，以JSON格式返回。

剧本内容：
${scriptContent}

【重要】角色描述和场景描述必须返回结构化的提示词格式，如下所示：

# 角色描述格式示例：
"description": {
  "核心约束": {
    "几何保真度": "严格保持身高比例，面部轮严禁变形，保持真实人体解剖结构。",
    "物体完整性": "保持发型发色与描述完全一致，服装款式颜色材质准确还原，配饰道具完整无缺失，所有元素符合历史考据。",
    "转换逻辑": "将文字描述转化为高精度PBR材质系统，重点还原皮肤自然纹理、服装材质质感（丝绸/棉麻/皮革等）、金属配饰的光泽与氧化痕迹。",
    "图像比例": "竖版肖像（3:4），适配人物全身展示与面部特写需求。"
  },
  "人物与服饰": {
    "基本信息": "年龄范围、性别、身高体型",
    "面部特征": "脸型、眼睛（形状、颜色）、眉毛、鼻子、嘴巴、肤色",
    "发型发色": "长度、发型样式、发色",
    "服装穿着": "款式、颜色、材质、图案、层次搭配",
    "配饰道具": "首饰、武器、随身物品等",
    "气质神态": "典型表情、眼神特点、举止习惯、整体气质",
    "姿态动作": "常见站姿、坐姿、行走方式"
  },
  "摄影参数": {
    "相机型号": "尼康 Z9 搭配 85mm f/1.4 定焦镜头",
    "光圈": "f/2.8",
    "快门": "1/125s",
    "ISO": "100",
    "焦段": "85mm 人像焦段（全身）/ 50mm 标准焦段（面部特写）"
  },
  "渲染精度": {
    "画面表现": "8K超高清分辨率，PBR物理渲染引擎，皮肤呈现自然毛孔与血色还原，服装材质精确表达丝绸/棉麻/皮革的独特质感，背景简洁纯色以突出人物主体。"
  }
}

# 场景描述格式示例：
"description": {
  "核心约束": {
    "几何保真度": "严格保持约八十平方米的室内空间尺度，清晰划分上厅与下厅的纵深布局。",
    "物体完整性": "保持雕刻精美的木质桌椅完整器型与礼仪性摆放阵列，所有陈设比例协调且绝对排除现代元素。",
    "转换逻辑": "将文字描述转化为高精度PBR材质系统，重点还原红漆木墙的温润光泽与局部岁月剥落痕迹。",
    "图像比例": "宽幅横屏（16:9），适配室内纵深构图与上下厅空间关系展示。"
  },
  "场景与光效": {
    "设计风格": "南宋传统官式民居风格 / 中式古典室内",
    "地点": "古代宋家府邸正厅（纯历史场景还原）",
    "时间": "正午（日光垂直照射时段）",
    "环境光": "强烈阳光穿透雕花窗棂投射入内，在地面形成清晰而斑驳的几何光影。",
    "光影品质": "高对比度自然布光，窗影边缘微柔化，红漆墙面呈现高级漫反射质感。"
  },
  "摄影参数": {
    "相机型号": "尼康 Z9（Nikon Z9）搭配 PC-E 24mm f/3.5D 移轴镜头",
    "光圈": "f/8",
    "快门": "1/60s",
    "ISO": "100",
    "焦段": "24mm 广角（校正透视变形，完整收纳八十平米空间）"
  },
  "渲染精度": {
    "画面表现": "8K超高清分辨率，PBR物理渲染引擎输出，红漆与鎏金配色华丽庄重且不溢色。"
  }
}

返回格式（严格JSON，不要有其他内容）：
{
  "characters": [
    {
      "name": "角色名",
      "description": "【必须使用上述结构化格式】详细的外貌形象描述，包含核心约束、人物与服饰、摄影参数、渲染精度等完整结构。",
      "isMain": true/false,
      "voiceDescription": "音色描述（可选），包括音调高低、音色特点、语速、语气风格等"
    }
  ],
  "scenes": [
    {
      "name": "场景名称",
      "description": "【必须使用上述结构化格式】详细的场景环境描述，包含核心约束、场景与光效、摄影参数、渲染精度等完整结构。",
      "episodes": ["1", "2"]
    }
  ],
  "episodes": [
    {
      "title": "集标题",
      "episodeNumber": 1,
      "content": "该集的完整原文内容（直接截取剧本原文，不要概括不要重写）"
    }
  ]
}

【关键要求 - 必须严格遵守】：
1. 【非常重要】必须提取剧本中出现的所有角色，不能遗漏任何一个！包括主角、配角、群演角色
2. 【非常重要】必须提取剧本中出现的所有场景，不能遗漏任何一个！包括主要场景和临时场景
3. 【非常重要】角色的description必须返回完整的JSON对象格式，包含"核心约束"、"人物与服饰"、"摄影参数"、"渲染精度"四个部分
4. 【非常重要】场景的description必须返回完整的JSON对象格式，包含"核心约束"、"场景与光效"、"摄影参数"、"渲染精度"四个部分
5. 【非常重要】episodes的content必须是该集对应的完整原文，一字不落，不要概括不要压缩
6. 【非常重要】JSON字符串中的换行符必须转义为\\n，双引号必须转义为\\"，反斜杠必须转义为\\\\
7. 描述必须具体详细，不能笼统模糊，要有画面感
8. 描述要符合剧本的时代背景和风格设定
9. 如果是古装剧，服装和建筑要符合历史背景
10. 如果是现代剧，要体现当代特色
11. 【非常重要】场景描述中绝对不能包含任何人物、角色、人形生物！只描述纯粹的环境、建筑，自然景观
12. 【非常重要】提取角色时，必须遍历剧本全文，统计所有有名字或有台词的角色，确保一个不漏
13. 【非常重要】提取场景时，必须识别所有不同的地点和环境，确保一个不漏`;
    const callStartTime = Date.now();
    const endpoint = `${config.baseUrl || ''}/chat/completions`;
    const content = await callAI(config, [
        { role: 'system', content: '你是一个专业的剧本分析助手和AI绘画提示词专家，擅长从剧本文本中提取结构化信息，并能生成符合专业影视制作标准的结构化视觉描述。请始终返回合法的JSON格式。【重要约束】角色的description必须包含"核心约束"、"人物与服饰"、"摄影参数"、"渲染精度"四个部分；场景的description必须包含"核心约束"、"场景与光效"、"摄影参数"、"渲染精度"四个部分。描述要结构完整、细节丰富、画面感强，可直接用于AI图片生成。' },
        { role: 'user', content: prompt }
    ]);
    recordAICall({
        provider: config.provider || 'unknown',
        model: config.model || '',
        endpoint,
        requestTime: Date.now() - callStartTime,
        status: 'success',
        requestBody: sanitizeAICallBody({ action: 'splitScript', scriptContentLength: scriptContent.length }),
    });
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch)
        throw new Error('AI返回的内容无法解析为JSON');
    let jsonStr = jsonMatch[0];
    try {
        return JSON.parse(jsonStr);
    }
    catch (e1) {
        console.warn('JSON 解析失败，尝试修复...', e1);
        // 修复1: 去除多余逗号（JSON 允许尾逗号前的值但不允许尾逗号本身）
        jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
        // 修复2: 线性扫描补全缺失的闭合引号（O(n)，替换原 O(n²) 惰性正则）
        jsonStr = fixMissingClosingQuotes(jsonStr);
        // 修复3: 对特定字段内容进行转义清理
        const stringFields = ['content', 'description', 'title', 'name', 'line', 'scene', 'action', 'notes', 'dialogue'];
        stringFields.forEach(field => {
            const pattern = '"' + field + '"' + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"';
            const regex = new RegExp(pattern, 'g');
            jsonStr = jsonStr.replace(regex, (match, fieldValue) => {
                const cleaned = fieldValue
                    .replace(/\\/g, '\\\\')
                    .replace(/"/g, '\\"')
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/\t/g, '\\t')
                    .replace(/\f/g, '\\f')
                    .replace(/[^\x20-\x7E\\n\\r\\t\"\\\\]/g, '');
                return '"' + field + '": "' + cleaned + '"';
            });
        });
        try {
            return JSON.parse(jsonStr);
        }
        catch (e2) {
            console.error('JSON 修复后仍失败:', e2);
            console.error('修复后的 JSON 前 500 字符:', jsonStr.substring(0, 500));
            throw new Error('AI 返回的 JSON 格式错误：' + (e2 instanceof Error ? e2.message : '未知错误') + '。请重试。');
        }
    }
}
// ========== 使用指定配置拆分剧本 ==========
export async function splitScriptWithConfig(scriptContent, config, customInfo = '') {
    const systemPrompt = `你是一个专业的剧本分析助手和AI绘画提示词专家。请将以下剧本内容拆分为角色、场景和分集信息。
${customInfo}

【重要】角色描述和场景描述必须返回结构化的提示词格式，如下所示：

# 角色描述格式示例：
"description": {
  "核心约束": {
    "几何保真度": "严格保持约175cm的身高比例，面部轮廓符合亚洲人特征，严禁卡通化或变形，保持真实人体解剖结构。",
    "物体完整性": "保持发型发色与描述完全一致，服装款式颜色材质准确还原，配饰道具完整无缺失，所有元素符合历史考据。",
    "转换逻辑": "将文字描述转化为高精度PBR材质系统，重点还原皮肤自然纹理、服装材质质感（丝绸/棉麻/皮革等）、金属配饰的光泽与氧化痕迹。",
    "图像比例": "竖版肖像（3:4），适配人物全身展示与面部特写需求。"
  },
  "人物与服饰": {
    "基本信息": "年龄范围、性别、身高体型",
    "面部特征": "脸型、眼睛（形状、颜色）、眉毛、鼻子、嘴巴、肤色",
    "发型发色": "长度、发型样式、发色",
    "服装穿着": "款式、颜色、材质、图案、层次搭配",
    "配饰道具": "首饰、武器、随身物品等",
    "气质神态": "典型表情、眼神特点、举止习惯、整体气质",
    "姿态动作": "常见站姿、坐姿、行走方式"
  },
  "摄影参数": {
    "相机型号": "尼康 Z9 搭配 85mm f/1.4 定焦镜头",
    "光圈": "f/2.8",
    "快门": "1/125s",
    "ISO": "100",
    "焦段": "85mm 人像焦段（全身）/ 50mm 标准焦段（面部特写）"
  },
  "渲染精度": {
    "画面表现": "8K超高清分辨率，PBR物理渲染引擎，皮肤呈现自然毛孔与血色还原，服装材质精确表达丝绸/棉麻/皮革的独特质感，背景简洁纯色以突出人物主体。"
  }
}

# 场景描述格式示例：
"description": {
  "核心约束": {
    "几何保真度": "严格保持约八十平方米的室内空间尺度，清晰划分上厅与下厅的纵深布局。",
    "物体完整性": "保持雕刻精美的木质桌椅完整器型与礼仪性摆放阵列。",
    "转换逻辑": "将文字描述转化为高精度PBR材质系统，重点还原红漆木墙的温润光泽与局部岁月剥落痕迹。",
    "图像比例": "宽幅横屏（16:9），适配室内纵深构图与上下厅空间关系展示。"
  },
  "场景与光效": {
    "设计风格": "南宋传统官式民居风格 / 中式古典室内",
    "地点": "古代宋家府邸正厅（纯历史场景还原）",
    "时间": "正午（日光垂直照射时段）",
    "环境光": "强烈阳光穿透雕花窗棂投射入内。",
    "光影品质": "高对比度自然布光。"
  },
  "摄影参数": {
    "相机型号": "尼康 Z9 搭配 PC-E 24mm f/3.5D 移轴镜头",
    "光圈": "f/8",
    "快门": "1/60s",
    "ISO": "100",
    "焦段": "24mm 广角"
  },
  "渲染精度": {
    "画面表现": "8K超高清分辨率，PBR物理渲染引擎输出。"
  }
}

请按以下 JSON 格式返回：
{
  "characters": [
    {
      "name": "角色名",
      "description": "【必须使用上述结构化格式】详细的外貌形象描述。",
      "isMain": true/false,
      "voiceDescription": "声音特点描述（可选）"
    }
  ],
  "scenes": [
    {
      "name": "场景名称",
      "description": "【必须使用上述结构化格式】详细的场景环境描述。",
      "episodes": ["1", "2"]
    }
  ],
  "episodes": [
    {
      "title": "集标题",
      "episodeNumber": 1,
      "content": "该集的剧情概要"
    }
  ]
}

【关键要求 - 必须严格遵守】：
1. 【非常重要】必须提取剧本中出现的所有角色，不能遗漏任何一个！包括主角、配角、群演角色
2. 【非常重要】必须提取剧本中出现的所有场景，不能遗漏任何一个！包括主要场景和临时场景
3. 【非常重要】角色的description必须返回完整的JSON对象格式，包含"核心约束"、"人物与服饰"、"摄影参数"、"渲染精度"四个部分
4. 【非常重要】场景的description必须返回完整的JSON对象格式，包含"核心约束"、"场景与光效"、"摄影参数"、"渲染精度"四个部分
5. 【非常重要】episodes的content必须是该集对应的完整原文，一字不落，不要概括不要压缩
6. 【非常重要】JSON字符串中的换行符必须转义为\\n，双引号必须转义为\\"，反斜杠必须转义为\\\\
7. 描述必须具体详细，不能笼统模糊，要有画面感
8. 描述要符合剧本的时代背景和风格设定
9. 如果是古装剧，服装和建筑要符合历史背景
10. 如果是现代剧，要体现当代特色
11. 【非常重要】场景描述中绝对不能包含任何人物、角色、人形生物！只描述纯粹的环境、建筑，自然景观
12. 【非常重要】提取角色时，必须遍历剧本全文，统计所有有名字或有台词的角色，确保一个不漏
13. 【非常重要】提取场景时，必须识别所有不同的地点和环境，确保一个不漏`;
    const prompt = `请分析以下剧本，提取角色、场景和分集信息，以JSON格式返回。

剧本内容：
${scriptContent}

返回格式（严格JSON，不要有其他内容）：
{
  "characters": [
    {
      "name": "角色名",
      "description": "【必须使用上述结构化格式】详细的外貌形象描述，包含核心约束、人物与服饰、摄影参数、渲染精度等完整结构。",
      "isMain": true/false,
      "voiceDescription": "音色描述（可选），包括音调高低、音色特点、语速、语气风格等"
    }
  ],
  "scenes": [
    {
      "name": "场景名称",
      "description": "【必须使用上述结构化格式】详细的场景环境描述，包含核心约束、场景与光效、摄影参数、渲染精度等完整结构。",
      "episodes": ["1", "2"]
    }
  ],
  "episodes": [
    {
      "title": "集标题",
      "episodeNumber": 1,
      "content": "该集的剧情概要"
    }
  ]
}`;
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
    ];
    let content;
    console.log(`[splitScriptWithConfig] 调用 API: provider=${config.provider}, model=${config.model || 'default'}`);
    const callStartTime = Date.now();
    const endpoint = `${config.baseUrl || ''}/chat/completions`;
    if (config.provider === 'idealab') {
        content = await callIdealab(config, messages);
    }
    else {
        content = await callOpenAICompatible(config, messages);
    }
    recordAICall({
        provider: config.provider || 'unknown',
        model: config.model || '',
        endpoint,
        requestTime: Date.now() - callStartTime,
        status: 'success',
        requestBody: sanitizeAICallBody({ action: 'splitScriptWithConfig', scriptContentLength: scriptContent.length, provider: config.provider }),
    });
    console.log(`[splitScriptWithConfig] API 返回内容长度: ${content.length}`);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch)
        throw new Error('AI 返回格式不正确，无法解析JSON');
    let rawJson = jsonMatch[0];
    let result;
    try {
        result = JSON.parse(rawJson);
    }
    catch (e1) {
        rawJson = rawJson.replace(/,\s*([\]}])/g, '$1');
        rawJson = rawJson.replace(/"([^"]*?)(?=[\s,}\]])/g, '"$1"');
        try {
            result = JSON.parse(rawJson);
        }
        catch (e2) {
            console.log('Attempting streaming extraction...');
            const extracted = extractArraysFromJson(rawJson);
            if (extracted) {
                result = extracted;
            }
            else {
                throw new Error(`AI 返回内容无法解析：${e2.message}`);
            }
        }
    }
    if (Array.isArray(result.characters)) {
        result.characters = result.characters.map((c) => ({
            ...c,
            description: typeof c.description === 'object' ? JSON.stringify(c.description, null, 2) : (c.description || ''),
        }));
    }
    if (Array.isArray(result.scenes)) {
        result.scenes = result.scenes.map((s) => ({
            ...s,
            description: typeof s.description === 'object' ? JSON.stringify(s.description, null, 2) : (s.description || ''),
        }));
    }
    return result;
}
// 从损坏的 JSON 中提取数组
function extractArraysFromJson(rawJson) {
    const extracted = {};
    const fields = ['characters', 'scenes', 'episodes'];
    for (const field of fields) {
        const start = rawJson.indexOf(`"${field}"`);
        if (start !== -1) {
            const arrayStart = rawJson.indexOf('[', start);
            if (arrayStart !== -1) {
                let depth = 0;
                let arrayEnd = -1;
                let inString = false;
                let escapeNext = false;
                for (let i = arrayStart; i < rawJson.length; i++) {
                    const char = rawJson[i];
                    if (escapeNext) {
                        escapeNext = false;
                        continue;
                    }
                    if (char === '\\') {
                        escapeNext = true;
                        continue;
                    }
                    if (char === '"') {
                        inString = !inString;
                        continue;
                    }
                    if (!inString) {
                        if (char === '[')
                            depth++;
                        else if (char === ']') {
                            depth--;
                            if (depth === 0) {
                                arrayEnd = i;
                                break;
                            }
                        }
                    }
                }
                if (arrayEnd !== -1) {
                    try {
                        extracted[field] = JSON.parse(rawJson.substring(arrayStart, arrayEnd + 1));
                    }
                    catch {
                        extracted[field] = [];
                    }
                }
                else {
                    extracted[field] = [];
                }
            }
            else {
                extracted[field] = [];
            }
        }
        else {
            extracted[field] = [];
        }
    }
    if (extracted.characters || extracted.scenes || extracted.episodes)
        return extracted;
    return null;
}
// ========== 按集号从原剧本中提取对应集的内容 ==========
export async function extractEpisodesFromScript(scriptContent, episodeCount, config) {
    console.log(`[extractEpisodesFromScript] 调用 AI 拆分剧本为 ${episodeCount} 集...`);
    const prompt = `请将以下剧本按内容逻辑拆分为 ${episodeCount} 集。

【核心原则 - 绝对禁止违反】
1. 绝对禁止将同一个内容复制到多个分集
2. 绝对禁止压缩或概括原文
3. 每个分集的内容必须是剧本原文的不同部分，各自分开、不重叠

【具体拆分规则】
1. 仔细阅读剧本，找出自然的分集边界（如：时间跳跃、地点变化、重大事件）
2. 第1集从剧本开头开始，第2集从第1集结束后开始，以此类推
3. 每集的内容是剧本的连续段落，不要跳着选
4. 每集内容字数应该大致均衡（允许合理波动）

【输出格式 - 使用分隔符（不要用JSON）】
<<<EPISODE_START>>>
episodeNumber: 1
title: 第一集标题
<<<CONTENT_START>>>
这里是第一集对应的剧本原文（一字不落）
<<<CONTENT_END>>>
<<<EPISODE_END>>>

<<<EPISODE_START>>>
episodeNumber: 2
title: 第二集标题
<<<CONTENT_START>>>
这里是第二集对应的剧本原文（一字不落，必须与第一集不同）
<<<CONTENT_END>>>
<<<EPISODE_END>>>

【剧本内容（按顺序阅读，每个分集对应剧本的不同连续段落）】
${scriptContent}`;
    try {
        const callStartTime = Date.now();
        const endpoint = `${config.baseUrl || ''}/chat/completions`;
        const aiResponse = await callAI(config, [
            { role: 'system', content: '你是剧本拆分助手。拆分规则：1）每集对应剧本的不同连续段落，绝不重叠；2）第2集内容必须与第1集不同；3）禁止复制同一内容到多集；4）按分隔符格式返回。' },
            { role: 'user', content: prompt }
        ]);
        recordAICall({
            provider: config.provider || 'unknown',
            model: config.model || '',
            endpoint,
            requestTime: Date.now() - callStartTime,
            status: 'success',
            requestBody: sanitizeAICallBody({ action: 'extractEpisodes', episodeCount, scriptContentLength: scriptContent.length }),
        });
        const episodes = [];
        const episodeBlocks = aiResponse.split('<<<EPISODE_START>>>').filter(b => b.trim());
        for (const block of episodeBlocks) {
            const contentMatch = block.match(/<<<CONTENT_START>>>([\s\S]*?)<<<CONTENT_END>>>/);
            const episodeNumberMatch = block.match(/episodeNumber:\s*(\d+)/);
            const titleMatch = block.match(/title:\s*(.+?)(?:\n|<<<)/);
            if (contentMatch) {
                const episodeNumber = episodeNumberMatch ? parseInt(episodeNumberMatch[1]) : episodes.length + 1;
                const title = titleMatch ? titleMatch[1].trim() : `第${episodeNumber}集`;
                const content = contentMatch[1].trim();
                episodes.push({ episodeNumber, title, content });
            }
        }
        if (episodes.length === 0)
            throw new Error('AI 返回格式不正确，未找到分集内容');
        for (let i = 0; i < episodes.length; i++) {
            for (let j = i + 1; j < episodes.length; j++) {
                const similarity = calculateSimilarity(episodes[i].content, episodes[j].content);
                if (similarity > 0.8) {
                    console.warn(`[extractEpisodesFromScript] ⚠️ 第${i + 1}集和第${j + 1}集内容相似度 ${(similarity * 100).toFixed(1)}%，可能是重复`);
                }
            }
        }
        console.log(`[extractEpisodesFromScript] ✅ AI 返回 ${episodes.length} 个分集`);
        episodes.forEach((ep, i) => {
            console.log(`  [${i + 1}] ${ep.title}: ${ep.content.length} 字符，前50字: ${ep.content.substring(0, 50)}`);
        });
        return episodes;
    }
    catch (error) {
        console.error('[extractEpisodesFromScript] AI 拆分失败:', error);
        throw error;
    }
}
// ========== 多 Provider 自动切换脚本生成 ==========
export async function generateScriptWithFallback(prompt, systemPrompt, apiConfigs) {
    const messages = [];
    if (systemPrompt)
        messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const errors = [];
    const providersToTry = [];
    if (apiConfigs && apiConfigs.length > 0) {
        for (const config of apiConfigs) {
            if (config.apiKey && config.apiKey.trim()) {
                providersToTry.push({ config, name: config.name || config.provider });
            }
        }
    }
    if (providersToTry.length === 0) {
        for (const providerConfig of SCRIPT_PROVIDERS) {
            const providerCfg = getProviderConfig(providerConfig.provider);
            if (providerCfg.apiKey && providerCfg.apiKey.trim()) {
                const config = {
                    id: 0,
                    name: 'scriptGeneration',
                    provider: providerConfig.provider,
                    apiKey: providerCfg.apiKey,
                    model: providerConfig.model,
                    baseUrl: providerCfg.baseUrl,
                    createdAt: '',
                    updatedAt: ''
                };
                providersToTry.push({ config, name: providerConfig.name });
            }
        }
    }
    for (const { config, name } of providersToTry) {
        const callStartTime = Date.now();
        const endpoint = `${config.baseUrl || ''}/chat/completions`;
        try {
            let content;
            if (config.provider === 'idealab')
                content = await callIdealab(config, messages);
            else
                content = await callOpenAICompatible(config, messages);
            recordAICall({
                provider: config.provider || 'unknown',
                model: config.model || '',
                endpoint,
                requestTime: Date.now() - callStartTime,
                status: 'success',
                requestBody: sanitizeAICallBody({ action: 'generateScript', promptLength: prompt.length, provider: config.provider }),
            });
            return { content, provider: config.provider, providerName: name };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(`${name}: ${errorMsg}`);
            recordAICall({
                provider: config.provider || 'unknown',
                model: config.model || '',
                endpoint,
                requestTime: Date.now() - callStartTime,
                status: 'failed',
                errorMessage: errorMsg,
                requestBody: sanitizeAICallBody({ action: 'generateScript', promptLength: prompt.length, provider: config.provider }),
            });
        }
    }
    throw new Error(`所有脚本生成服务都不可用:\n${errors.join('\n')}`);
}
// ========== 辅助函数 ==========
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    if (longer.length === 0)
        return 1.0;
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}
function levenshteinDistance(str1, str2) {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++)
        matrix[i] = [i];
    for (let j = 0; j <= str1.length; j++)
        matrix[0][j] = j;
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1))
                matrix[i][j] = matrix[i - 1][j - 1];
            else
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
    }
    return matrix[str2.length][str1.length];
}
