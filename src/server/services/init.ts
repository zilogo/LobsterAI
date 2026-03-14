import os from 'os';
import path from 'path';
import fs from 'fs';
import { SqliteStore } from '../../main/sqliteStore';
import { CoworkStore } from '../../main/coworkStore';
import { CoworkRunner } from '../../main/libs/coworkRunner';
import { SkillManager } from '../../main/skillManager';
import { McpStore } from '../../main/mcpStore';
import { ScheduledTaskStore } from '../../main/scheduledTaskStore';
import { Scheduler } from '../../main/libs/scheduler';
import { IMGatewayManager, IMPlatform, IMGatewayConfig } from '../../main/im';
import { APP_NAME, DB_FILENAME } from '../../main/appConstants';
import { setStoreGetter } from '../../main/libs/claudeSettings';
import { setScheduledTaskDeps, startCoworkOpenAICompatProxy } from '../../main/libs/coworkOpenAICompatProxy';
import { broadcast } from '../ws';

/**
 * 服务层 — 初始化所有后端服务实例（复用主进程逻辑）。
 * 注入 AppContext 替代 Electron 的 app.getPath() 等 API。
 */

export interface AppContext {
  userDataPath: string;
  resourcesPath: string;
  appPath: string;
  homePath: string;
  isPackaged: boolean;
}

let appContext: AppContext | null = null;
let store: SqliteStore | null = null;
let coworkStore: CoworkStore | null = null;
let coworkRunner: CoworkRunner | null = null;
let skillManager: SkillManager | null = null;
let mcpStore: McpStore | null = null;
let imGatewayManager: IMGatewayManager | null = null;
let scheduledTaskStore: ScheduledTaskStore | null = null;
let scheduler: Scheduler | null = null;

function resolveAppContext(): AppContext {
  const homePath = os.homedir();
  // 与 Electron 的 app.getPath('userData') 保持一致，共享同一份数据
  // macOS: ~/Library/Application Support/{APP_NAME}
  // Linux: ~/.config/{APP_NAME}
  // Windows: %APPDATA%/{APP_NAME}
  const userDataPath = process.env.LOBSTERAI_DATA_DIR
    || (process.platform === 'darwin'
      ? path.join(homePath, 'Library', 'Application Support', APP_NAME)
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(homePath, 'AppData', 'Roaming'), APP_NAME)
        : path.join(process.env.XDG_CONFIG_HOME || path.join(homePath, '.config'), APP_NAME));

  fs.mkdirSync(userDataPath, { recursive: true });

  return {
    userDataPath,
    resourcesPath: path.resolve(__dirname, '../../..'),
    appPath: path.resolve(__dirname, '../../..'),
    homePath,
    isPackaged: process.env.NODE_ENV === 'production',
  };
}

export function getAppContext(): AppContext {
  if (!appContext) {
    appContext = resolveAppContext();
  }
  return appContext;
}

export async function initStore(): Promise<SqliteStore> {
  if (store) return store;
  const ctx = getAppContext();
  store = await SqliteStore.create(ctx.userDataPath);
  setStoreGetter(() => store!);
  return store;
}

export function getStore(): SqliteStore {
  if (!store) throw new Error('Store not initialized. Call initStore() first.');
  return store;
}

export function getCoworkStore(): CoworkStore {
  if (!coworkStore) {
    const sqliteStore = getStore();
    coworkStore = new CoworkStore(sqliteStore.getDatabase(), sqliteStore.getSaveFunction());
    const cleaned = coworkStore.autoDeleteNonPersonalMemories();
    if (cleaned > 0) {
      console.info(`[cowork-memory] Auto-deleted ${cleaned} non-personal/procedural memories`);
    }
  }
  return coworkStore;
}

export function getCoworkRunner(): CoworkRunner {
  if (!coworkRunner) {
    coworkRunner = new CoworkRunner(getCoworkStore());

    // MCP server provider
    coworkRunner.setMcpServerProvider(() => getMcpStore().getEnabledServers());

    // 事件转发到 WebSocket
    coworkRunner.on('message', (sessionId: string, message: any) => {
      broadcast('cowork:stream:message', { sessionId, message });
    });

    coworkRunner.on('messageUpdate', (sessionId: string, messageId: string, content: string) => {
      broadcast('cowork:stream:messageUpdate', { sessionId, messageId, content });
    });

    coworkRunner.on('permissionRequest', (sessionId: string, request: any) => {
      if (coworkRunner?.getSessionConfirmationMode(sessionId) === 'text') return;
      broadcast('cowork:stream:permission', { sessionId, request });
    });

    coworkRunner.on('complete', (sessionId: string, claudeSessionId: string | null) => {
      broadcast('cowork:stream:complete', { sessionId, claudeSessionId });
    });

    coworkRunner.on('error', (sessionId: string, error: string) => {
      broadcast('cowork:stream:error', { sessionId, error });
    });
  }
  return coworkRunner;
}

