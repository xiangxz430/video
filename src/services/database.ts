import Database from '@tauri-apps/plugin-sql';
import type { Script, Character, Scene, Episode, Segment, ApiConfig } from '../types';

let db: Database | null = null;

// 外部设置的日志回调（由 Episodes.tsx 设置）
let pageLogCallback: ((log: string) => void) | null = null;

export function setPageLogCallback(cb: ((log: string) => void) | null) {
  pageLogCallback = cb;
}

// 初始化数据库
export async function initDatabase(): Promise<Database> {
  if (db) {
    console.log('Database already initialized');
    return db;
  }
  
  console.log('Initializing database...');
  try {
    // 使用 SQLite 数据库
    db = await Database.load('sqlite:video_generator.db');
    console.log('Database loaded successfully');
    
    // 创建表
    await createTables();
    console.log('Database tables created successfully');
    
    return db;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    // 重置db为null，允许下次重试
    db = null;
    throw error;
  }
}

// 获取数据库实例
export function getDatabase(): Database | null {
  return db;
}

// 创建所有表
async function createTables(): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  // 剧本表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      custom_characters TEXT,
      custom_scenes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // 迁移：如果旧表没有 custom_characters 或 custom_scenes 列，则添加
  try {
    const tableInfo = await db.select<{ name: string }[]>('PRAGMA table_info(scripts)');
    const hasCustomCharacters = tableInfo.some((col: any) => col.name === 'custom_characters');
    const hasCustomScenes = tableInfo.some((col: any) => col.name === 'custom_scenes');
    if (!hasCustomCharacters) {
      await db.execute('ALTER TABLE scripts ADD COLUMN custom_characters TEXT');
      console.log('Added custom_characters column to scripts table');
    }
    if (!hasCustomScenes) {
      await db.execute('ALTER TABLE scripts ADD COLUMN custom_scenes TEXT');
      console.log('Added custom_scenes column to scripts table');
    }
  } catch (e) {
    console.log('Migration check for custom columns:', e);
  }
  
  // 角色表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT,
      voice_description TEXT,
      is_main BOOLEAN DEFAULT 0,
      script_id INTEGER NOT NULL,
      alternative_images TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
    )
  `);
  
  // 迁移：如果旧表没有 alternative_images 列，则添加
  try {
    const tableInfo = await db.select<{ name: string }[]>('PRAGMA table_info(characters)');
    const hasAlternativeImages = tableInfo.some((col: any) => col.name === 'alternative_images');
    if (!hasAlternativeImages) {
      await db.execute('ALTER TABLE characters ADD COLUMN alternative_images TEXT');
      console.log('Added alternative_images column to characters table');
    }
  } catch (e) {
    console.log('Migration check for alternative_images:', e);
  }
  
  // 场景表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT,
      episodes TEXT, -- JSON 数组
      script_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
    )
  `);
  
  // 分集表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      episode_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'incomplete',
      duration INTEGER,
      script_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
    )
  `);
  
  // 片段表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      content TEXT NOT NULL,
      character_id INTEGER,
      scene_id INTEGER,
      order_index INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL
    )
  `);
  
  // API 配置表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      base_url TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // 迁移：如果旧表没有 description 列，则添加
  try {
    const tableInfo = await db.select<{ name: string }[]>('PRAGMA table_info(api_configs)');
    const hasDescription = tableInfo.some((col: any) => col.name === 'description');
    if (!hasDescription) {
      await db.execute('ALTER TABLE api_configs ADD COLUMN description TEXT');
      console.log('Added description column to api_configs table');
    }
  } catch (e) {
    console.log('Migration check for description:', e);
  }
  
  // 清理 api_configs 表中的重复记录（保留 id 最小的那条）
  try {
    const duplicates = await db.select<any[]>(`
      SELECT id, provider, model, name FROM api_configs
      WHERE id NOT IN (
        SELECT MIN(id) FROM api_configs
        GROUP BY provider, model
      )
    `);
    
    if (duplicates && duplicates.length > 0) {
      console.log(`Found ${duplicates.length} duplicate api_configs, deleting...`);
      // 逐个删除，避免 SQL 拼接
      for (const dup of duplicates) {
        await db.execute(`DELETE FROM api_configs WHERE id = ?`, [dup.id]);
      }
      console.log('Deleted duplicate api_configs successfully');
    }
  } catch (e) {
    console.log('Cleanup duplicate api_configs:', e);
  }
  
  // 迁移：更新旧的 DeepSeek API 密钥
  try {
    const oldDeepseekKey = 'sk-31428f6c42e242a7b0ac10581c4ed017';
    const newDeepseekKey = 'sk-2b253d4e956642d8a100d94a4db56b11';
    
    const existingDeepseek = await db.select<any[]>(
      `SELECT id, api_key FROM api_configs WHERE provider = 'deepseek' AND api_key = ?`,
      [oldDeepseekKey]
    );
    
    if (existingDeepseek && existingDeepseek.length > 0) {
      console.log(`Updating ${existingDeepseek.length} DeepSeek config(s) with new API key...`);
      await db.execute(
        `UPDATE api_configs SET api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = 'deepseek' AND api_key = ?`,
        [newDeepseekKey, oldDeepseekKey]
      );
      console.log('Updated DeepSeek API key successfully');
    }
  } catch (e) {
    console.log('Migration DeepSeek API key:', e);
  }
  
  // 图片历史表（存储所有生成的图片）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS image_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_type TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      asset_name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      local_path TEXT,
      prompt TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // 首页生成图片历史表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS generated_image_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_path TEXT NOT NULL,
      prompt TEXT,
      model TEXT,
      size TEXT,
      aspect_ratio TEXT,
      asset_type TEXT,
      asset_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // 迁移：如果 generated_image_history 没有 asset_type 列，则添加
  try {
    const tableInfo = await db.select<{ name: string }[]>('PRAGMA table_info(generated_image_history)');
    const hasAssetType = tableInfo.some((col: any) => col.name === 'asset_type');
    if (!hasAssetType) {
      await db.execute('ALTER TABLE generated_image_history ADD COLUMN asset_type TEXT');
      await db.execute('ALTER TABLE generated_image_history ADD COLUMN asset_id INTEGER');
      console.log('Added asset_type and asset_id columns to generated_image_history');
    }
  } catch (e) {
    console.log('Migration check for generated_image_history columns:', e);
  }
  
  // 分集角色穿着选择表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS episode_character_outfits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      outfit_index INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(episode_id, character_id)
    )
  `);
  
  // 首页视频生成历史表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS home_video_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_path TEXT,
      remote_url TEXT,
      prompt TEXT,
      model TEXT,
      duration INTEGER,
      has_audio INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // 插入默认 API 配置
  await initDefaultApiConfigs();
  
  // 迁移：更新旧的 OpenRouter 模型 ID
  await migrateOpenRouterModelIds();
  
  // 迁移：插入 DeepSeek V4 Pro 配置（如不存在）
  await migrateDeepSeekV4Pro();
}

// 初始化默认 API 配置
// 注意：默认配置只在数据库中不存在时插入，不会覆盖用户已有的配置
async function initDefaultApiConfigs(): Promise<void> {
  if (!db) return;
  
  // 默认配置列表 - 仅在首次启动或配置不存在时插入
  const defaultConfigs = [
    // 火山方舟
    { name: 'scriptGeneration', provider: 'volcengine', apiKey: 'f0ba8598-e4cf-4c30-94ea-a58e91f8d08f', model: 'doubao-1-5-pro-32k-250115', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
    { name: 'imageGeneration', provider: 'volcengine', apiKey: 'f0ba8598-e4cf-4c30-94ea-a58e91f8d08f', model: 'doubao-seedream-5-0-260128', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
    { name: 'videoGeneration', provider: 'volcengine', apiKey: 'f0ba8598-e4cf-4c30-94ea-a58e91f8d08f', model: 'doubao-seedance-1-5-pro-251215', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
    { name: 'videoGeneration_seedance-2-0-fast', provider: 'volcengine', apiKey: 'f0ba8598-e4cf-4c30-94ea-a58e91f8d08f', model: 'doubao-seedance-2-0-fast', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
    // Grsai - 图片生成
    { name: 'grsai_imageGeneration_nano-banana-fast', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-fast', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-pro', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-pro', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-pro-vt', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-pro-vt', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-pro-cl', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-pro-cl', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-pro-vip', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-pro-vip', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-pro-4k-vip', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-pro-4k-vip', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-2', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-2', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-2-cl', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-2-cl', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-2-4k-cl', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-2-4k-cl', baseUrl: 'https://grsai.dakka.com.cn' },
    { name: 'grsai_imageGeneration_nano-banana-3', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'nano-banana-3', baseUrl: 'https://grsai.dakka.com.cn' },
    // Grsai - 视频生成
    { name: 'grsai_videoGeneration_grsai-sora-2', provider: 'grsai', apiKey: 'sk-31428f6c42e242a7b0ac10581c4ed017', model: 'grsai-sora-2', baseUrl: 'https://grsai.dakka.com.cn' },
    // DeepSeek
    { name: 'deepseek_scriptGeneration_deepseek-v4-pro', provider: 'deepseek', apiKey: 'sk-2b253d4e956642d8a100d94a4db56b11', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com/v1' },
    { name: 'deepseek_scriptGeneration_deepseek-chat', provider: 'deepseek', apiKey: 'sk-2b253d4e956642d8a100d94a4db56b11', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
    { name: 'deepseek_scriptGeneration_deepseek-reasoner', provider: 'deepseek', apiKey: 'sk-2b253d4e956642d8a100d94a4db56b11', model: 'deepseek-reasoner', baseUrl: 'https://api.deepseek.com/v1' },
    // IdeaLab
    { name: 'idealab_scriptGeneration_qwen_max', provider: 'idealab', apiKey: '', model: 'qwen_max', baseUrl: 'https://idealab.alibaba-inc.com/api/v1' },
    // OpenRouter - 视频生成
    { name: 'videoGeneration_openrouter', provider: 'openrouter', apiKey: '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', model: 'bytedance/seedance-1-5-pro', baseUrl: 'https://openrouter.ai/api/v1' },
    // OpenRouter - 图片生成 (Flux)
    { name: 'imageGeneration_openrouter_black-forest-labs/flux.2-pro', provider: 'openrouter', apiKey: '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', model: 'black-forest-labs/flux.2-pro', baseUrl: 'https://openrouter.ai/api/v1' },
    { name: 'imageGeneration_openrouter_black-forest-labs/flux.2-flex', provider: 'openrouter', apiKey: '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', model: 'black-forest-labs/flux.2-flex', baseUrl: 'https://openrouter.ai/api/v1' },
    { name: 'imageGeneration_openrouter_black-forest-labs/flux.2-max', provider: 'openrouter', apiKey: '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', model: 'black-forest-labs/flux.2-max', baseUrl: 'https://openrouter.ai/api/v1' },
    { name: 'imageGeneration_openrouter_black-forest-labs/flux.2-klein-4b', provider: 'openrouter', apiKey: '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', model: 'black-forest-labs/flux.2-klein-4b', baseUrl: 'https://openrouter.ai/api/v1' },
    // OpenRouter - 图片生成 (Riverflow)
    { name: 'imageGeneration_openrouter_sourceful/riverflow-v2-pro', provider: 'openrouter', apiKey: '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', model: 'sourceful/riverflow-v2-pro', baseUrl: 'https://openrouter.ai/api/v1' },
    { name: 'imageGeneration_openrouter_sourceful/riverflow-v2-fast', provider: 'openrouter', apiKey: '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', model: 'sourceful/riverflow-v2-fast', baseUrl: 'https://openrouter.ai/api/v1' },
    { name: 'imageGeneration_openrouter_sourceful/riverflow-v2-max-preview', provider: 'openrouter', apiKey: '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', model: 'sourceful/riverflow-v2-max-preview', baseUrl: 'https://openrouter.ai/api/v1' },
    { name: 'imageGeneration_openrouter_sourceful/riverflow-v2-standard-preview', provider: 'openrouter', apiKey: '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', model: 'sourceful/riverflow-v2-standard-preview', baseUrl: 'https://openrouter.ai/api/v1' },
    // OpenRouter - 图片生成 (ByteDance)
    { name: 'imageGeneration_openrouter_bytedance-seed/seedream-4.5', provider: 'openrouter', apiKey: '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', model: 'bytedance-seed/seedream-4.5', baseUrl: 'https://openrouter.ai/api/v1' },
    // OpenRouter - 视频生成 (Alpha)
    { name: 'videoGeneration_openrouter_openai/sora-2-pro', provider: 'openrouter', apiKey: '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', model: 'openai/sora-2-pro', baseUrl: 'https://openrouter.ai/api/v1' },
    { name: 'videoGeneration_openrouter_google/veo-3.1', provider: 'openrouter', apiKey: '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', model: 'google/veo-3.1', baseUrl: 'https://openrouter.ai/api/v1' },
    // Token Plan (百炼包月) - 文本生成
    { name: 'tokenplan_scriptGeneration_qwen3.6-plus', provider: 'tokenplan', apiKey: 'sk-e4e03e38190d45d1b6d5b2b2da9515df', model: 'qwen3.6-plus', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    { name: 'tokenplan_scriptGeneration_glm-5', provider: 'tokenplan', apiKey: 'sk-e4e03e38190d45d1b6d5b2b2da9515df', model: 'glm-5', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    { name: 'tokenplan_scriptGeneration_MiniMax-M2.5', provider: 'tokenplan', apiKey: 'sk-e4e03e38190d45d1b6d5b2b2da9515df', model: 'MiniMax-M2.5', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    { name: 'tokenplan_scriptGeneration_deepseek-v3.2', provider: 'tokenplan', apiKey: 'sk-e4e03e38190d45d1b6d5b2b2da9515df', model: 'deepseek-v3.2', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    // Token Plan (百炼包月) - 图片生成
    { name: 'tokenplan_imageGeneration_qwen-image-2.0', provider: 'tokenplan', apiKey: 'sk-e4e03e38190d45d1b6d5b2b2da9515df', model: 'qwen-image-2.0', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    { name: 'tokenplan_imageGeneration_qwen-image-2.0-pro', provider: 'tokenplan', apiKey: 'sk-e4e03e38190d45d1b6d5b2b2da9515df', model: 'qwen-image-2.0-pro', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    { name: 'tokenplan_imageGeneration_wan2.7-image', provider: 'tokenplan', apiKey: 'sk-e4e03e38190d45d1b6d5b2b2da9515df', model: 'wan2.7-image', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    { name: 'tokenplan_imageGeneration_wan2.7-image-pro', provider: 'tokenplan', apiKey: 'sk-e4e03e38190d45d1b6d5b2b2da9515df', model: 'wan2.7-image-pro', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    // 服务端配置
    { name: 'server_url', provider: 'server', apiKey: 'http://localhost:3000', model: 'default', baseUrl: null },
    { name: 'server_api_key', provider: 'server', apiKey: '', model: 'default', baseUrl: null },
  ];
  
  for (const config of defaultConfigs) {
    try {
      // 检查配置是否已存在
      const existing = await db.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM api_configs WHERE name = ?`,
        [config.name]
      );
      
      // 只有当配置不存在时才插入默认配置
      if (existing[0]?.count === 0) {
        await db.execute(
          `INSERT INTO api_configs (name, provider, api_key, model, base_url) VALUES (?, ?, ?, ?, ?)`,
          [config.name, config.provider, config.apiKey, config.model, config.baseUrl || null]
        );
        console.log('Inserted default config:', config.name);
      }
    } catch (e) {
      console.error('Failed to init config:', config.name, e);
    }
  }
}

