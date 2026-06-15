import { MongoClient, Db, Collection } from 'mongodb';
import { config } from '../config/index.js';
import { RequestLog } from '../types/index.js';
import type { ApiKeyRecord } from './apiKeyService.js';
import fs from 'fs';
import path from 'path';

// ========== MongoDB 连接管理 ==========
// 单例模式：整个应用共享一个 MongoClient 连接池
// 阿里云 ApsaraDB for MongoDB 连接串示例：
//   mongodb://user:password@dds-xxx.mongodb.rds.aliyuncs.com:3717,dds-xxx2.mongodb.rds.aliyuncs.com:3717/video_generator?replicaSet=mgset-xxx&authSource=admin

const COLLECTION_NAME = 'request_logs';
const API_KEYS_COLLECTION = 'api_keys';

let client: MongoClient | null = null;
let db: Db | null = null;
let logsCollection: Collection<RequestLog> | null = null;
let apiKeysCollection: Collection<ApiKeyRecord> | null = null;

/**
 * 连接 MongoDB 并初始化索引
 */
export async function connectMongo(): Promise<void> {
  if (client) return;

  try {
    client = new MongoClient(config.mongodb.uri);
    await client.connect();
    db = client.db(config.mongodb.dbName);
    logsCollection = db.collection<RequestLog>(COLLECTION_NAME);
    apiKeysCollection = db.collection<ApiKeyRecord>(API_KEYS_COLLECTION);

    // 创建索引（幂等操作，已存在则跳过）
    await logsCollection.createIndex({ keyId: 1, timestamp: -1 });
    await logsCollection.createIndex({ apiKeyMasked: 1, timestamp: -1 });
    await logsCollection.createIndex({ id: 1 }, { unique: true });
    await logsCollection.createIndex({ timestamp: -1 });
    await logsCollection.createIndex({ function: 1 });
    await logsCollection.createIndex({ provider: 1 });

    // api_keys 集合索引
    await apiKeysCollection.createIndex({ id: 1 }, { unique: true });
    await apiKeysCollection.createIndex({ key: 1 }, { unique: true });

    console.log(`[MongoDB] 已连接: ${maskMongoUri(config.mongodb.uri)}, 数据库: ${config.mongodb.dbName}`);

    // 迁移旧 JSON 日志文件到 MongoDB
    await migrateFromJsonFiles();
  } catch (error) {
    console.error('[MongoDB] 连接失败:', error);
    throw error;
  }
}

/**
 * 获取日志集合（确保已连接）
 */
export function getLogsCollection(): Collection<RequestLog> {
  if (!logsCollection) {
    throw new Error('[MongoDB] 未连接，请先调用 connectMongo()');
  }
  return logsCollection;
}

/**
 * 关闭 MongoDB 连接
 */
export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logsCollection = null;
    apiKeysCollection = null;
    console.log('[MongoDB] 连接已关闭');
  }
}

// ========== API Keys 集合操作 ==========

/**
 * 获取 api_keys 集合（确保已连接）
 */
export function getApiKeysCollection(): Collection<ApiKeyRecord> | null {
  return apiKeysCollection;
}

/**
 * 检查 MongoDB 是否已连接
 */
export function isMongoConnected(): boolean {
  return client !== null && db !== null;
}

/**
 * 获取所有 API Key
 */
export async function getAllApiKeys(): Promise<ApiKeyRecord[]> {
  if (!apiKeysCollection) return [];
  return await apiKeysCollection.find({}).toArray() as unknown as ApiKeyRecord[];
}

/**
 * 保存单个 API Key
 */
export async function saveApiKey(key: ApiKeyRecord): Promise<void> {
  if (!apiKeysCollection) throw new Error('[MongoDB] 未连接');
  await apiKeysCollection.updateOne(
    { id: key.id },
    { $set: key },
    { upsert: true }
  );
}

/**
 * 删除 API Key
 */
export async function deleteApiKeyFromDb(id: string): Promise<boolean> {
  if (!apiKeysCollection) throw new Error('[MongoDB] 未连接');
  const result = await apiKeysCollection.deleteOne({ id });
  return result.deletedCount > 0;
}

/**
 * 更新 API Key（部分字段）
 */
export async function updateApiKeyInDb(id: string, updates: Partial<ApiKeyRecord>): Promise<boolean> {
  if (!apiKeysCollection) throw new Error('[MongoDB] 未连接');
  const result = await apiKeysCollection.updateOne(
    { id },
    { $set: updates }
  );
  return result.matchedCount > 0;
}

/**
 * 批量更新 lastUsedAt（定时刷新用）
 */
export async function bulkUpdateLastUsed(updates: Array<{ id: string; lastUsedAt: string }>): Promise<void> {
  if (!apiKeysCollection || updates.length === 0) return;
  const ops = updates.map(u => ({
    updateOne: {
      filter: { id: u.id },
      update: { $set: { lastUsedAt: u.lastUsedAt } }
    }
  }));
  await apiKeysCollection.bulkWrite(ops, { ordered: false });
}

