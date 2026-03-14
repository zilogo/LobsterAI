/**
 * WebSocketManager — WebSocket 连接管理器
 * 提供自动重连、心跳、消息分发功能。
 */

type MessageHandler = (data: any) => void;

export interface WebSocketManagerOptions {
  url: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private heartbeatIntervalMs: number;
  private currentReconnectDelay: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private handlers = new Map<string, Set<MessageHandler>>();
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;

  constructor(options: WebSocketManagerOptions) {
    this.url = options.url;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
    this.currentReconnectDelay = this.reconnectDelayMs;
  }

  /** 建立 WebSocket 连接 */
  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve) => {
      this.connectResolve = resolve;
      this.createConnection();
    });

    return this.connectPromise;
  }

  private createConnection(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch (error) {
      console.error('[WebSocketManager] Failed to create WebSocket:', error);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WebSocketManager] Connected');
      this.currentReconnectDelay = this.reconnectDelayMs;
      this.startHeartbeat();

      if (this.connectResolve) {
        this.connectResolve();
        this.connectResolve = null;
        this.connectPromise = null;
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === 'pong') return;
        this.dispatch(data);
      } catch (error) {
        console.warn('[WebSocketManager] Failed to parse message:', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log('[WebSocketManager] Disconnected', event.code, event.reason);
      this.stopHeartbeat();
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocketManager] Error:', error);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    console.log(`[WebSocketManager] Reconnecting in ${this.currentReconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, this.currentReconnectDelay);

    // 指数退避
    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * 2,
      this.maxReconnectDelayMs,
    );
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 发送 JSON 消息 */
  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /** 注册事件处理器，返回取消函数 */
  on(event: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  /** 分发消息到对应的处理器 */
  private dispatch(data: any): void {
    const event = data.event || data.type;
    if (!event) return;

    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[WebSocketManager] Handler error for event "${event}":`, error);
        }
      });
    }

    // 通配符处理器 '*'
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error('[WebSocketManager] Wildcard handler error:', error);
        }
      });
    }
  }

  /** 关闭连接 */
  disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectPromise = null;
    this.connectResolve = null;
  }

  /** 连接状态 */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
