import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

/**
 * WebSocket 服务器 — 负责事件广播和客户端管理。
 */

let wss: WebSocketServer | null = null;

export function setupWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (error) => {
      console.error('[WS] Client error:', error.message);
    });
  });

  console.log('[WS] WebSocket server ready');
  return wss;
}

/** 向所有连接的客户端广播消息 */
export function broadcast(event: string, payload: any): void {
  if (!wss) return;

  const message = JSON.stringify({ event, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('[WS] Broadcast error:', error);
      }
    }
  });
}

/** 获取 WebSocket 服务器实例 */
export function getWss(): WebSocketServer | null {
  return wss;
}
