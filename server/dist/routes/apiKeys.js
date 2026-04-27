import { Router } from 'express';
import { generateApiKey, listApiKeys, deleteApiKey, toggleApiKey, } from '../services/apiKeyService.js';
const router = Router();
// POST /api/admin/keys - 生成新 key
router.post('/', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: '缺少 name 参数' });
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 50) {
        return res.status(400).json({ error: 'name 长度不能超过 50 字符' });
    }
    try {
        const record = generateApiKey(trimmedName);
        res.status(201).json({
            success: true,
            data: record,
        });
    }
    catch (error) {
        console.error('生成 API Key 失败:', error);
        res.status(500).json({ error: '生成 API Key 失败' });
    }
});
// GET /api/admin/keys - 列出所有 key
router.get('/', (req, res) => {
    try {
        const keys = listApiKeys();
        res.json({
            success: true,
            data: keys,
        });
    }
    catch (error) {
        console.error('获取 API Key 列表失败:', error);
        res.status(500).json({ error: '获取 API Key 列表失败' });
    }
});
// DELETE /api/admin/keys/:id - 删除某个 key
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ error: '缺少 id 参数' });
    }
    try {
        const success = deleteApiKey(id);
        if (!success) {
            return res.status(404).json({ error: 'API Key 不存在' });
        }
        res.json({
            success: true,
            message: 'API Key 已删除',
        });
    }
    catch (error) {
        console.error('删除 API Key 失败:', error);
        res.status(500).json({ error: '删除 API Key 失败' });
    }
});
// PATCH /api/admin/keys/:id - 启用/禁用
router.patch('/:id', (req, res) => {
    const { id } = req.params;
    const { enabled } = req.body;
    if (!id) {
        return res.status(400).json({ error: '缺少 id 参数' });
    }
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled 必须是布尔值' });
    }
    try {
        const success = toggleApiKey(id, enabled);
        if (!success) {
            return res.status(404).json({ error: 'API Key 不存在' });
        }
        res.json({
            success: true,
            message: `API Key 已${enabled ? '启用' : '禁用'}`,
        });
    }
    catch (error) {
        console.error('更新 API Key 状态失败:', error);
        res.status(500).json({ error: '更新 API Key 状态失败' });
    }
});
export { router as apiKeysRouter };
