import { Router } from 'express';
import { getIMGatewayManager } from '../services/init';

export const imRouter = Router();

// GET /api/im/config
imRouter.get('/config', async (_req, res) => {
  try {
    const manager = getIMGatewayManager();
    const config = manager.getConfig();
    res.json({ success: true, config });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to get IM config' });
  }
});

// PUT /api/im/config
imRouter.put('/config', async (req, res) => {
  try {
    const manager = getIMGatewayManager();
    manager.setConfig(req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to set IM config' });
  }
});

// POST /api/im/gateway/:platform/start
imRouter.post('/gateway/:platform/start', async (req, res) => {
  try {
    const manager = getIMGatewayManager();
    await manager.startGateway(req.params.platform as any);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to start gateway' });
  }
});

// POST /api/im/gateway/:platform/stop
imRouter.post('/gateway/:platform/stop', async (req, res) => {
  try {
    const manager = getIMGatewayManager();
    await manager.stopGateway(req.params.platform as any);
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to stop gateway' });
  }
});

// POST /api/im/gateway/:platform/test
imRouter.post('/gateway/:platform/test', async (req, res) => {
  try {
    const manager = getIMGatewayManager();
    const result = await manager.testGateway(req.params.platform as any, req.body.configOverride);
    res.json({ success: true, result });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to test gateway' });
  }
});

// GET /api/im/status
imRouter.get('/status', async (_req, res) => {
  try {
    const manager = getIMGatewayManager();
    const status = manager.getStatus();
    res.json({ success: true, status });
  } catch (error: any) {
    res.json({ success: false, error: error.message || 'Failed to get IM status' });
  }
});
