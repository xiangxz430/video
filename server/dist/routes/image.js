import { Router } from 'express';
import { generateImage, generateWanxImage } from '../services/imageGen/index.js';
import { createApiConfig } from '../services/apiClients.js';
const router = Router();
// 将结构化 JSON 描述转为自然语言
function jsonDescriptionToText(description) {
    try {
        const obj = JSON.parse(description);
        if (typeof obj !== 'object' || obj === null)
            return description;
        const parts = [];
        const charInfo = obj['人物与服饰'];
        if (charInfo && typeof charInfo === 'object') {
            for (const val of Object.values(charInfo)) {
                if (typeof val === 'string' && val.length > 2)
                    parts.push(val);
            }
        }
        const sceneInfo = obj['场景与光效'];
        if (sceneInfo && typeof sceneInfo === 'object') {
            for (const val of Object.values(sceneInfo)) {
                if (typeof val === 'string' && val.length > 2)
                    parts.push(val);
            }
        }
        if (parts.length === 0) {
            for (const [key, val] of Object.entries(obj)) {
                if (typeof val === 'string' && val.length > 5)
                    parts.push(val);
                else if (typeof val === 'object' && val !== null) {
                    for (const v of Object.values(val)) {
                        if (typeof v === 'string' && v.length > 5)
                            parts.push(v);
                    }
                }
            }
        }
        return parts.length > 0 ? parts.join('；') : description;
    }
    catch {
        return description;
    }
}
// 构建角色提示词
function buildCharacterPrompt(description, referenceMode = false) {
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
function buildScenePrompt(description, referenceMode = false) {
    const cleanDesc = jsonDescriptionToText(description);
    const prefix = referenceMode ? '基于参考图片的风格和特征，' : '';
    return `${prefix}${cleanDesc}
画面布局要求（2×2 网格，同一场景四视角展示）：
1. 左上角 - 正视图（Front View）：正面视角展现场景主体结构与入口布局
2. 右上角 - 侧视图（Side/3-Quarter View）：45度角展现空间纵深与侧立面细节
3. 左下角 - 俯视图（Top-Down/Overhead）：鸟瞰视角展现整体平面布局与动线设计
4. 右下角 - 全景 Establishing Shot：广角展现场景全貌与周围环境关系
5. 确保四图光影一致、材质统一、空间逻辑自洽，可用作3D建模与关卡设计的参考。
风格：影视级场景概念图，环境转台参考表，高清细腻，透视准确，细节丰富`;
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
        let referenceImages;
        if (refImages) {
            referenceImages = Array.isArray(refImages) ? refImages : [refImages];
        }
        else if (referenceImage) {
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
    }
    catch (error) {
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
        // 角色图片使用 Wan2.7-Image
        const config = provider
            ? createApiConfig(provider, model)
            : createApiConfig('dashscope', 'wan2.7-image');
        const imageUrl = await generateWanxImage(config, { prompt });
        res.json({ imageUrl });
    }
    catch (error) {
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
        // 场景图片使用 Wan2.7-Image
        const config = provider
            ? createApiConfig(provider, model)
            : createApiConfig('dashscope', 'wan2.7-image');
        const imageUrl = await generateWanxImage(config, { prompt });
        res.json({ imageUrl });
    }
    catch (error) {
        console.error('Scene image generate error:', error);
        res.status(500).json({ error: error.message || '场景图片生成失败' });
    }
});
export { router as imageRouter };
