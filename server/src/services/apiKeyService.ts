import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');

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

// 读取所有 keys
function loadKeys(): KeysData {
  ensureDataFile();
  const content = fs.readFileSync(KEYS_FILE, 'utf-8');
  return JSON.parse(content) as KeysData;
}

// 保存 keys
function saveKeys(data: KeysData): void {
  ensureDataFile();
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), 'utf-8');
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

  const data = loadKeys();
  data.keys.push(record);
  saveKeys(data);

  return record;
}

// 获取所有 key（列表展示时隐藏部分字符）
export function listApiKeys(): Array<Omit<ApiKeyRecord, 'key'> & { maskedKey: string }> {
  const data = loadKeys();
  return data.keys.map((k) => ({
    id: k.id,
    name: k.name,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    enabled: k.enabled,
    maskedKey: maskKey(k.key),
  }));
}

// 隐藏 key 中间字符
function maskKey(key: string): string {
  if (key.length <= 8) {
    return key.slice(0, 3) + '***' + key.slice(-3);
  }
  return key.slice(0, 6) + '****' + key.slice(-6);
}

// 删除 key
export function deleteApiKey(id: string): boolean {
  const data = loadKeys();
  const index = data.keys.findIndex((k) => k.id === id);
  if (index === -1) {
    return false;
  }
  data.keys.splice(index, 1);
  saveKeys(data);
  return true;
}

// 启用/禁用 key
export function toggleApiKey(id: string, enabled: boolean): boolean {
  const data = loadKeys();
  const record = data.keys.find((k) => k.id === id);
  if (!record) {
    return false;
  }
  record.enabled = enabled;
  saveKeys(data);
  return true;
}

// 验证 key 是否有效（供 auth 中间件使用）
export function validateApiKey(key: string): boolean {
  const data = loadKeys();
  const record = data.keys.find((k) => k.key === key && k.enabled);
  if (record) {
    // 更新 lastUsedAt
    record.lastUsedAt = new Date().toISOString();
    saveKeys(data);
    return true;
  }
  return false;
}

// 检查 key 是否已存在
export function keyExists(key: string): boolean {
  const data = loadKeys();
  return data.keys.some((k) => k.key === key);
}

// 初始化：如果环境变量中有 API_KEY 且不在 json 文件中，自动添加为第一个 key
export function initializeFromEnv(envApiKey: string): void {
  if (!envApiKey) return;

  ensureDataFile();
  const data = loadKeys();

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
    saveKeys(data);
    console.log('[API Key] 已从环境变量导入默认密钥');
  }
}
