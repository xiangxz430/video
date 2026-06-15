import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { authMiddleware, adminAuthMiddleware } from './middleware/auth.js';
import { requestLogger } from './middleware/requestLogger.js';
import { scriptRouter } from './routes/script.js';
import { storyboardRouter } from './routes/storyboard.js';
import { imageRouter } from './routes/image.js';
import { videoRouter } from './routes/video.js';
import { apiKeysRouter } from './routes/apiKeys.js';
import { adminRouter } from './routes/admin.js';
import { clientStatsRouter } from './routes/clientStats.js';
import { config } from './config/index.js';
import { initializeFromEnv, loadFromDatabase } from './services/apiKeyService.js';
import { connectMongo, closeMongo, migrateApiKeysFromJson } from './services/mongoService.js';

const app = express();

app.use(helmet({ 
  contentSecurityPolicy: false, 
  crossOriginResourcePolicy: { policy: 'cross-origin' }, 
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: true, // 允许所有来源（包括 tauri://localhost、null 等自定义 scheme）
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// 兜底：确保所有 OPTIONS 请求都能正确响应，不被后续 auth 中间件拦截
app.options('*', cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key']
}));

app.use(express.json({ limit: '50mb' }));

// 注意：initializeFromEnv 已移到 startServer() 中异步执行，确保 MongoDB 连接后再初始化

// Health check (无需认证)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 管理路由（使用单独的 admin 认证）
app.use('/api/admin', adminAuthMiddleware);
// 注意：/api/admin/keys 必须在 /api/admin 之前注册，避免路由冲突
app.use('/api/admin/keys', apiKeysRouter);
app.use('/api/admin', adminRouter);

// 托管管理后台静态文件（放在 API 路由之后，确保 /api/admin/* 优先匹配）
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
// SPA fallback：所有 /admin/* 未匹配的路由返回 index.html
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

// 需要认证的路由
app.use('/api', authMiddleware);

// 请求日志中间件（在认证之后，路由之前）
// 注意：requestLogger 自己会判断是否记录（排除 admin 和 health）
app.use(requestLogger);

app.use('/api/script', scriptRouter);
app.use('/api/storyboard', storyboardRouter);
app.use('/api/image', imageRouter);
app.use('/api/video', videoRouter);

// 客户端统计路由（需要认证）
app.use('/api/stats', clientStatsRouter);

// 启动服务：先连接 MongoDB，迁移 API Keys，再监听端口
async function startServer() {
  try {
    await connectMongo();
  } catch (error) {
    console.warn('[启动] MongoDB 连接失败，将降级到文件存储模式。错误:', error);
  }

  // 迁移 API Keys 从 JSON 文件到 MongoDB（仅执行一次）
  try {
    await migrateApiKeysFromJson();
  } catch (error) {
    console.warn('[启动] API Keys 迁移失败，不影响服务启动:', error);
  }

  // 从 MongoDB 加载 API Keys 到内存缓存（失败则降级到文件）
  await loadFromDatabase();

  // 从环境变量导入默认 API Key（如果数据库中不存在则插入）
  await initializeFromEnv(config.apiKey);

  const server = app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Health check: http://localhost:${config.port}/api/health`);
  });

  // 设置请求超时为12分钟（视频生成轮询最长10分钟，需留足缓冲）
  server.timeout = 720_000;
  server.requestTimeout = 720_000;
  server.headersTimeout = 730_000;
  server.keepAliveTimeout = 730_000;

  // 优雅关闭
  process.on('SIGTERM', async () => {
    console.log('[关闭] 收到 SIGTERM，正在关闭...');
    server.close();
    await closeMongo();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    console.log('[关闭] 收到 SIGINT，正在关闭...');
    server.close();
    await closeMongo();
    process.exit(0);
  });
}

startServer();
