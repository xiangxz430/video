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
import { initializeFromEnv } from './services/apiKeyService.js';
import { connectMongo, closeMongo } from './services/mongoService.js';

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' }, crossOriginOpenerPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 初始化：从环境变量导入默认 API Key
initializeFromEnv(config.apiKey);

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

// 启动服务：先连接 MongoDB，再监听端口
async function startServer() {
  try {
    await connectMongo();
  } catch (error) {
    console.error('[启动] MongoDB 连接失败，服务无法启动。请检查 MONGODB_URI 配置。');
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Health check: http://localhost:${config.port}/api/health`);
  });

  // 设置请求超时为5分钟（图片/视频生成耗时长）
  server.timeout = 300_000;
  server.requestTimeout = 300_000;
  server.headersTimeout = 310_000;
  server.keepAliveTimeout = 310_000;

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
