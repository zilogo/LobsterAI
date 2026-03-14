import type { IPlatformAdapter, CoworkPermissionResult, CoworkConfigUpdate, ImageAttachment } from '../../shared/types/platform';
import { WebSocketManager } from './WebSocketManager';
import { fileToBase64 } from '../utils/file';

/**
 * WebAdapter — HTTP REST + WebSocket 客户端。
 * 在纯 Web 模式下使用，通过 Express 后端访问所有服务。
 */

const getBaseUrl = (): string => {
  // 开发模式使用 Vite 代理，生产模式直接使用同源
  return '';
};

const apiFetch = async (path: string, options: RequestInit = {}): Promise<any> => {
  const url = `${getBaseUrl()}/api${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  // 可选 token 认证
  const token = sessionStorage.getItem('lobsterai_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }
  return response.json();
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

export class WebAdapter implements IPlatformAdapter {
  private wsManager: WebSocketManager;

  constructor() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    this.wsManager = new WebSocketManager({ url: wsUrl });
    this.wsManager.connect();
  }

  get platform(): string {
    // 检测浏览器平台
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'win32';
    if (ua.includes('mac')) return 'darwin';
    if (ua.includes('linux')) return 'linux';
    return 'web';
  }

  get arch(): string {
    return 'web';
  }

  // ==================== Store ====================
  store = {
    get: (key: string) => apiFetch(`/store/${encodeURIComponent(key)}`).then((r) => r.value),
    set: (key: string, value: any) => apiFetch(`/store/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }).then(() => undefined),
    remove: (key: string) => apiFetch(`/store/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }).then(() => undefined),
  };

  // ==================== Skills ====================
  skills = {
    list: () => apiFetch('/skills'),
    setEnabled: (options: { id: string; enabled: boolean }) =>
      apiFetch(`/skills/${encodeURIComponent(options.id)}/enabled`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: options.enabled }),
      }),
    delete: (id: string) => apiFetch(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    download: (source: string) => apiFetch('/skills/download', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),
    getRoot: () => apiFetch('/skills/root'),
    autoRoutingPrompt: () => apiFetch('/skills/auto-routing-prompt'),
    getConfig: (skillId: string) => apiFetch(`/skills/${encodeURIComponent(skillId)}/config`),
    setConfig: (skillId: string, config: Record<string, string>) =>
      apiFetch(`/skills/${encodeURIComponent(skillId)}/config`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
      }),
    testEmailConnectivity: (skillId: string, config: Record<string, string>) =>
      apiFetch(`/skills/${encodeURIComponent(skillId)}/test-email`, {
        method: 'POST',
        body: JSON.stringify({ config }),
      }),
    onChanged: (callback: () => void) =>
      this.wsManager.on('skills:changed', () => callback()),
  };

  // ==================== MCP ====================
  mcp = {
    list: () => apiFetch('/mcp'),
    create: (data: any) => apiFetch('/mcp', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    update: (id: string, data: any) => apiFetch(`/mcp/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    delete: (id: string) => apiFetch(`/mcp/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    setEnabled: (options: { id: string; enabled: boolean }) =>
      apiFetch(`/mcp/${encodeURIComponent(options.id)}/enabled`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: options.enabled }),
      }),
    fetchMarketplace: () => apiFetch('/mcp/marketplace'),
  };

  // ==================== API Proxy ====================
  api = {
    fetch: (options: { url: string; method: string; headers: Record<string, string>; body?: string }) =>
      apiFetch('/proxy/fetch', {
        method: 'POST',
        body: JSON.stringify(options),
      }),
    stream: (options: { url: string; method: string; headers: Record<string, string>; body?: string; requestId: string }) =>
      apiFetch('/proxy/stream', {
        method: 'POST',
        body: JSON.stringify(options),
      }),
    cancelStream: (requestId: string) =>
      apiFetch(`/proxy/stream/${encodeURIComponent(requestId)}/cancel`, { method: 'POST' }).then((r) => r.success),
    onStreamData: (requestId: string, callback: (chunk: string) => void) =>
      this.wsManager.on(`api:stream:${requestId}:data`, (data) => callback(data.chunk)),
    onStreamDone: (requestId: string, callback: () => void) =>
      this.wsManager.on(`api:stream:${requestId}:done`, () => callback()),
    onStreamError: (requestId: string, callback: (error: string) => void) =>
      this.wsManager.on(`api:stream:${requestId}:error`, (data) => callback(data.error)),
    onStreamAbort: (requestId: string, callback: () => void) =>
      this.wsManager.on(`api:stream:${requestId}:abort`, () => callback()),
  };

  // ==================== API Config ====================
  getApiConfig = () => apiFetch('/config/api').then((r) => r.config);
  checkApiConfig = (options?: { probeModel?: boolean }) =>
    apiFetch('/config/api/check', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  saveApiConfig = (config: any) =>
    apiFetch('/config/api', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  generateSessionTitle = (userInput: string | null) =>
    apiFetch('/config/session-title', {
      method: 'POST',
      body: JSON.stringify({ userInput }),
    }).then((r) => r.title);
  getRecentCwds = (limit?: number) =>
    apiFetch(`/config/recent-cwds${limit ? `?limit=${limit}` : ''}`).then((r) => r.cwds);

  // ==================== IPC Renderer (Noop in Web) ====================
  ipcRenderer = {
    send: (_channel: string, ..._args: any[]) => { /* noop */ },
    on: (_channel: string, _func: (...args: any[]) => void) => () => { /* noop */ },
  };

  // ==================== Window (Noop in Web) ====================
  window = {
    minimize: () => { /* noop */ },
    toggleMaximize: () => { /* noop */ },
    close: () => { window.close(); },
    isMaximized: () => Promise.resolve(false),
    showSystemMenu: (_position: { x: number; y: number }) => { /* noop */ },
    onStateChanged: (_callback: (state: any) => void) => () => { /* noop */ },
  };

  // ==================== Cowork ====================
  cowork = {
    startSession: (options: {
      prompt: string;
      cwd?: string;
      systemPrompt?: string;
      title?: string;
      activeSkillIds?: string[];
      imageAttachments?: ImageAttachment[];
    }) => apiFetch('/cowork/sessions/start', {
      method: 'POST',
      body: JSON.stringify(options),
    }),
    continueSession: (options: {
      sessionId: string;
      prompt: string;
      systemPrompt?: string;
      activeSkillIds?: string[];
      imageAttachments?: ImageAttachment[];
    }) => apiFetch('/cowork/sessions/continue', {
      method: 'POST',
      body: JSON.stringify(options),
    }),
    stopSession: (sessionId: string) =>
      apiFetch(`/cowork/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }),
    deleteSession: (sessionId: string) =>
      apiFetch(`/cowork/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
    deleteSessions: (sessionIds: string[]) =>
      apiFetch('/cowork/sessions/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ sessionIds }),
      }),
    setSessionPinned: (options: { sessionId: string; pinned: boolean }) =>
      apiFetch(`/cowork/sessions/${encodeURIComponent(options.sessionId)}/pin`, {
        method: 'PUT',
        body: JSON.stringify({ pinned: options.pinned }),
      }),
    renameSession: (options: { sessionId: string; title: string }) =>
      apiFetch(`/cowork/sessions/${encodeURIComponent(options.sessionId)}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ title: options.title }),
      }),
    getSession: (sessionId: string) =>
      apiFetch(`/cowork/sessions/${encodeURIComponent(sessionId)}`),
    listSessions: () => apiFetch('/cowork/sessions'),
    exportResultImage: (_options: any) =>
      Promise.resolve({ success: false, error: 'Not supported in web mode. Use browser screenshot.' }),
    captureImageChunk: (_options: any) =>
      Promise.resolve({ success: false, error: 'Not supported in web mode. Use html2canvas.' }),
    saveResultImage: (options: { pngBase64: string; defaultFileName?: string }) => {
      // 浏览器端下载 PNG
      try {
        const link = document.createElement('a');
        link.href = `data:image/png;base64,${options.pngBase64}`;
        link.download = options.defaultFileName || `cowork-session-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return Promise.resolve({ success: true, canceled: false });
      } catch (error) {
        return Promise.resolve({ success: false, error: String(error) });
      }
    },
    respondToPermission: (options: { requestId: string; result: CoworkPermissionResult }) =>
      apiFetch('/cowork/permission/respond', {
        method: 'POST',
        body: JSON.stringify(options),
      }),
    getConfig: () => apiFetch('/cowork/config'),
    setConfig: (config: CoworkConfigUpdate) =>
      apiFetch('/cowork/config', {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    listMemoryEntries: (input: any) =>
      apiFetch('/cowork/memory/entries', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    createMemoryEntry: (input: any) =>
      apiFetch('/cowork/memory/entries/create', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateMemoryEntry: (input: any) =>
      apiFetch('/cowork/memory/entries/update', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    deleteMemoryEntry: (input: { id: string }) =>
      apiFetch(`/cowork/memory/entries/${encodeURIComponent(input.id)}`, { method: 'DELETE' }),
    getMemoryStats: () => apiFetch('/cowork/memory/stats'),
    getSandboxStatus: () => apiFetch('/cowork/sandbox/status'),
    installSandbox: () =>
      apiFetch('/cowork/sandbox/install', { method: 'POST' }),
    onSandboxDownloadProgress: (callback: (data: any) => void) =>
      this.wsManager.on('cowork:sandbox:downloadProgress', (data) => callback(data.payload)),
    onStreamMessage: (callback: (data: any) => void) =>
      this.wsManager.on('cowork:stream:message', (data) => callback(data.payload)),
    onStreamMessageUpdate: (callback: (data: any) => void) =>
      this.wsManager.on('cowork:stream:messageUpdate', (data) => callback(data.payload)),
    onStreamPermission: (callback: (data: any) => void) =>
      this.wsManager.on('cowork:stream:permission', (data) => callback(data.payload)),
    onStreamComplete: (callback: (data: any) => void) =>
      this.wsManager.on('cowork:stream:complete', (data) => callback(data.payload)),
    onStreamError: (callback: (data: any) => void) =>
      this.wsManager.on('cowork:stream:error', (data) => callback(data.payload)),
  };

  // ==================== Files (Workspace File Browser) ====================
  files = {
    list: (dirPath: string) =>
      apiFetch(`/files/list?dir=${encodeURIComponent(dirPath)}`),
    upload: (options: { dataBase64: string; fileName: string; targetDir: string; mimeType?: string }) =>
      apiFetch('/files/upload', {
        method: 'POST',
        body: JSON.stringify(options),
      }),
    download: async (filePath: string) => {
      // 使用 fetch 下载以携带 Authorization header
      const url = `${getBaseUrl()}/api/files/download?path=${encodeURIComponent(filePath)}`;
      const headers: Record<string, string> = {};
      const token = sessionStorage.getItem('lobsterai_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      const blob = await response.blob();
      const fileName = filePath.split(/[/\\]/).pop() || 'download';
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    },
    delete: (targetPath: string) =>
      apiFetch('/files/delete', {
        method: 'POST',
        body: JSON.stringify({ targetPath }),
      }),
    mkdir: (dirPath: string) =>
      apiFetch('/files/mkdir', {
        method: 'POST',
        body: JSON.stringify({ dirPath }),
      }),
    rename: (oldPath: string, newPath: string) =>
      apiFetch('/files/rename', {
        method: 'POST',
        body: JSON.stringify({ oldPath, newPath }),
      }),
  };

  // ==================== Dialog ====================
  dialog = {
    selectDirectory: () =>
      // Web 模式：用户手动输入路径
      Promise.resolve({ success: true, path: prompt('Enter directory path:') }),
    selectFile: (_options?: any) => {
      return new Promise<{ success: boolean; path: string | null }>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        if (_options?.filters) {
          const exts = _options.filters.flatMap((f: any) => f.extensions.map((e: string) => `.${e}`));
          input.accept = exts.join(',');
        }
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) {
            resolve({ success: true, path: null });
            return;
          }
          if (file.size > MAX_UPLOAD_BYTES) {
            resolve({ success: false, path: null });
            return;
          }
          try {
            const base64 = await fileToBase64(file);
            const result = await apiFetch('/files/save-inline', {
              method: 'POST',
              body: JSON.stringify({
                dataBase64: base64,
                fileName: file.name,
                mimeType: file.type,
                cwd: _options?.cwd,
              }),
            });
            resolve({ success: true, path: result.success ? result.path : file.name });
          } catch (err) {
            console.warn('[WebAdapter] File upload failed:', file.name, err);
            resolve({ success: false, path: null });
          }
        };
        input.click();
      });
    },
    selectFiles: (_options?: any) => {
      return new Promise<{ success: boolean; paths: string[] }>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        if (_options?.filters) {
          const exts = _options.filters.flatMap((f: any) => f.extensions.map((e: string) => `.${e}`));
          input.accept = exts.join(',');
        }
        input.onchange = async () => {
          const files = Array.from(input.files || []);
          if (files.length === 0) {
            resolve({ success: true, paths: [] });
            return;
          }
          const uploadResults = await Promise.allSettled(
            files.map(async (file) => {
              if (file.size > MAX_UPLOAD_BYTES) {
                console.warn(`[WebAdapter] File too large, skipping: ${file.name}`);
                return null;
              }
              const base64 = await fileToBase64(file);
              const result = await apiFetch('/files/save-inline', {
                method: 'POST',
                body: JSON.stringify({
                  dataBase64: base64,
                  fileName: file.name,
                  mimeType: file.type,
                  cwd: _options?.cwd,
                }),
              });
              return result.success ? result.path : null;
            })
          );
          const paths = uploadResults
            .filter((r): r is PromiseFulfilledResult<string> =>
              r.status === 'fulfilled' && typeof r.value === 'string')
            .map(r => r.value);
          resolve({ success: true, paths });
        };
        input.click();
      });
    },
    saveInlineFile: (options: { dataBase64: string; fileName?: string; mimeType?: string; cwd?: string }) =>
      apiFetch('/files/save-inline', {
        method: 'POST',
        body: JSON.stringify(options),
      }),
    readFileAsDataUrl: (filePath: string) =>
      apiFetch('/files/read-data-url', {
        method: 'POST',
        body: JSON.stringify({ filePath }),
      }),
  };

  // ==================== Shell ====================
  shell = {
    openPath: (_filePath: string) => Promise.resolve({ success: true }),
    showItemInFolder: (_filePath: string) => Promise.resolve({ success: true }),
    openExternal: (url: string) => {
      window.open(url, '_blank');
      return Promise.resolve({ success: true });
    },
  };

  // ==================== AutoLaunch (Noop) ====================
  autoLaunch = {
    get: () => Promise.resolve({ enabled: false }),
    set: (_enabled: boolean) => Promise.resolve({ success: true }),
  };

  // ==================== App Info ====================
  appInfo = {
    getVersion: () => apiFetch('/app/version').then((r) => r.version),
    getSystemLocale: () => Promise.resolve(navigator.language),
  };

  // ==================== App Update (Noop) ====================
  appUpdate = {
    download: (_url: string) => Promise.resolve({ success: false, error: 'Not supported in web mode' }),
    cancelDownload: () => Promise.resolve({ success: true }),
    install: (_filePath: string) => Promise.resolve({ success: false, error: 'Not supported in web mode' }),
    onDownloadProgress: (_callback: (data: any) => void) => () => { /* noop */ },
  };

  // ==================== Log ====================
  log = {
    getPath: () => apiFetch('/log/path').then((r) => r.path),
    openFolder: () => apiFetch('/log/open-folder', { method: 'POST' }).then(() => undefined),
    exportZip: () => {
      // 浏览器下载 zip
      const url = `${getBaseUrl()}/api/log/export-zip`;
      window.open(url, '_blank');
      return Promise.resolve({ success: true });
    },
  };

  // ==================== IM ====================
  im = {
    getConfig: () => apiFetch('/im/config'),
    setConfig: (config: any) => apiFetch('/im/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
    startGateway: (platform: string) =>
      apiFetch(`/im/gateway/${encodeURIComponent(platform)}/start`, { method: 'POST' }),
    stopGateway: (platform: string) =>
      apiFetch(`/im/gateway/${encodeURIComponent(platform)}/stop`, { method: 'POST' }),
    testGateway: (platform: string, configOverride?: any) =>
      apiFetch(`/im/gateway/${encodeURIComponent(platform)}/test`, {
        method: 'POST',
        body: JSON.stringify({ configOverride }),
      }),
    getStatus: () => apiFetch('/im/status'),
    onStatusChange: (callback: (status: any) => void) =>
      this.wsManager.on('im:status:change', (data) => callback(data.payload)),
    onMessageReceived: (callback: (message: any) => void) =>
      this.wsManager.on('im:message:received', (data) => callback(data.payload)),
  };

  // ==================== Scheduled Tasks ====================
  scheduledTasks = {
    list: () => apiFetch('/scheduled-tasks'),
    get: (id: string) => apiFetch(`/scheduled-tasks/${encodeURIComponent(id)}`),
    create: (input: any) => apiFetch('/scheduled-tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    update: (id: string, input: any) => apiFetch(`/scheduled-tasks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
    delete: (id: string) => apiFetch(`/scheduled-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    toggle: (id: string, enabled: boolean) =>
      apiFetch(`/scheduled-tasks/${encodeURIComponent(id)}/toggle`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }),
    runManually: (id: string) =>
      apiFetch(`/scheduled-tasks/${encodeURIComponent(id)}/run`, { method: 'POST' }),
    stop: (id: string) =>
      apiFetch(`/scheduled-tasks/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
    listRuns: (taskId: string, limit?: number, offset?: number) =>
      apiFetch(`/scheduled-tasks/${encodeURIComponent(taskId)}/runs?limit=${limit ?? 20}&offset=${offset ?? 0}`),
    countRuns: (taskId: string) =>
      apiFetch(`/scheduled-tasks/${encodeURIComponent(taskId)}/runs/count`),
    listAllRuns: (limit?: number, offset?: number) =>
      apiFetch(`/scheduled-tasks/runs/all?limit=${limit ?? 20}&offset=${offset ?? 0}`),
    onStatusUpdate: (callback: (data: any) => void) =>
      this.wsManager.on('scheduledTask:statusUpdate', (data) => callback(data.payload)),
    onRunUpdate: (callback: (data: any) => void) =>
      this.wsManager.on('scheduledTask:runUpdate', (data) => callback(data.payload)),
  };

  // ==================== Permissions (Noop) ====================
  permissions = {
    checkCalendar: () => Promise.resolve({ success: true, status: 'not-supported' }),
    requestCalendar: () => Promise.resolve({ success: false, granted: false, status: 'not-supported' }),
  };

  // ==================== Network Status ====================
  networkStatus = {
    send: (_status: 'online' | 'offline') => {
      // Web 模式下，通过 WS 通知后端
      this.wsManager.send({ type: 'network:status', status: _status });
    },
  };
}