/**
 * 从 api-keys.json 迁移到 MongoDB
 */
export async function migrateApiKeysFromJson(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  const keysFile = path.join(dataDir, 'api-keys.json');
  const migrationFlag = path.join(dataDir, '.apikeys-migrated');

  // 已迁移过则跳过
  if (fs.existsSync(migrationFlag)) return;

  if (!apiKeysCollection) {
    console.warn('[MongoDB] api_keys 集合未初始化，跳过迁移');
    return;
  }

  // 读取旧 JSON 文件
  if (!fs.existsSync(keysFile)) {
    // 无旧文件，直接标记完成
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(migrationFlag, new Date().toISOString());
    return;
  }

  try {
    const content = fs.readFileSync(keysFile, 'utf-8');
    const data = JSON.parse(content) as { keys: ApiKeyRecord[] };
    if (!Array.isArray(data.keys) || data.keys.length === 0) {
      fs.writeFileSync(migrationFlag, new Date().toISOString());
      return;
    }

    // 逐条 upsert，避免重复 key 冲突
    let migratedCount = 0;
    for (const key of data.keys) {
      try {
        await apiKeysCollection.updateOne(
          { id: key.id },
          { $set: key },
          { upsert: true }
        );
        migratedCount++;
      } catch (err: any) {
        if (err.code === 11000) {
          // 重复 key，跳过
          continue;
        }
        console.warn(`[MongoDB] 迁移 API Key ${key.id} 失败:`, err.message);
      }
    }

    console.log(`[MongoDB] 已迁移 ${migratedCount}/${data.keys.length} 个 API Key 到 MongoDB`);
    fs.writeFileSync(migrationFlag, new Date().toISOString());
  } catch (error) {
    console.error('[MongoDB] 迁移 API Keys 失败:', error);
    // 迁移失败不阻塞启动
  }
}

/**
 * 脱敏 MongoDB URI（隐藏密码，用于日志输出）
 */
function maskMongoUri(uri: string): string {
  // mongodb://user:password@host:port/db → mongodb://user:****@host:port/db
  return uri.replace(/:([^@]+)@/, ':****@');
}

/**
 * 迁移旧 JSON 日志文件到 MongoDB
 * - 读取 data/logs/*.json（按用户拆分）和 data/request-logs.json（旧单文件）
 * - 去重后批量插入 MongoDB
 * - 迁移完成后备份旧文件
 */
async function migrateFromJsonFiles(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  const logsDir = path.join(dataDir, 'logs');
  const legacyFile = path.join(dataDir, 'request-logs.json');
  const migrationFlag = path.join(dataDir, '.mongodb-migrated');

  // 已迁移过则跳过
  if (fs.existsSync(migrationFlag)) return;

  const allLogs: RequestLog[] = [];

  // 1. 读取按用户拆分的日志文件
  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');
        const data = JSON.parse(content) as { logs: RequestLog[] };
        if (Array.isArray(data.logs)) allLogs.push(...data.logs);
      } catch { /* 跳过损坏文件 */ }
    }
  }

  // 2. 读取旧版单文件
  if (fs.existsSync(legacyFile)) {
    try {
      const content = fs.readFileSync(legacyFile, 'utf-8');
      const data = JSON.parse(content) as { logs: RequestLog[] };
      if (Array.isArray(data.logs)) allLogs.push(...data.logs);
    } catch { /* 跳过损坏文件 */ }
  }

  if (allLogs.length === 0) {
    fs.writeFileSync(migrationFlag, new Date().toISOString());
    return;
  }

  // 3. 去重（按 id 字段）
  const seen = new Set<string>();
  const uniqueLogs = allLogs.filter(log => {
    if (seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });

  // 4. 为缺少 keyId 的旧日志补充 keyId（用 apiKeyMasked 降级）
  for (const log of uniqueLogs) {
    if (!log.keyId) {
      log.keyId = log.apiKeyMasked || 'unknown';
    }
  }

  // 5. 批量插入（忽略重复 key 冲突）
  try {
    const collection = getLogsCollection();
    const result = await collection.insertMany(uniqueLogs as any[], { ordered: false });
    console.log(`[MongoDB] 已迁移 ${result.insertedCount}/${uniqueLogs.length} 条旧日志`);

    // 备份旧文件
    if (fs.existsSync(logsDir)) {
      const backupDir = path.join(dataDir, 'logs.bak');
      if (!fs.existsSync(backupDir)) fs.renameSync(logsDir, backupDir);
    }
    if (fs.existsSync(legacyFile)) {
      fs.renameSync(legacyFile, legacyFile + '.bak');
    }

    fs.writeFileSync(migrationFlag, new Date().toISOString());
  } catch (error: any) {
    // insertMany 部分失败（重复 key）是正常的
    if (error.code === 11000) {
      console.log('[MongoDB] 旧日志部分已存在，跳过重复条目');
      fs.writeFileSync(migrationFlag, new Date().toISOString());
    } else {
      console.error('[MongoDB] 迁移旧日志失败:', error);
    }
  }
}
