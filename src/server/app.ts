import express from 'express';
import path from 'path';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';

// Route imports
import { storeRouter } from './routes/store';
import { configRouter } from './routes/config';
import { coworkRouter } from './routes/cowork';
import { apiProxyRouter } from './routes/apiProxy';
import { skillsRouter } from './routes/skills';
import { mcpRouter } from './routes/mcp';
import { imRouter } from './routes/im';
import { scheduledTasksRouter } from './routes/scheduledTasks';
import { filesRouter } from './routes/files';
import { appRouter } from './routes/app';
import { logRouter } from './routes/log';

/**
 * 创建 Express 应用实例。
 */
export function createApp(): express.Application {
  const app = express();

  // 基础中间件
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // CORS — 开发模式允许 Vite dev server 跨域
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // 可选认证
  app.use('/api', authMiddleware);

  // API 路由
  app.use('/api/store', storeRouter);
  app.use('/api/config', configRouter);
  app.use('/api/cowork', coworkRouter);
  app.use('/api/proxy', apiProxyRouter);
  app.use('/api/skills', skillsRouter);
  app.use('/api/mcp', mcpRouter);
  app.use('/api/im', imRouter);
  app.use('/api/scheduled-tasks', scheduledTasksRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/app', appRouter);
  app.use('/api/log', logRouter);

  // 生产模式：提供前端静态文件
  if (process.env.NODE_ENV === 'production') {
    const staticPath = path.resolve(__dirname, '../../dist-web');
    app.use(express.static(staticPath));
    // SPA fallback
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

  // 错误处理
  app.use(errorHandler);

  return app;
}
