import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getCoworkStore, getCoworkRunner, getSkillManager } from '../services/init';
import { probeCoworkModelReadiness } from '../../main/libs/coworkUtil';
import { getSandboxStatus, ensureSandboxReady } from '../../main/libs/coworkSandboxRuntime';

export const coworkRouter = Router();

const MIN_MEMORY_USER_MEMORIES_MAX_ITEMS = 1;
const MAX_MEMORY_USER_MEMORIES_MAX_ITEMS = 60;

const resolveTaskWorkingDirectory = (workspaceRoot: string): string => {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  fs.mkdirSync(resolvedWorkspaceRoot, { recursive: true });
  if (!fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
    throw new Error(`Selected workspace is not a directory: ${resolvedWorkspaceRoot}`);
  }
  return resolvedWorkspaceRoot;
};

// POST /api/cowork/sessions/start
coworkRouter.post('/sessions/start', async (req, res) => {
  try {
    const options = req.body;
    const coworkStoreInstance = getCoworkStore();
    const config = coworkStoreInstance.getConfig();
    const systemPrompt = options.systemPrompt ?? config.systemPrompt;
    const selectedWorkspaceRoot = (options.cwd || config.workingDirectory || '').trim();

    if (!selectedWorkspaceRoot) {
      res.json({ success: false, error: 'Please select a task folder before submitting.' });
      return;
    }

    const fallbackTitle = options.prompt.split('\n')[0].slice(0, 50) || 'New Session';
    const title = options.title?.trim() || fallbackTitle;
    const taskWorkingDirectory = resolveTaskWorkingDirectory(selectedWorkspaceRoot);

    const session = coworkStoreInstance.createSession(
      title,
      taskWorkingDirectory,
      systemPrompt,
      config.executionMode || 'local',
      options.activeSkillIds || []
    );

    const messageMetadata: Record<string, unknown> = {};
    if (options.activeSkillIds?.length) messageMetadata.skillIds = options.activeSkillIds;
    if (options.imageAttachments?.length) messageMetadata.imageAttachments = options.imageAttachments;

    coworkStoreInstance.addMessage(session.id, {
      type: 'user',
      content: options.prompt,
      metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
    });

    const probe = await probeCoworkModelReadiness();
    if (probe.ok === false) {
      coworkStoreInstance.updateSession(session.id, { status: 'error' });
      coworkStoreInstance.addMessage(session.id, {
        type: 'system',
        content: `Error: ${probe.error}`,
        metadata: { error: probe.error },
      });
      const failedSession = coworkStoreInstance.getSession(session.id) || { ...session, status: 'error' as const };
      res.json({ success: true, session: failedSession });
      return;
    }

    const runner = getCoworkRunner();
    coworkStoreInstance.updateSession(session.id, { status: 'running' });

    runner.startSession(session.id, options.prompt, {
      skipInitialUserMessage: true,
      skillIds: options.activeSkillIds,
      workspaceRoot: selectedWorkspaceRoot,
      confirmationMode: 'modal',
      imageAttachments: options.imageAttachments,
    }).catch(error => console.error('Cowork session error:', error));

    const sessionWithMessages = coworkStoreInstance.getSession(session.id) || { ...session, status: 'running' as const };
    res.json({ success: true, session: sessionWithMessages });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to start session' });
  }
});

// POST /api/cowork/sessions/continue
coworkRouter.post('/sessions/continue', async (req, res) => {
  try {
    const options = req.body;
    const runner = getCoworkRunner();
    runner.continueSession(options.sessionId, options.prompt, {
      systemPrompt: options.systemPrompt,
      skillIds: options.activeSkillIds,
      imageAttachments: options.imageAttachments,
    }).catch(error => console.error('Cowork continue error:', error));

    const session = getCoworkStore().getSession(options.sessionId);
    res.json({ success: true, session });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to continue session' });
  }
});

