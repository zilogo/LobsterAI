import { Router } from 'express';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { broadcast } from '../ws';

export const apiProxyRouter = Router();

// 存储活跃的流式请求 controller
const activeStreamControllers = new Map<string, AbortController>();

// POST /api/proxy/fetch — 非流式 API 代理
apiProxyRouter.post('/fetch', async (req, res) => {
  try {
    const { url, method, headers, body } = req.body;

    const response = await fetch(url, {
      method,
      headers,
      body: body || undefined,
    });

    const contentType = response.headers.get('content-type') || '';
    let data: string | object;

    if (contentType.includes('text/event-stream')) {
      data = await response.text();
    } else if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    res.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data,
    });
  } catch (error: any) {
    res.json({
      ok: false,
      status: 0,
      statusText: error.message || 'Network error',
      headers: {},
      data: null,
      error: error.message || 'Unknown error',
    });
  }
});

// POST /api/proxy/stream — SSE 流式 API 代理
apiProxyRouter.post('/stream', async (req, res) => {
  const { url, method, headers, body, requestId } = req.body;

  if (!requestId) {
    res.json({ ok: false, status: 0, statusText: 'requestId is required' });
    return;
  }

  const controller = new AbortController();
  activeStreamControllers.set(requestId, controller);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.text();
      activeStreamControllers.delete(requestId);
      res.json({
        ok: false,
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      });
      return;
    }

    if (!response.body) {
      activeStreamControllers.delete(requestId);
      res.json({
        ok: false,
        status: response.status,
        statusText: 'No response body',
      });
      return;
    }

    // 立即返回成功状态
    res.json({
      ok: true,
      status: response.status,
      statusText: response.statusText,
    });

    // 异步读取流并通过 WebSocket 推送
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const readStream = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            broadcast(`api:stream:${requestId}:done`, {});
            break;
          }
          const chunk = decoder.decode(value);
          broadcast(`api:stream:${requestId}:data`, { chunk });
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          broadcast(`api:stream:${requestId}:abort`, {});
        } else {
          broadcast(`api:stream:${requestId}:error`, { error: error.message || 'Stream error' });
        }
      } finally {
        activeStreamControllers.delete(requestId);
      }
    };

    readStream();
  } catch (error: any) {
    activeStreamControllers.delete(requestId);
    res.json({
      ok: false,
      status: 0,
      statusText: error.message || 'Network error',
      error: error.message || 'Unknown error',
    });
  }
});

// POST /api/proxy/stream/:requestId/cancel — 取消流式请求
apiProxyRouter.post('/stream/:requestId/cancel', (req, res) => {
  const controller = activeStreamControllers.get(req.params.requestId);
  if (controller) {
    controller.abort();
    activeStreamControllers.delete(req.params.requestId);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});
