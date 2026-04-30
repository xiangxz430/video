import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const DATA_DIR = path.join(process.cwd(), 'data');
const KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');
// ========== 内存缓存层（消除每次请求的磁盘 I/O） ==========
// 性能关键：validateApiKey 在每个请求的 auth 中间件中被调用，
// 不能每次都读写文件。使用内存缓存 + 延迟持久化策略：
//   - 启动时从磁盘加载到内存
//   - 读取操作直接命中内存（0 磁盘 I/O）
//   - lastUsedAt 更新：仅修改内存，每 60 秒最多持久化一次
//   - 写操作（增/删/改）：立即持久化到磁盘
let keysCache = null;
let lastUsedDirty = false;
let lastUsedFlushTimer = null;
const LAST_USED_FLUSH_INTERVAL = 60_000; // 60秒
function flushLastUsed() {
    if (!lastUsedDirty || !keysCache)
        return;
    try {
        ensureDataFile();
        fs.writeFileSync(KEYS_FILE, JSON.stringify(keysCache, null, 2), 'utf-8');
        lastUsedDirty = false;
    }
    catch (error) {
        console.error('[ApiKeyService] 刷新 lastUsedAt 失败:', error);
    }
}
function markLastUsedDirty() {
    lastUsedDirty = true;
    if (!lastUsedFlushTimer) {
        lastUsedFlushTimer = setTimeout(() => {
            lastUsedFlushTimer = null;
            flushLastUsed();
        }, LAST_USED_FLUSH_INTERVAL);
    }
}
// 进程退出前保存
process.on('beforeExit', flushLastUsed);
process.on('SIGTERM', () => { flushLastUsed(); process.exit(0); });
process.on('SIGINT', () => { flushLastUsed(); process.exit(0); });
// 确保 data 目录和文件存在
function ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(KEYS_FILE)) {
        fs.writeFileSync(KEYS_FILE, JSON.stringify({ keys: [] }, null, 2), 'utf-8');
    }
}
// 读取所有 keys（仅启动/强制刷新时调用，正常流程走内存缓存）
function loadKeys() {
    ensureDataFile();
    const content = fs.readFileSync(KEYS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    keysCache = parsed; // 同步更新缓存
    return parsed;
}
// 获取内存缓存（若未初始化则从磁盘加载）
function getCache() {
    if (!keysCache) {
        keysCache = loadKeys();
    }
    return keysCache;
}
// 保存 keys（带错误处理，防止写入失败导致进程崩溃）
function saveKeys(data) {
    try {
        ensureDataFile();
        fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        keysCache = data; // 同步更新内存缓存
        lastUsedDirty = false;
    }
    catch (error) {
        console.error('[ApiKeyService] 保存密钥文件失败:', error);
    }
}
// 生成 UUID
function generateId() {
    return crypto.randomUUID();
}
// 生成新 API Key
export function generateApiKey(name) {
    const key = 'vg_' + crypto.randomBytes(16).toString('hex');
    const record = {
        id: generateId(),
        key,
        name,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        enabled: true,
    };
    const data = getCache();
    data.keys.push(record);
    saveKeys(data);
    return record;
}
// 获取所有 key（列表展示时隐藏部分字符）
export function listApiKeys() {
    const data = getCache();
    return data.keys.map((k) => ({
        id: k.id,
        name: k.name,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        enabled: k.enabled,
        maskedKey: maskKey(k.key),
    }));
}
// 隐藏 key 中间字符（统一脱敏函数，勿在不同文件中重复实现）
//   - key长度 ≤ 8: 前3 + *** + 后3
//   - key长度 > 8:  前6 + **** + 后6
export function maskKey(key) {
    if (!key)
        return 'unknown';
    if (key.length <= 8) {
        return key.slice(0, 3) + '***' + key.slice(-3);
    }
    return key.slice(0, 6) + '****' + key.slice(-6);
}
// 删除 key
export function deleteApiKey(id) {
    const data = getCache();
    const index = data.keys.findIndex((k) => k.id === id);
    if (index === -1) {
        return false;
    }
    data.keys.splice(index, 1);
    saveKeys(data);
    return true;
}
// 启用/禁用 key
export function toggleApiKey(id, enabled) {
    const data = getCache();
    const record = data.keys.find((k) => k.id === id);
    if (!record) {
        return false;
    }
    record.enabled = enabled;
    saveKeys(data);
    return true;
}
// 验证 key 是否有效（供 auth 中间件使用）
// 性能优化：直接使用内存缓存，不读磁盘，lastUsedAt 延迟批量写回
// 返回 keyId（供日志按用户分区使用），无效返回 null
export function validateApiKey(key) {
    const data = getCache(); // 内存读取，0 I/O
    const record = data.keys.find((k) => k.key === key && k.enabled);
    if (record) {
        record.lastUsedAt = new Date().toISOString();
        markLastUsedDirty(); // 延迟写回，不阻塞请求
        return record.id; // 返回 keyId 而非 boolean
    }
    return null;
}
// 检查 key 是否已存在
export function keyExists(key) {
    const data = getCache();
    return data.keys.some((k) => k.key === key);
}
// 初始化：如果环境变量中有 API_KEY 且不在 json 文件中，自动添加为第一个 key
export function initializeFromEnv(envApiKey) {
    if (!envApiKey)
        return;
    ensureDataFile();
    const data = getCache();
    // 检查是否已存在
    if (!data.keys.some((k) => k.key === envApiKey)) {
        const record = {
            id: generateId(),
            key: envApiKey,
            name: '默认密钥',
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            enabled: true,
        };
        data.keys.push(record);
        saveKeys(data);
        console.log('[API Key] 已从环境变量导入默认密钥');
    }
}