// POST /api/cowork/sessions/:id/stop
coworkRouter.post('/sessions/:id/stop', async (req, res) => {
  try {
    getCoworkRunner().stopSession(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to stop session' });
  }
});

// DELETE /api/cowork/sessions/:id
coworkRouter.delete('/sessions/:id', async (req, res) => {
  try {
    getCoworkStore().deleteSession(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to delete session' });
  }
});

// POST /api/cowork/sessions/batch-delete
coworkRouter.post('/sessions/batch-delete', async (req, res) => {
  try {
    getCoworkStore().deleteSessions(req.body.sessionIds);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to batch delete sessions' });
  }
});

// PUT /api/cowork/sessions/:id/pin
coworkRouter.put('/sessions/:id/pin', async (req, res) => {
  try {
    getCoworkStore().setSessionPinned(req.params.id, req.body.pinned);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to update pin' });
  }
});

// PUT /api/cowork/sessions/:id/rename
coworkRouter.put('/sessions/:id/rename', async (req, res) => {
  try {
    const title = req.body.title?.trim();
    if (!title) {
      res.json({ success: false, error: 'Title is required' });
      return;
    }
    getCoworkStore().updateSession(req.params.id, { title });
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to rename session' });
  }
});

// GET /api/cowork/sessions/:id
coworkRouter.get('/sessions/:id', async (req, res) => {
  try {
    const session = getCoworkStore().getSession(req.params.id);
    res.json({ success: true, session });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to get session' });
  }
});

// GET /api/cowork/sessions
coworkRouter.get('/sessions', async (_req, res) => {
  try {
    const sessions = getCoworkStore().listSessions();
    res.json({ success: true, sessions });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to list sessions' });
  }
});

// POST /api/cowork/permission/respond
coworkRouter.post('/permission/respond', async (req, res) => {
  try {
    getCoworkRunner().respondToPermission(req.body.requestId, req.body.result);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to respond to permission' });
  }
});

// GET /api/cowork/config
coworkRouter.get('/config', async (_req, res) => {
  try {
    const config = getCoworkStore().getConfig();
    res.json({ success: true, config });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to get config' });
  }
});

// PUT /api/cowork/config
coworkRouter.put('/config', async (req, res) => {
  try {
    const config = req.body;
    const normalizedExecutionMode =
      config.executionMode && String(config.executionMode) === 'container'
        ? 'sandbox'
        : config.executionMode;
    const normalizedMemoryEnabled = typeof config.memoryEnabled === 'boolean' ? config.memoryEnabled : undefined;
    const normalizedMemoryImplicitUpdateEnabled = typeof config.memoryImplicitUpdateEnabled === 'boolean' ? config.memoryImplicitUpdateEnabled : undefined;
    const normalizedMemoryLlmJudgeEnabled = typeof config.memoryLlmJudgeEnabled === 'boolean' ? config.memoryLlmJudgeEnabled : undefined;
    const normalizedMemoryGuardLevel = ['strict', 'standard', 'relaxed'].includes(config.memoryGuardLevel) ? config.memoryGuardLevel : undefined;
    const normalizedMemoryUserMemoriesMaxItems =
      typeof config.memoryUserMemoriesMaxItems === 'number' && Number.isFinite(config.memoryUserMemoriesMaxItems)
        ? Math.max(MIN_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.min(MAX_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.floor(config.memoryUserMemoriesMaxItems)))
        : undefined;

    const normalizedConfig = {
      ...config,
      executionMode: normalizedExecutionMode,
      memoryEnabled: normalizedMemoryEnabled,
      memoryImplicitUpdateEnabled: normalizedMemoryImplicitUpdateEnabled,
      memoryLlmJudgeEnabled: normalizedMemoryLlmJudgeEnabled,
      memoryGuardLevel: normalizedMemoryGuardLevel,
      memoryUserMemoriesMaxItems: normalizedMemoryUserMemoriesMaxItems,
    };

    const previousWorkingDir = getCoworkStore().getConfig().workingDirectory;
    getCoworkStore().setConfig(normalizedConfig);
    if (normalizedConfig.workingDirectory !== undefined && normalizedConfig.workingDirectory !== previousWorkingDir) {
      getSkillManager().handleWorkingDirectoryChange();
    }
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to set config' });
  }
});

// POST /api/cowork/memory/entries — list
coworkRouter.post('/memory/entries', async (req, res) => {
  try {
    const input = req.body;
    const entries = getCoworkStore().listUserMemories({
      query: input?.query?.trim() || undefined,
      status: input?.status || 'all',
      includeDeleted: Boolean(input?.includeDeleted),
      limit: input?.limit,
      offset: input?.offset,
    });
    res.json({ success: true, entries });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to list memory entries' });
  }
});

// POST /api/cowork/memory/entries/create
coworkRouter.post('/memory/entries/create', async (req, res) => {
  try {
    const entry = getCoworkStore().createUserMemory(req.body);
    res.json({ success: true, entry });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to create memory entry' });
  }
});

// PUT /api/cowork/memory/entries/update
coworkRouter.put('/memory/entries/update', async (req, res) => {
  try {
    const entry = getCoworkStore().updateUserMemory(req.body);
    if (!entry) {
      res.json({ success: false, error: 'Memory entry not found' });
      return;
    }
    res.json({ success: true, entry });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to update memory entry' });
  }
});

// DELETE /api/cowork/memory/entries/:id
coworkRouter.delete('/memory/entries/:id', async (req, res) => {
  try {
    const success = getCoworkStore().deleteUserMemory(req.params.id);
    res.json(success ? { success: true } : { success: false, error: 'Memory entry not found' });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to delete memory entry' });
  }
});

// GET /api/cowork/memory/stats
coworkRouter.get('/memory/stats', async (_req, res) => {
  try {
    const stats = getCoworkStore().getUserMemoryStats();
    res.json({ success: true, stats });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to get memory stats' });
  }
});

// GET /api/cowork/sandbox/status
coworkRouter.get('/sandbox/status', async (_req, res) => {
  try {
    res.json(getSandboxStatus());
  } catch (error: any) {
    res.json({ supported: false, runtimeReady: false, imageReady: false, downloading: false, error: error.message });
  }
});

// POST /api/cowork/sandbox/install
coworkRouter.post('/sandbox/install', async (_req, res) => {
  try {
    const result = await ensureSandboxReady();
    res.json({
      success: result.ok,
      status: getSandboxStatus(),
      error: result.ok ? undefined : ('error' in result ? result.error : undefined),
    });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});
