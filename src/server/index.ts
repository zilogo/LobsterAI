import http from 'http';
import { ProxyAgent, Agent, setGlobalDispatcher, Dispatcher } from 'undici';
import { createApp } from './app';
import { setupWebSocket } from './ws';
import { initializeAllServices } from './services/init';
import { getProxyUrl, getProxyDomains, shouldProxy } from '../main/libs/proxyConfig';

// ---------------------------------------------------------------------------
// 全局选择性代理 dispatcher
//
// 读取 PROXY_URL + PROXY_DOMAINS 环境变量：
//   PROXY_URL=http://172.16.10.3:10811
//   PROXY_DOMAINS=github.com,google.com,telegram.org,yahoo.com
//
// 只有目标域名匹配 PROXY_DOMAINS 白名单时才走代理，其余直连。
// 对进程内所有 globalThis.fetch 调用全局生效，无需逐调用点处理。
// ---------------------------------------------------------------------------
const proxyUrl = getProxyUrl();
const proxyDomains = getProxyDomains();

if (proxyUrl && proxyDomains.length > 0) {
  const proxyAgent = new ProxyAgent(proxyUrl);
  const directAgent = new Agent();

  class SelectiveProxyDispatcher extends Dispatcher {
    dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers): boolean {
      const origin = typeof options.origin === 'string'
        ? options.origin
        : String(options.origin || '');

      return shouldProxy(origin)
        ? proxyAgent.dispatch(options, handler)
        : directAgent.dispatch(options, handler);
    }

    async close(): Promise<void> {
      await Promise.all([proxyAgent.close(), directAgent.close()]);
    }

    async destroy(): Promise<void> {
      await Promise.all([proxyAgent.destroy(), directAgent.destroy()]);
    }
  }

  setGlobalDispatcher(new SelectiveProxyDispatcher());
  console.log(`[Proxy] Selective proxy enabled: ${proxyUrl}`);
  console.log(`[Proxy] Proxied domains: ${proxyDomains.join(', ')}`);
} else if (proxyUrl) {
  console.log('[Proxy] PROXY_URL is set but PROXY_DOMAINS is empty — proxy disabled');
}

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
