import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isMongoConnected,
  getAllApiKeys,
  saveApiKey as saveApiKeyToDb,
  deleteApiKeyFromDb,
  updateApiKeyInDb,
  bulkUpdateLastUsed,
} from './mongoService.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');

// ========== 内存缓存层（消除每次请求的磁盘 I/O） ==========
// 性能关键：validateApiKey 在每个请求的 auth 中间件中被调用，
// 不能每次都读写文件/数据库。使用内存缓存 + 延迟持久化策略：
//   - 启动时从 MongoDB 加载到内存（降级时从磁盘加载）
//   - 读取操作直接命中内存（0 I/O）
//   - lastUsedAt 更新：仅修改内存，每 60 秒批量同步到 MongoDB
//   - 写操作（增/删/改）：立即持久化到 MongoDB

let keysCache: KeysData | null = null;
let lastUsedDirty = false;
let lastUsedFlushTimer: ReturnType<typeof setTimeout> | null = null;
const LAST_USED_FLUSH_INTERVAL = 60_000; // 60秒

// MongoDB 是否可用（降级标志）
let useMongoDb = false;

async function flushLastUsed(): Promise<void> {
  if (!lastUsedDirty || !keysCache) return;

  if (useMongoDb) {
    try {
      const updates = keysCache.keys
        .filter(k => k.lastUsedAt)
        .map(k => ({ id: k.id, lastUsedAt: k.lastUsedAt! }));
      await bulkUpdateLastUsed(updates);
      lastUsedDirty = false;
    } catch (error) {
      console.error('[ApiKeyService] 刷新 lastUsedAt 到 MongoDB 失败:', error);
      // 降级到文件
      flushLastUsedToFile();
    }
  } else {
    flushLastUsedToFile();
  }
}

function flushLastUsedToFile(): void {
  if (!lastUsedDirty || !keysCache) return;
  try {
    ensureDataFile();
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keysCache, null, 2), 'utf-8');
    lastUsedDirty = false;
  } catch (error) {
    console.error('[ApiKeyService] 刷新 lastUsedAt 到文件失败:', error);
  }
}

function markLastUsedDirty(): void {
  lastUsedDirty = true;
  if (!lastUsedFlushTimer) {
    lastUsedFlushTimer = setTimeout(() => {
      lastUsedFlushTimer = null;
      flushLastUsed();
    }, LAST_USED_FLUSH_INTERVAL);
  }
}

// 进程退出前保存
process.on('beforeExit', () => { flushLastUsed(); });
process.on('SIGTERM', () => { flushLastUsedToFile(); process.exit(0); });
process.on('SIGINT', () => { flushLastUsedToFile(); process.exit(0); });

export interface ApiKeyRecord {
  id: string;
  key: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  enabled: boolean;
}

interface KeysData {
  keys: ApiKeyRecord[];
}

// 确保 data 目录和文件存在
function ensureDataFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(KEYS_FILE)) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify({ keys: [] }, null, 2), 'utf-8');
  }
}

// 从文件加载 keys（降级模式使用）
function loadKeysFromFile(): KeysData {
  ensureDataFile();
  const content = fs.readFileSync(KEYS_FILE, 'utf-8');
  const parsed = JSON.parse(content) as KeysData;
  keysCache = parsed;
  return parsed;
}

// 从 MongoDB 加载 keys 到内存缓存
export async function loadFromDatabase(): Promise<void> {
  if (!isMongoConnected()) {
    console.warn('[ApiKeyService] MongoDB 未连接，降级到文件模式');
    useMongoDb = false;
    loadKeysFromFile();
    return;
  }

  try {
    const keys = await getAllApiKeys();
    keysCache = { keys };
    useMongoDb = true;
    console.log(`[ApiKeyService] 已从 MongoDB 加载 ${keys.length} 个 API Key`);
  } catch (error) {
    console.error('[ApiKeyService] 从 MongoDB 加载失败，降级到文件模式:', error);
    useMongoDb = false;
    loadKeysFromFile();
  }
}

// 获取内存缓存（若未初始化则从文件加载作为降级）
function getCache(): KeysData {
  if (!keysCache) {
    loadKeysFromFile();
  }
  return keysCache!;
}

