import { Router } from 'express';
import { getStore, getCoworkStore } from '../services/init';
import { getCurrentApiConfig, resolveCurrentApiConfig } from '../../main/libs/claudeSettings';
import { saveCoworkApiConfig } from '../../main/libs/coworkConfigStore';
import { generateSessionTitle, probeCoworkModelReadiness } from '../../main/libs/coworkUtil';
import { getDefaultApiPublicInfo } from '../../main/libs/defaultApiConfig';

export const configRouter = Router();

// GET /api/config/api — 获取 API 配置
configRouter.get('/api', async (_req, res) => {
  try {
    const config = getCurrentApiConfig();
    res.json({ config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/config/api/check — 检查 API 配置
configRouter.post('/api/check', async (req, res) => {
  try {
    const options = req.body as { probeModel?: boolean } | undefined;
    const { config, error } = resolveCurrentApiConfig();
    if (config && options?.probeModel) {
      const probe = await probeCoworkModelReadiness();
      if (probe.ok === false) {
        res.json({ hasConfig: false, config: null, error: probe.error });
        return;
      }
    }
    res.json({ hasConfig: config !== null, config, error });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/config/api — 保存 API 配置
configRouter.put('/api', async (req, res) => {
  try {
    saveCoworkApiConfig(req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/config/session-title — 生成会话标题
configRouter.post('/session-title', async (req, res) => {
  try {
    const { userInput } = req.body;
    const title = await generateSessionTitle(userInput);
    res.json({ title });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/config/default-api — 获取默认 API 公开信息（无 Key）
configRouter.get('/default-api', (_req, res) => {
  try {
    const info = getDefaultApiPublicInfo();
    res.json({ defaultApi: info });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/config/recent-cwds — 获取最近的工作目录列表
configRouter.get('/recent-cwds', async (req, res) => {
  try {
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 1), 20) : 8;
    const cwds = getCoworkStore().listRecentCwds(limit);
    res.json({ cwds });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
