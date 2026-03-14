import http from 'http';
import { createApp } from './app';
import { setupWebSocket } from './ws';
import { initializeAllServices } from './services/init';

/**
 * Express 服务器入口 — Web 模式启动点。
 */
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  try {
    // 初始化所有后端服务
    await initializeAllServices();

    // 创建 Express 应用
    const app = createApp();
    const server = http.createServer(app);

    // 设置 WebSocket 服务器
    setupWebSocket(server);

    // 启动 HTTP 服务器
    server.listen(PORT, HOST, () => {
      console.log(`[Server] LobsterAI Web Server running at http://${HOST}:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // 优雅关闭
    const shutdown = () => {
      console.log('[Server] Shutting down...');
      server.close(() => {
        console.log('[Server] HTTP server closed');
        process.exit(0);
      });
      // 强制退出超时
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

main();