// 迁移：更新旧的 OpenRouter 模型 ID
async function migrateOpenRouterModelIds(): Promise<void> {
  if (!db) return;
  
  // 旧模型 ID -> 新模型 ID 的映射
  const modelUpdates = [
    { oldModel: 'black-forest-labs/flux-pro', newModel: 'black-forest-labs/flux.2-pro' },
    { oldModel: 'black-forest-labs/flux', newModel: 'black-forest-labs/flux.2-flex' },
    { oldModel: 'black-forest-labs/flux-max', newModel: 'black-forest-labs/flux.2-max' },
  ];
  
  for (const update of modelUpdates) {
    try {
      // 检查是否存在旧模型 ID
      const existing = await db.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM api_configs WHERE model = ?`,
        [update.oldModel]
      );
      
      if (existing[0]?.count > 0) {
        // 更新为新模型 ID
        await db.execute(
          `UPDATE api_configs SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE model = ?`,
          [update.newModel, update.oldModel]
        );
        console.log(`Migrated model: ${update.oldModel} -> ${update.newModel}`);
      }
    } catch (e) {
      console.error('Failed to migrate model:', update.oldModel, e);
    }
  }
}

// 迁移：插入 DeepSeek V4 Pro 配置（如不存在）
async function migrateDeepSeekV4Pro(): Promise<void> {
  if (!db) return;
  
  const configName = 'deepseek_scriptGeneration_deepseek-v4-pro';
  try {
    const existing = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM api_configs WHERE name = ?`,
      [configName]
    );
    
    if (existing[0]?.count === 0) {
      await db.execute(
        `INSERT INTO api_configs (name, provider, api_key, model, base_url) VALUES (?, ?, ?, ?, ?)`,
        [configName, 'deepseek', 'sk-2b253d4e956642d8a100d94a4db56b11', 'deepseek-v4-pro', 'https://api.deepseek.com/v1']
      );
      console.log('Migrated: added DeepSeek V4 Pro config');
    }
  } catch (e) {
    console.error('Failed to migrate DeepSeek V4 Pro:', e);
  }
}