// 保存 keys 到文件（降级备份用）
function saveKeysToFile(data: KeysData): void {
  try {
    ensureDataFile();
    fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[ApiKeyService] 保存密钥文件失败:', error);
  }
}

// 生成 UUID
function generateId(): string {
  return crypto.randomUUID();
}

// 生成新 API Key
export function generateApiKey(name: string): ApiKeyRecord {
  const key = 'vg_' + crypto.randomBytes(16).toString('hex');
  const record: ApiKeyRecord = {
    id: generateId(),
    key,
    name,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    enabled: true,
  };

  const data = getCache();
  data.keys.push(record);
  keysCache = data;

  // 异步写入 MongoDB（不阻塞响应）
  if (useMongoDb) {
    saveApiKeyToDb(record).catch(err => {
      console.error('[ApiKeyService] 保存到 MongoDB 失败:', err);
      saveKeysToFile(data); // 降级写文件
    });
  } else {
    saveKeysToFile(data);
  }

  return record;
}

// 获取所有 key（列表展示时隐藏部分字符）
export function listApiKeys(): Array<Omit<ApiKeyRecord, 'key'> & { maskedKey: string }> {
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
export function maskKey(key: string): string {
  if (!key) return 'unknown';
  if (key.length <= 8) {
    return key.slice(0, 3) + '***' + key.slice(-3);
  }
  return key.slice(0, 6) + '****' + key.slice(-6);
}

// 删除 key
export function deleteApiKey(id: string): boolean {
  const data = getCache();
  const index = data.keys.findIndex((k) => k.id === id);
  if (index === -1) {
    return false;
  }
  data.keys.splice(index, 1);
  keysCache = data;

  if (useMongoDb) {
    deleteApiKeyFromDb(id).catch(err => {
      console.error('[ApiKeyService] 从 MongoDB 删除失败:', err);
      saveKeysToFile(data);
    });
  } else {
    saveKeysToFile(data);
  }
  return true;
}

// 启用/禁用 key
export function toggleApiKey(id: string, enabled: boolean): boolean {
  const data = getCache();
  const record = data.keys.find((k) => k.id === id);
  if (!record) {
    return false;
  }
  record.enabled = enabled;
  keysCache = data;

  if (useMongoDb) {
    updateApiKeyInDb(id, { enabled }).catch(err => {
      console.error('[ApiKeyService] 更新 MongoDB 失败:', err);
      saveKeysToFile(data);
    });
  } else {
    saveKeysToFile(data);
  }
  return true;
}

// 验证 key 是否有效（供 auth 中间件使用）
// 性能优化：直接使用内存缓存，不读磁盘/数据库，lastUsedAt 延迟批量写回
// 返回 keyId（供日志按用户分区使用），无效返回 null
export function validateApiKey(key: string): string | null {
  const data = getCache();  // 内存读取，0 I/O
  const record = data.keys.find((k) => k.key === key && k.enabled);
  if (record) {
    record.lastUsedAt = new Date().toISOString();
    markLastUsedDirty();  // 延迟写回，不阻塞请求
    return record.id;  // 返回 keyId 而非 boolean
  }
  return null;
}

// 检查 key 是否已存在
export function keyExists(key: string): boolean {
  const data = getCache();
  return data.keys.some((k) => k.key === key);
}

// 初始化：如果环境变量中有 API_KEY 且不在数据库中，自动添加为第一个 key
export async function initializeFromEnv(envApiKey: string): Promise<void> {
  if (!envApiKey) return;

  const data = getCache();

  // 检查是否已存在
  if (!data.keys.some((k) => k.key === envApiKey)) {
    const record: ApiKeyRecord = {
      id: generateId(),
      key: envApiKey,
      name: '默认密钥',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      enabled: true,
    };
    data.keys.push(record);
    keysCache = data;

    if (useMongoDb) {
      try {
        await saveApiKeyToDb(record);
      } catch (err) {
        console.error('[ApiKeyService] 保存默认密钥到 MongoDB 失败:', err);
        saveKeysToFile(data);
      }
    } else {
      saveKeysToFile(data);
    }
    console.log('[API Key] 已从环境变量导入默认密钥');
  }
}
