import { Router } from 'express';
import brandConfig from '../../../brand.config.json';

export const appRouter = Router();

// GET /api/app/version
appRouter.get('/version', (_req, res) => {
  try {
    // 从 package.json 读取版本
    const pkg = require('../../../package.json');
    res.json({ version: pkg.version });
  } catch (error: any) {
    res.json({ version: '0.0.0' });
  }
});

// GET /api/app/locale
appRouter.get('/locale', (_req, res) => {
  // Web 模式下返回系统 locale
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  res.json({ locale });
});

// GET /api/app/info
appRouter.get('/info', (_req, res) => {
  res.json({
    name: brandConfig.appName,
    mode: 'web',
    platform: process.platform,
  });
});