// 自动配置火山引擎 API（首次启动时调用）
export async function setupVolcEngineCredentials(): Promise<void> {
  // 此函数已废弃，默认配置已在 initDefaultApiConfigs 中设置
  // 保留函数避免其他地方调用出错
  console.log('火山引擎凭证使用默认配置');
}

// ===== 剧本操作 =====

export async function createScript(script: Script): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.execute(
    `INSERT INTO scripts (title, content, custom_characters, custom_scenes) VALUES (?, ?, ?, ?)`,
    [
      script.title, 
      script.content,
      script.customCharacters ? JSON.stringify(script.customCharacters) : null,
      script.customScenes ? JSON.stringify(script.customScenes) : null
    ]
  );
  
  return result.lastInsertId || 0;
}

export async function getScript(id: number): Promise<Script | null> {
  if (!db) throw new Error('Database not initialized');
  
  const rows = await db.select<any[]>(
    `SELECT * FROM scripts WHERE id = ?`,
    [id]
  );
  
  if (rows.length === 0) return null;
  
  const row = rows[0];
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    customCharacters: row.custom_characters ? JSON.parse(row.custom_characters) : undefined,
    customScenes: row.custom_scenes ? JSON.parse(row.custom_scenes) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getLatestScript(): Promise<Script | null> {
  if (!db) throw new Error('Database not initialized');
  
  const rows = await db.select<any[]>(
    `SELECT * FROM scripts ORDER BY created_at DESC LIMIT 1`
  );
  
  if (rows.length === 0) return null;
  
  const row = rows[0];
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    customCharacters: row.custom_characters ? JSON.parse(row.custom_characters) : undefined,
    customScenes: row.custom_scenes ? JSON.parse(row.custom_scenes) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// 获取所有剧本
export async function getAllScripts(): Promise<Script[]> {
  if (!db) throw new Error('Database not initialized');
  
  const rows = await db.select<any[]>(
    `SELECT * FROM scripts ORDER BY created_at DESC`
  );
  
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    content: row.content,
    customCharacters: row.custom_characters ? JSON.parse(row.custom_characters) : undefined,
    customScenes: row.custom_scenes ? JSON.parse(row.custom_scenes) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

// 删除剧本及其所有关联数据
export async function deleteScriptWithRelated(scriptId: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  // 获取所有关联数据
  const characters = await db.select<{id: number}[]>(`SELECT id FROM characters WHERE script_id = ?`, [scriptId]);
  const scenes = await db.select<{id: number}[]>(`SELECT id FROM scenes WHERE script_id = ?`, [scriptId]);
  const episodes = await db.select<{id: number}[]>(`SELECT id FROM episodes WHERE script_id = ?`, [scriptId]);
  
  // 删除分镜
  for (const ep of episodes) {
    await db.execute(`DELETE FROM segments WHERE episode_id = ?`, [ep.id]);
  }
  
  // 删除分集
  await db.execute(`DELETE FROM episodes WHERE script_id = ?`, [scriptId]);
  
  // 删除场景
  await db.execute(`DELETE FROM scenes WHERE script_id = ?`, [scriptId]);
  
  // 删除角色
  await db.execute(`DELETE FROM characters WHERE script_id = ?`, [scriptId]);
  
  // 删除剧本
  await db.execute(`DELETE FROM scripts WHERE id = ?`, [scriptId]);
}

export async function updateScript(id: number, script: Partial<Script>): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (script.title !== undefined) {
    updates.push('title = ?');
    values.push(script.title);
  }
  if (script.content !== undefined) {
    updates.push('content = ?');
    values.push(script.content);
  }
  if (script.customCharacters !== undefined) {
    updates.push('custom_characters = ?');
    values.push(script.customCharacters ? JSON.stringify(script.customCharacters) : null);
  }
  if (script.customScenes !== undefined) {
    updates.push('custom_scenes = ?');
    values.push(script.customScenes ? JSON.stringify(script.customScenes) : null);
  }
  
  if (updates.length === 0) return;
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  await db.execute(
    `UPDATE scripts SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteScript(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  await db.execute(`DELETE FROM scripts WHERE id = ?`, [id]);
}

// ===== 角色操作 =====

export async function createCharacter(character: Character): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.execute(
    `INSERT INTO characters (name, description, image_url, voice_description, is_main, script_id, alternative_images) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      character.name, 
      character.description, 
      character.imageUrl, 
      character.voiceDescription, 
      character.isMain ? 1 : 0, 
      character.scriptId,
      character.alternativeImages ? JSON.stringify(character.alternativeImages) : null
    ]
  );
  
  return result.lastInsertId || 0;
}

export async function getCharactersByScript(scriptId: number): Promise<Character[]> {
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.select<any[]>(
    `SELECT * FROM characters WHERE script_id = ? ORDER BY is_main DESC, created_at ASC`,
    [scriptId]
  );
  
  // 映射 snake_case 字段到 camelCase
  return results.map(row => ({
    id: row.id,
    scriptId: row.script_id,
    name: row.name,
    description: row.description,
    isMain: row.is_main,
    voiceDescription: row.voice_description,
    imageUrl: row.image_url,
    alternativeImages: row.alternative_images ? JSON.parse(row.alternative_images) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function updateCharacter(id: number, character: Partial<Character>): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (character.name !== undefined) {
    updates.push('name = ?');
    values.push(character.name);
  }
  if (character.description !== undefined) {
    updates.push('description = ?');
    values.push(character.description);
  }
  if (character.imageUrl !== undefined) {
    updates.push('image_url = ?');
    values.push(character.imageUrl);
  }
  if (character.voiceDescription !== undefined) {
    updates.push('voice_description = ?');
    values.push(character.voiceDescription);
  }
  if (character.isMain !== undefined) {
    updates.push('is_main = ?');
    values.push(character.isMain ? 1 : 0);
  }
  if (character.alternativeImages !== undefined) {
    updates.push('alternative_images = ?');
    values.push(JSON.stringify(character.alternativeImages));
  }
  
  if (updates.length === 0) return;
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  await db.execute(
    `UPDATE characters SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteCharacter(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  await db.execute(`DELETE FROM characters WHERE id = ?`, [id]);
}

// ===== 场景操作 =====

export async function createScene(scene: Scene): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.execute(
    `INSERT INTO scenes (name, description, image_url, episodes, script_id) 
     VALUES (?, ?, ?, ?, ?)`,
    [scene.name, scene.description, scene.imageUrl, scene.episodes, scene.scriptId]
  );
  
  return result.lastInsertId || 0;
}

export async function getScenesByScript(scriptId: number): Promise<Scene[]> {
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.select<any[]>(
    `SELECT * FROM scenes WHERE script_id = ? ORDER BY created_at ASC`,
    [scriptId]
  );
  
  // 映射 snake_case 字段到 camelCase
  return results.map(row => ({
    id: row.id,
    scriptId: row.script_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    episodes: row.episodes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function updateScene(id: number, scene: Partial<Scene>): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (scene.name !== undefined) {
    updates.push('name = ?');
    values.push(scene.name);
  }
  if (scene.description !== undefined) {
    updates.push('description = ?');
    values.push(scene.description);
  }
  if (scene.imageUrl !== undefined) {
    updates.push('image_url = ?');
    values.push(scene.imageUrl);
  }
  if (scene.episodes !== undefined) {
    updates.push('episodes = ?');
    values.push(scene.episodes);
  }
  
  if (updates.length === 0) return;
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  await db.execute(
    `UPDATE scenes SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteScene(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  await db.execute(`DELETE FROM scenes WHERE id = ?`, [id]);
}

// ===== 分集操作 =====

export async function createEpisode(episode: Episode): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.execute(
    `INSERT INTO episodes (title, episode_number, content, status, duration, script_id) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [episode.title, episode.episodeNumber, episode.content, episode.status, episode.duration, episode.scriptId]
  );
  
  return result.lastInsertId || 0;
}

export async function getEpisodesByScript(scriptId: number): Promise<Episode[]> {
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.select<any[]>(
    `SELECT * FROM episodes WHERE script_id = ? ORDER BY episode_number ASC`,
    [scriptId]
  );
  
  // 映射 snake_case 字段到 camelCase
  return results.map(row => ({
    id: row.id,
    title: row.title,
    episodeNumber: row.episode_number,
    content: row.content,
    status: row.status,
    duration: row.duration,
    scriptId: row.script_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function updateEpisode(id: number, episode: Partial<Episode>): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (episode.title !== undefined) {
    updates.push('title = ?');
    values.push(episode.title);
  }
  if (episode.content !== undefined) {
    updates.push('content = ?');
    values.push(episode.content);
    const log = `[DB] updateEpisode id=${id}, content长度=${episode.content.length}`;
    console.log(log);
    pageLogCallback?.(log);
  }
  if (episode.status !== undefined) {
    updates.push('status = ?');
    values.push(episode.status);
  }
  if (episode.duration !== undefined) {
    updates.push('duration = ?');
    values.push(episode.duration);
  }
  
  if (updates.length === 0) {
    const log = `[DB] updateEpisode id=${id}, 没有需要更新的字段！`;
    console.log(log);
    pageLogCallback?.(log);
    return;
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  const sql = `UPDATE episodes SET ${updates.join(', ')} WHERE id = ?`;
  console.log(`[DB] 执行SQL: ${sql}`, values);
  pageLogCallback?.(`[DB] 执行SQL: ${sql} (参数数量=${values.length})`);
  
  await db.execute(sql, values);
  const log2 = `[DB] updateEpisode id=${id} 执行完成`;
  console.log(log2);
  pageLogCallback?.(log2);
}

export async function deleteEpisode(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  await db.execute(`DELETE FROM episodes WHERE id = ?`, [id]);
}

// ===== 片段操作 =====

export async function createSegment(segment: Segment): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.execute(
    `INSERT INTO segments (episode_id, start_time, end_time, content, character_id, scene_id, order_index) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [segment.episodeId, segment.startTime, segment.endTime, segment.content, segment.characterId, segment.sceneId, segment.order]
  );
  
  return result.lastInsertId || 0;
}

export async function getSegmentsByEpisode(episodeId: number): Promise<Segment[]> {
  if (!db) throw new Error('Database not initialized');
  
  return await db.select<Segment[]>(
    `SELECT * FROM segments WHERE episode_id = ? ORDER BY order_index ASC`,
    [episodeId]
  );
}

export async function updateSegment(id: number, segment: Partial<Segment>): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (segment.startTime !== undefined) {
    updates.push('start_time = ?');
    values.push(segment.startTime);
  }
  if (segment.endTime !== undefined) {
    updates.push('end_time = ?');
    values.push(segment.endTime);
  }
  if (segment.content !== undefined) {
    updates.push('content = ?');
    values.push(segment.content);
  }
  if (segment.characterId !== undefined) {
    updates.push('character_id = ?');
    values.push(segment.characterId);
  }
  if (segment.sceneId !== undefined) {
    updates.push('scene_id = ?');
    values.push(segment.sceneId);
  }
  if (segment.order !== undefined) {
    updates.push('order_index = ?');
    values.push(segment.order);
  }
  
  if (updates.length === 0) return;
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  await db.execute(
    `UPDATE segments SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteSegment(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  await db.execute(`DELETE FROM segments WHERE id = ?`, [id]);
}

// ===== API 配置操作 =====

export async function getApiConfigs(): Promise<ApiConfig[]> {
  if (!db) throw new Error('Database not initialized');
  
  const rows = await db.select<any[]>(`SELECT * FROM api_configs`);
  // 将数据库字段名映射到驼峰命名
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    apiKey: row.api_key,
    model: row.model,
    baseUrl: row.base_url,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function getApiConfig(name: string, maxRetries: number = 3): Promise<ApiConfig | null> {
  // 如果数据库还没准备好，等待一下再重试
  for (let i = 0; i < maxRetries; i++) {
    if (db) {
      try {
        const rows = await db.select<any[]>(
          `SELECT * FROM api_configs WHERE name = ?`,
          [name]
        );
        
        if (rows.length === 0) return null;
        
        const row = rows[0];
        return {
          id: row.id,
          name: row.name,
          provider: row.provider,
          apiKey: row.api_key,
          model: row.model,
          baseUrl: row.base_url,
          description: row.description,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      } catch (error) {
        console.error(`[getApiConfig] 查询配置失败 (${i + 1}/${maxRetries}):`, error);
      }
    }
    
    if (i < maxRetries - 1) {
      console.log(`[getApiConfig] 数据库未就绪，等待 ${500 * (i + 1)}ms 后重试...`);
      await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  
  throw new Error('Database not initialized');
}

export async function updateApiConfig(name: string, config: Partial<ApiConfig>): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  // 使用 INSERT OR REPLACE 确保幂等性（原子操作，避免先查后插的并发问题）
  // name 列有 UNIQUE 约束，INSERT OR REPLACE 会在冲突时替换整行
  const provider = config.provider || '';
  const apiKey = config.apiKey || '';
  const model = config.model || '';
  const baseUrl = config.baseUrl || null;
  const description = config.description || null;
  
  // 如果是更新操作（已有记录），需要保留未指定的字段
  // 先获取已有记录的值作为默认值
  const existing = await db.select<any[]>(
    `SELECT provider, api_key, model, base_url, description FROM api_configs WHERE name = ?`,
    [name]
  );
  
  if (existing.length > 0) {
    // 已有记录，合并更新：未指定的字段保留原值
    const row = existing[0];
    const finalProvider = config.provider !== undefined ? config.provider : row.provider;
    const finalApiKey = config.apiKey !== undefined ? config.apiKey : row.api_key;
    const finalModel = config.model !== undefined ? config.model : row.model;
    const finalBaseUrl = config.baseUrl !== undefined ? config.baseUrl : row.base_url;
    const finalDescription = config.description !== undefined ? config.description : row.description;
    
    await db.execute(
      `INSERT OR REPLACE INTO api_configs (name, provider, api_key, model, base_url, description, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [name, finalProvider, finalApiKey, finalModel, finalBaseUrl, finalDescription]
    );
  } else {
    // 不存在，直接插入
    await db.execute(
      `INSERT OR REPLACE INTO api_configs (name, provider, api_key, model, base_url, description) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, provider, apiKey, model, baseUrl, description]
    );
  }
}

// ========== 导入/导出功能 ==========

export interface ExportData {
  version: string;
  exportDate: string;
  script: Script | null;
  characters: Character[];
  scenes: Scene[];
  episodes: Episode[];
}

// 导出所有数据为 JSON
export async function exportAllData(): Promise<ExportData> {
  if (!db) throw new Error('Database not initialized');
  
  // 获取最新剧本
  const script = await getLatestScript();
  
  // 获取剧本 ID
  const scriptId = script?.id || 0;
  
  // 获取所有关联数据
  const characters = scriptId > 0 ? await getCharactersByScript(scriptId) : [];
  const scenes = scriptId > 0 ? await getScenesByScript(scriptId) : [];
  const episodes = scriptId > 0 ? await getEpisodesByScript(scriptId) : [];
  
  // 如果有分集，也获取分镜数据
  const episodesWithSegments = await Promise.all(
    episodes.map(async (episode) => {
      if (episode.id === undefined) return { ...episode, segments: [] };
      const segments = await getSegmentsByEpisode(episode.id);
      return { ...episode, segments };
    })
  );
  
  return {
    version: '1.0',
    exportDate: new Date().toISOString(),
    script,
    characters,
    scenes,
    episodes: episodesWithSegments
  };
}

// 导出数据为 JSON 字符串
export async function exportToJson(): Promise<string> {
  const data = await exportAllData();
  return JSON.stringify(data, null, 2);
}

// 从 JSON 导入数据
export async function importFromJson(jsonString: string): Promise<{
  success: boolean;
  message: string;
  scriptId?: number;
}> {
  try {
    const data = JSON.parse(jsonString) as ExportData;
    
    if (!data.version || !data.script) {
      return { success: false, message: '无效的导入文件格式' };
    }
    
    if (!db) throw new Error('Database not initialized');
    
    // 创建新剧本
    const scriptId = await createScript({
      title: data.script.title + ' (导入)',
      content: data.script.content,
    });
    
    // 导入角色
    const characterIdMap = new Map<number, number>();
    for (const char of data.characters || []) {
      if (char.id === undefined) continue;
      const newId = await createCharacter({
        ...char,
        id: 0, // 强制创建新 ID
        scriptId,
      });
      characterIdMap.set(char.id, newId);
    }
    
    // 导入场景
    const sceneIdMap = new Map<number, number>();
    for (const scene of data.scenes || []) {
      if (scene.id === undefined) continue;
      const newId = await createScene({
        ...scene,
        id: 0,
        scriptId,
      });
      sceneIdMap.set(scene.id, newId);
    }
    
    // 导入分集
    for (const episode of data.episodes || []) {
      const newEpisodeId = await createEpisode({
        ...episode,
        id: 0,
        scriptId,
      });
      
      // 导入分镜
      const segments = (episode as any).segments || [];
      for (const segment of segments) {
        await createSegment({
          ...segment,
          id: 0,
          episodeId: newEpisodeId,
        });
      }
    }
    
    return {
      success: true,
      message: `成功导入剧本及其数据`,
      scriptId
    };
  } catch (error) {
    return {
      success: false,
      message: `导入失败: ${error}`
    };
  }
}

// ========== 图片历史操作 ==========

export interface ImageHistory {
  id: number;
  assetType: string;  // 'character' | 'scene'
  assetId: number;
  assetName: string;
  imageUrl: string;
  localPath: string | null;
  prompt: string | null;
  createdAt: string;
}

// 保存图片到历史记录
export async function saveImageHistory(
  assetType: 'character' | 'scene',
  assetId: number,
  assetName: string,
  imageUrl: string,
  localPath: string | null = null,
  prompt: string | null = null
): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.execute(
    `INSERT INTO image_history (asset_type, asset_id, asset_name, image_url, local_path, prompt) VALUES (?, ?, ?, ?, ?, ?)`,
    [assetType, assetId, assetName, imageUrl, localPath, prompt]
  );
  
  return result.lastInsertId || 0;
}

// 获取某个素材的所有图片历史
export async function getImageHistory(
  assetType: 'character' | 'scene',
  assetId: number
): Promise<ImageHistory[]> {
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.select<any[]>(
    `SELECT * FROM image_history WHERE asset_type = ? AND asset_id = ? ORDER BY created_at DESC`,
    [assetType, assetId]
  );
  
  return results.map(row => ({
    id: row.id,
    assetType: row.asset_type,
    assetId: row.asset_id,
    assetName: row.asset_name,
    imageUrl: row.image_url,
    localPath: row.local_path,
    prompt: row.prompt,
    createdAt: row.created_at
  }));
}

// 获取某个素材的最新图片
export async function getLatestImage(
  assetType: 'character' | 'scene',
  assetId: number
): Promise<ImageHistory | null> {
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.select<any[]>(
    `SELECT * FROM image_history WHERE asset_type = ? AND asset_id = ? ORDER BY created_at DESC LIMIT 1`,
    [assetType, assetId]
  );
  
  if (results.length === 0) return null;
  
  const row = results[0];
  return {
    id: row.id,
    assetType: row.asset_type,
    assetId: row.asset_id,
    assetName: row.asset_name,
    imageUrl: row.image_url,
    localPath: row.local_path,
    prompt: row.prompt,
    createdAt: row.created_at
  };
}

// 删除图片历史记录
export async function deleteImageHistory(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.execute(`DELETE FROM image_history WHERE id = ?`, [id]);
}

// ========== 首页生成图片历史 ==========

export interface GeneratedImageHistory {
  id: number;
  localPath: string;
  prompt?: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  assetType?: 'character' | 'scene';
  assetId?: number;
  createdAt: string;
}

// 添加生成图片历史记录（支持关联资产类型）
export async function addGeneratedImageHistory(
  localPath: string,
  prompt?: string,
  model?: string,
  size?: string,
  aspectRatio?: string,
  assetType?: 'character' | 'scene',
  assetId?: number
): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.execute(
    `INSERT INTO generated_image_history (local_path, prompt, model, size, aspect_ratio, asset_type, asset_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [localPath, prompt || null, model || null, size || null, aspectRatio || null, assetType || null, assetId || null]
  );
  
  return result.lastInsertId || 0;
}

// 获取所有生成图片历史记录（按时间倒序）
export async function getGeneratedImageHistory(limit: number = 50): Promise<GeneratedImageHistory[]> {
  if (!db) throw new Error('Database not initialized');
  
  const rows = await db.select<any[]>(
    `SELECT * FROM generated_image_history ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  
  return rows.map(row => ({
    id: row.id,
    localPath: row.local_path,
    prompt: row.prompt,
    model: row.model,
    size: row.size,
    aspectRatio: row.aspect_ratio,
    assetType: row.asset_type,
    assetId: row.asset_id,
    createdAt: row.created_at
  }));
}

// 按日期分组获取生成图片历史（优先显示最近10天有图片的日期）
export interface ImageHistoryByDate {
  date: string;
  images: GeneratedImageHistory[];
}

export async function getGeneratedImageHistoryByDate(days: number = 10): Promise<ImageHistoryByDate[]> {
  if (!db) throw new Error('Database not initialized');
  
  // 获取所有图片（限制数量提高性能）
  const rows = await db.select<any[]>(
    `SELECT * FROM generated_image_history ORDER BY created_at DESC LIMIT 100`
  );
  
  // 按日期分组
  const grouped = new Map<string, GeneratedImageHistory[]>();
  
  rows.forEach(row => {
    const date = row.created_at.split(' ')[0]; // 提取日期部分 YYYY-MM-DD
    const image: GeneratedImageHistory = {
      id: row.id,
      localPath: row.local_path,
      prompt: row.prompt,
      model: row.model,
      size: row.size,
      aspectRatio: row.aspect_ratio,
      assetType: row.asset_type,
      assetId: row.asset_id,
      createdAt: row.created_at
    };
    
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(image);
  });
  
  // 转换为数组并按日期倒序排列
  return Array.from(grouped.entries())
    .map(([date, images]) => ({ date, images }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// 按日期分组获取统一历史图片（合并 generated_image_history 和 image_history）
export async function getAllImageHistoryByDate(days: number = 10): Promise<ImageHistoryByDate[]> {
  if (!db) throw new Error('Database not initialized');
  
  // 查询 generated_image_history
  const generatedRows = await db.select<any[]>(
    `SELECT id, local_path as localPath, prompt, model, size, aspect_ratio as aspectRatio, asset_type as assetType, asset_id as assetId, created_at as createdAt, 'generated' as source FROM generated_image_history ORDER BY created_at DESC LIMIT 200`
  );
  
  // 查询 image_history（角色/场景图片）
  const imageRows = await db.select<any[]>(
    `SELECT id, local_path as localPath, prompt, asset_type as assetType, asset_id as assetId, created_at as createdAt, 'image' as source FROM image_history ORDER BY created_at DESC LIMIT 200`
  );
  
  // 合并并按时间排序
  const allRows = [...generatedRows, ...imageRows]
    .map(row => ({
      id: row.id,
      localPath: row.localPath || row.local_path,
      prompt: row.prompt,
      model: row.model,
      size: row.size,
      aspectRatio: row.aspectRatio,
      assetType: row.assetType,
      assetId: row.assetId,
      createdAt: row.createdAt,
      source: row.source
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  // 按日期分组
  const grouped = new Map<string, GeneratedImageHistory[]>();
  
  allRows.forEach(row => {
    const date = row.createdAt.split(' ')[0];
    const image: GeneratedImageHistory = {
      id: row.id,
      localPath: row.localPath,
      prompt: row.prompt,
      model: row.model,
      size: row.size,
      aspectRatio: row.aspectRatio,
      assetType: row.assetType,
      assetId: row.assetId,
      createdAt: row.createdAt
    };
    
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(image);
  });
  
  return Array.from(grouped.entries())
    .map(([date, images]) => ({ date, images }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// 删除生成图片历史记录
export async function deleteGeneratedImageHistory(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.execute(`DELETE FROM generated_image_history WHERE id = ?`, [id]);
}

// ========== 分集角色穿着选择 ==========

export interface EpisodeCharacterOutfit {
  episodeId: number;
  characterId: number;
  outfitIndex: number | null;
}

// 保存分集角色穿着选择
export async function saveEpisodeCharacterOutfit(
  episodeId: number,
  characterId: number,
  outfitIndex: number | null
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  await db.execute(`
    INSERT INTO episode_character_outfits (episode_id, character_id, outfit_index, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(episode_id, character_id) 
    DO UPDATE SET outfit_index = excluded.outfit_index, updated_at = CURRENT_TIMESTAMP
  `, [episodeId, characterId, outfitIndex]);
}

// 获取分集的所有角色穿着选择
export async function getEpisodeCharacterOutfits(episodeId: number): Promise<EpisodeCharacterOutfit[]> {
  if (!db) throw new Error('Database not initialized');
  
  const rows = await db.select<any[]>(
    `SELECT episode_id, character_id, outfit_index FROM episode_character_outfits WHERE episode_id = ?`,
    [episodeId]
  );
  
  return rows.map(row => ({
    episodeId: row.episode_id,
    characterId: row.character_id,
    outfitIndex: row.outfit_index
  }));
}

// ========== 首页视频历史 ==========

export interface HomeVideoHistory {
  id: number;
  localPath?: string;
  remoteUrl?: string;
  prompt?: string;
  model?: string;
  duration?: number;
  hasAudio: boolean;
  createdAt: string;
}

export interface VideoHistoryByDate {
  date: string;
  videos: HomeVideoHistory[];
}

// 添加视频历史记录
export async function addHomeVideoHistory(
  localPath?: string,
  remoteUrl?: string,
  prompt?: string,
  model?: string,
  duration?: number,
  hasAudio: boolean = false
): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.execute(
    `INSERT INTO home_video_history (local_path, remote_url, prompt, model, duration, has_audio) VALUES (?, ?, ?, ?, ?, ?)`,
    [localPath || null, remoteUrl || null, prompt || null, model || null, duration || null, hasAudio ? 1 : 0]
  );
  
  return result.lastInsertId || 0;
}

// 获取视频历史（按日期分组）
export async function getHomeVideoHistoryByDate(days: number = 10): Promise<VideoHistoryByDate[]> {
  if (!db) throw new Error('Database not initialized');
  
  const rows = await db.select<any[]>(
    `SELECT * FROM home_video_history ORDER BY created_at DESC LIMIT 100`
  );
  
  const grouped = new Map<string, HomeVideoHistory[]>();
  
  rows.forEach(row => {
    const date = row.created_at.split(' ')[0];
    const video: HomeVideoHistory = {
      id: row.id,
      localPath: row.local_path,
      remoteUrl: row.remote_url,
      prompt: row.prompt,
      model: row.model,
      duration: row.duration,
      hasAudio: row.has_audio === 1,
      createdAt: row.created_at
    };
    
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(video);
  });
  
  return Array.from(grouped.entries())
    .map(([date, videos]) => ({ date, videos }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// 删除视频历史记录
export async function deleteHomeVideoHistory(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.execute(`DELETE FROM home_video_history WHERE id = ?`, [id]);
}

// 导入本地视频文件到历史记录
export async function importLocalVideosToHistory(
  localPath: string,
  prompt?: string,
  model?: string,
  duration?: number,
  hasAudio: boolean = false
): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  
  // 检查是否已存在
  const existing = await db.select<any[]>(
    `SELECT id FROM home_video_history WHERE local_path = ?`,
    [localPath]
  );
  
  if (existing.length > 0) {
    return existing[0].id; // 已存在，返回ID
  }
  
  const result = await db.execute(
    `INSERT INTO home_video_history (local_path, prompt, model, duration, has_audio) VALUES (?, ?, ?, ?, ?)`,
    [localPath, prompt || null, model || null, duration || null, hasAudio ? 1 : 0]
  );
  
  return result.lastInsertId || 0;
}