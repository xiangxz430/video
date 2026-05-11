import { Router } from 'express';
import { generateImage } from '../services/imageGen/index.js';
import { createApiConfig } from '../services/apiClients.js';

const router = Router();

// 将结构化 JSON 描述转为自然语言
function jsonDescriptionToText(description: string): string {
  try {
    const obj = JSON.parse(description);
    if (typeof obj !== 'object' || obj === null) return description;
    const parts: string[] = [];
    
    const charInfo = obj['人物与服饰'];
    if (charInfo && typeof charInfo === 'object') {
      for (const val of Object.values(charInfo as Record<string, unknown>)) {
        if (typeof val === 'string' && val.length > 2) parts.push(val);
      }
    }
    const sceneInfo = obj['场景与光效'];
    if (sceneInfo && typeof sceneInfo === 'object') {
      for (const val of Object.values(sceneInfo as Record<string, unknown>)) {
        if (typeof val === 'string' && val.length > 2) parts.push(val);
      }
    }
    if (parts.length === 0) {
      for (const [key, val] of Object.entries(obj)) {
        if (typeof val === 'string' && val.length > 5) parts.push(val);
        else if (typeof val === 'object' && val !== null) {
          for (const v of Object.values(val as Record<string, unknown>)) {
            if (typeof v === 'string' && v.length > 5) parts.push(v);
          }
        }
      }
    }
    return parts.length > 0 ? parts.join('；') : description;
  } catch {
    return description;
  }
}

// 构建角色提示词
function buildCharacterPrompt(description: string, referenceMode: boolean = false): string {
  const cleanDesc = jsonDescriptionToText(description);
  const prefix = referenceMode ? '专业角色设计图，基于参考图片的风格和特征，' : '';
  return `${prefix}${cleanDesc}
画面布局要求：
1. 主视觉区（上方）：以纯白背景呈现人物正面、侧面、背面三个核心视角，确保五官比例、发型轮廓、服饰结构清晰可见
2. 色彩与细节区（左侧）：包含人物面部特写及专属色卡，标注主色、辅色、点缀色的HEX色值
3. 局部特写区（底部）：放大展示配饰、纹样、身份标识等关键细节，确保纹理精度
4. 比例参照区（右侧）：搭配参照物，与人物身高形成直观对比，辅助动画绑定与3D建模
5. 当要求真人时，确保人物比例符合真实人体解剖结构，头身比例协调（成人7-8头身）。
风格：${referenceMode ? '影视级角色设定图' : '高清细腻，色彩准确，光影自然，布局清晰专业'}`;
}

// 构建场景提示词
function buildScenePrompt(description: string, referenceMode: boolean = false): string {
  const cleanDesc = jsonDescriptionToText(description);
  const prefix = referenceMode ? '基于参考图片的风格和特征，' : '';

  return `${prefix}【专业环境转台参考表 - 2×2网格四视角】

场景描述：${cleanDesc}

生成要求：
这是一张专业的场景参考表，所有四个视角必须展现完全相同的场景，仅相机角度不同。

视角布局（2×2网格，等尺寸）：

[视角A - 左上] 正面视图（Front View, 0°角度）
- 正面直视空间入口和主要结构，展现正面特征

[视角B - 右上] 侧面视图（Side View, 45°角度）
- 从右侧45度角观察空间，展现纵深感和侧墙结构

[视角C - 左下] 背面视图（Back View, 180°角度）
- 从空间内部回望入口方向，展现背面墙壁和空间纵深

[视角D - 右下] 全景广角视图（Wide Establishing Shot, 远距离）
- 从远处广角展现整个空间全貌及环境关系

【空间合理性要求】
- 房间必须包含门（入口/出口）、窗户等基本建筑元素
- 家具和装饰物应多样化，不允许出现重复摆设（如多张相同的椅子可以，但不能所有家具都是同一类型）
- 空间布局应符合真实生活逻辑：有明确的功能分区、合理的动线、自然的物品摆放
- 装饰细节要丰富且有层次：墙上有画/挂饰、桌上有摆件、架子上有书籍等
- 建筑结构完整：有踢脚线、门框、窗框、天花板线条等细节

【绝对一致性约束】
- 四个视角中所有家具、装饰物、门窗位置必须完全相同，仅观察角度不同
- 统一光源方向：所有视角的光影方向和强度完全一致
- 统一色温与色彩：所有视角的色调、对比度相同
- 材质连续：地板纹理、墙面材质在四个视角中保持连贯
- 四个视角之间绝对没有任何物体增减或位置改变

【严格排除】
- 绝对不含人物、角色或任何生物
- 专注纯建筑与环境结构

风格：影视级场景概念图，专业环境转台参考表（environment turntable reference sheet），高清细腻，4K品质，透视准确，细节丰富`;
}

// POST /api/image/generate - 生成图片
router.post('/generate', async (req, res) => {
  // 图片生成耗时较长（可能60秒+），必须关闭请求超时
  req.setTimeout(0);
  res.setTimeout(0);
  
  try {
    const { prompt, provider, model, referenceImage, referenceImages: refImages, referenceImageMeta, aspectRatio, size } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: '缺少提示词' });
    }

    // 归一化：优先使用新字段名 referenceImages，兼容旧字段名 referenceImage
    let referenceImages: string[] | undefined;
    if (refImages) {
      referenceImages = Array.isArray(refImages) ? refImages : [refImages];
    } else if (referenceImage) {
      referenceImages = Array.isArray(referenceImage) ? referenceImage : [referenceImage];
    }

    const config = provider 
      ? createApiConfig(provider, model)
      : createApiConfig('volcengine');

    const imageUrl = await generateImage({
      prompt,
      referenceImages,
      referenceImageMeta,
      aspectRatio,
      size,
      model
    }, config);

    res.json({ imageUrl });
  } catch (error: any) {
    console.error('Image generate error:', error);
    res.status(500).json({ error: error.message || '图片生成失败' });
  }
});

// POST /api/image/character - 生成角色图片
router.post('/character', async (req, res) => {
  // 图片生成耗时较长，关闭请求超时
  req.setTimeout(0);
  res.setTimeout(0);
  
  try {
    const { description, referenceMode, provider, model } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: '缺少角色描述' });
    }

    const prompt = buildCharacterPrompt(description, referenceMode);
    
    const config = provider 
      ? createApiConfig(provider, model)
      : createApiConfig('dashscope', 'wan2.7-image');

    // 通过统一入口路由（根据 provider 选择正确的 handler）
    const imageUrl = await generateImage({ prompt }, config);

    res.json({ imageUrl });
  } catch (error: any) {
    console.error('Character image generate error:', error);
    res.status(500).json({ error: error.message || '角色图片生成失败' });
  }
});

// POST /api/image/scene - 生成场景图片
router.post('/scene', async (req, res) => {
  // 图片生成耗时较长，关闭请求超时
  req.setTimeout(0);
  res.setTimeout(0);
  
  try {
    const { description, referenceMode, provider, model } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: '缺少场景描述' });
    }

    const prompt = buildScenePrompt(description, referenceMode);
    
    const config = provider 
      ? createApiConfig(provider, model)
      : createApiConfig('dashscope', 'wan2.7-image');

    // 通过统一入口路由（根据 provider 选择正确的 handler）
    const imageUrl = await generateImage({ prompt }, config);

    res.json({ imageUrl });
  } catch (error: any) {
    console.error('Scene image generate error:', error);
    res.status(500).json({ error: error.message || '场景图片生成失败' });
  }
});

export { router as imageRouter };
