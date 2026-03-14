import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getAppContext } from '../services/init';

export const filesRouter = Router();

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
};

// POST /api/files/save-inline
filesRouter.post('/save-inline', async (req, res) => {
  try {
    const { dataBase64, fileName, mimeType, cwd } = req.body;
    if (!dataBase64) {
      res.json({ success: false, path: null, error: 'Missing file data' });
      return;
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    const sanitizedName = (fileName || 'attachment').replace(/[<>:"/\\|?*]/g, '_');
    const ext = path.extname(sanitizedName) || (mimeType ? MIME_EXTENSION_MAP[mimeType] || '' : '');
    const finalName = path.extname(sanitizedName) ? sanitizedName : `${sanitizedName}${ext}`;

    const outputDir = cwd
      ? path.join(path.resolve(cwd), '.cowork-temp', 'attachments', 'manual')
      : path.join(getAppContext().userDataPath, 'attachments');

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, finalName);
    fs.writeFileSync(outputPath, buffer);

    res.json({ success: true, path: outputPath });
  } catch (error: any) {
    res.json({ success: false, path: null, error: error.message });
  }
});

// POST /api/files/read-data-url
filesRouter.post('/read-data-url', async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) {
      res.json({ success: false, error: 'filePath is required' });
      return;
    }
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      res.json({ success: false, error: 'File not found' });
      return;
    }
    const data = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
    res.json({ success: true, dataUrl });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});
