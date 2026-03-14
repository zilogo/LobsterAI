import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getAppContext } from '../services/init';

export const logRouter = Router();

// GET /api/log/path
logRouter.get('/path', (_req, res) => {
  try {
    const logPath = path.join(getAppContext().userDataPath, 'logs');
    res.json({ path: logPath });
  } catch (error: any) {
    res.json({ path: '' });
  }
});

// POST /api/log/open-folder
logRouter.post('/open-folder', (_req, res) => {
  // Web 模式下不支持打开文件夹
  res.json({ success: true, message: 'Not supported in web mode' });
});

// GET /api/log/export-zip
logRouter.get('/export-zip', async (_req, res) => {
  try {
    const logPath = path.join(getAppContext().userDataPath, 'logs');
    if (!fs.existsSync(logPath)) {
      res.status(404).json({ success: false, error: 'Log directory not found' });
      return;
    }

    // 简单打包日志文件
    const yazl = require('yazl');
    const zipFile = new yazl.ZipFile();
    const files = fs.readdirSync(logPath).filter(f => f.endsWith('.log'));

    for (const file of files) {
      const filePath = path.join(logPath, file);
      zipFile.addFile(filePath, file);
    }

    zipFile.end();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="lobsterai-logs-${Date.now()}.zip"`);
    zipFile.outputStream.pipe(res);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