export function getSkillManager(): SkillManager {
  if (!skillManager) {
    skillManager = new SkillManager(() => getStore());
  }
  return skillManager;
}

export function getMcpStore(): McpStore {
  if (!mcpStore) {
    const sqliteStore = getStore();
    mcpStore = new McpStore(sqliteStore.getDatabase(), sqliteStore.getSaveFunction());
  }
  return mcpStore;
}

export function getIMGatewayManager(): IMGatewayManager {
  if (!imGatewayManager) {
    const sqliteStore = getStore();
    const runner = getCoworkRunner();
    const cwStore = getCoworkStore();

    imGatewayManager = new IMGatewayManager(
      sqliteStore.getDatabase(),
      sqliteStore.getSaveFunction(),
      { coworkRunner: runner, coworkStore: cwStore }
    );

    // IM 状态变化转发到 WebSocket
    imGatewayManager.on('statusChange', (status: any) => {
      broadcast('im:status:change', status);
    });

    imGatewayManager.on('messageReceived', (message: any) => {
      broadcast('im:message:received', message);
    });

    // 初始化 LLM 配置
    imGatewayManager.initialize({
      getLLMConfig: async () => {
        const appConfig = sqliteStore.get<any>('app_config');
        if (!appConfig) return null;
        const providers = appConfig.providers || {};
        for (const [providerName, providerConfig] of Object.entries(providers) as [string, any][]) {
          if (providerConfig.enabled && providerConfig.apiKey) {
            const model = providerConfig.models?.[0]?.id;
            return { apiKey: providerConfig.apiKey, baseUrl: providerConfig.baseUrl, model, provider: providerName };
          }
        }
        return null;
      },
      getSkillsPrompt: async () => getSkillManager().buildAutoRoutingPrompt(),
    });
  }
  return imGatewayManager;
}

export function getScheduledTaskStore(): ScheduledTaskStore {
  if (!scheduledTaskStore) {
    const sqliteStore = getStore();
    scheduledTaskStore = new ScheduledTaskStore(sqliteStore.getDatabase(), sqliteStore.getSaveFunction());
  }
  return scheduledTaskStore;
}

export function getScheduler(): Scheduler {
  if (!scheduler) {
    scheduler = new Scheduler({
      scheduledTaskStore: getScheduledTaskStore(),
      coworkStore: getCoworkStore(),
      getCoworkRunner: () => getCoworkRunner(),
    });
  }
  return scheduler;
}

/**
 * 初始化所有服务 — 在 Express 启动时调用。
 */
export async function initializeAllServices(): Promise<void> {
  console.log('[Server] Initializing services...');

  await initStore();
  console.log('[Server] SqliteStore initialized');

  getCoworkStore();
  console.log('[Server] CoworkStore initialized');

  getCoworkRunner();
  console.log('[Server] CoworkRunner initialized');

  getSkillManager();
  console.log('[Server] SkillManager initialized');

  getMcpStore();
  console.log('[Server] McpStore initialized');

  try {
    getIMGatewayManager();
    console.log('[Server] IMGatewayManager initialized');
  } catch (error) {
    console.warn('[Server] IMGatewayManager initialization failed (non-fatal):', error);
  }

  getScheduledTaskStore();
  console.log('[Server] ScheduledTaskStore initialized');

  try {
    const sched = getScheduler();
    sched.start();
    console.log('[Server] Scheduler started');
  } catch (error) {
    console.warn('[Server] Scheduler initialization failed (non-fatal):', error);
  }

  // 设置定时任务依赖
  setScheduledTaskDeps({
    getScheduledTaskStore: () => getScheduledTaskStore(),
    getScheduler: () => getScheduler(),
  });

  // 启动 OpenAI 兼容代理 — Claude Agent SDK 通过它与 LLM 通信
  try {
    await startCoworkOpenAICompatProxy();
    console.log('[Server] OpenAI compatibility proxy started');
  } catch (error) {
    console.warn('[Server] OpenAI compatibility proxy failed to start (non-fatal):', error);
  }

  console.log('[Server] All services initialized');
}
