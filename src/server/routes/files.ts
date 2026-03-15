import { Router } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { getAppContext, getCoworkStore } from '../services/init';
import { APP_ID } from '../../main/appConstants';
import { assertWithinWorkspace } from '../../main/libs/fileUtils';

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

const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const MAX_INLINE_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB

const sanitizeAttachmentFileName = (value?: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'attachment';
  const fileName = path.basename(raw);
  const sanitized = fileName.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'attachment';
};

const inferAttachmentExtension = (fileName: string, mimeType?: string): string => {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName) {
    return fromName;
  }
  if (typeof mimeType === 'string') {
    const normalized = mimeType.toLowerCase().split(';')[0].trim();
    return MIME_EXTENSION_MAP[normalized] ?? '';
  }
  return '';
};

/** 与 Electron main.ts resolveInlineAttachmentDir 保持一致 */
const resolveInlineAttachmentDir = (cwd?: string): string => {
  const buildDir = (base: string) => path.join(base, '.cowork-temp', 'attachments', 'manual');

  try {
    const configuredCwd = getCoworkStore().getConfig().workingDirectory;
    const resolvedConfigured = configuredCwd ? path.resolve(configuredCwd) : '';

    // 优先使用传入的 cwd（须为 workingDirectory 或其子路径）
    const trimmed = typeof cwd === 'string' ? cwd.trim() : '';
    if (trimmed) {
      const resolved = path.resolve(trimmed);
      if (resolvedConfigured && resolved.startsWith(resolvedConfigured)) {
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          return buildDir(resolved);
        }
      }
    }

    // fallback: 直接使用已配置的 workingDirectory
    if (resolvedConfigured) {
      return buildDir(resolvedConfigured);
    }
  } catch {
    // coworkStore 未初始化时 fallback
  }

  return path.join(os.tmpdir(), APP_ID, 'attachments');
};

// POST /api/files/save-inline
filesRouter.post('/save-inline', async (req, res) => {
  try {
    const { dataBase64, fileName, mimeType, cwd } = req.body;

    let rawBase64 = typeof dataBase64 === 'string' ? dataBase64.trim() : '';
    // 容错：剥离 data URL 前缀 (e.g. "data:image/png;base64,...")
    const commaIdx = rawBase64.indexOf(',');
    if (commaIdx !== -1 && rawBase64.slice(0, commaIdx).includes(';base64')) {
      rawBase64 = rawBase64.slice(commaIdx + 1);
    }
    if (!rawBase64) {
      res.json({ success: false, path: null, error: 'Missing file data' });
      return;
    }

    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length) {
      res.json({ success: false, path: null, error: 'Invalid file data' });
      return;
    }
    if (buffer.length > MAX_INLINE_ATTACHMENT_BYTES) {
      res.json({
        success: false,
        path: null,
        error: `File too large (max ${Math.floor(MAX_INLINE_ATTACHMENT_BYTES / (1024 * 1024))}MB)`,
      });
      return;
    }

    const dir = resolveInlineAttachmentDir(cwd);
    fs.mkdirSync(dir, { recursive: true });

    const safeFileName = sanitizeAttachmentFileName(fileName);
    const extension = inferAttachmentExtension(safeFileName, mimeType);
    const baseName = extension ? safeFileName.slice(0, -extension.length) : safeFileName;
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const finalName = `${baseName || 'attachment'}-${uniqueSuffix}${extension}`;
    const outputPath = path.join(dir, finalName);

    fs.writeFileSync(outputPath, buffer);

    res.json({ success: true, path: outputPath });
  } catch (error: any) {
    res.json({ success: false, path: null, error: error.message });
  }
});

// ==================== Workspace File Browser ====================

const getWorkingDirectory = (): string => {
  const config = getCoworkStore().getConfig();
  return config.workingDirectory || '';
};

// GET /api/files/list?dir=<path>
filesRouter.get('/list', (req, res) => {
  try {
    const workingDir = getWorkingDirectory();
    const dirPath = (req.query.dir as string) || workingDir;
    const resolved = assertWithinWorkspace(dirPath, workingDir);

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      res.json({ success: false, error: 'Directory not found' });
      return;
    }

    const dirents = fs.readdirSync(resolved, { withFileTypes: true });
    const entries = dirents
      .filter((d) => !d.name.startsWith('.'))
      .map((d) => {
        const fullPath = path.join(resolved, d.name);
        let size = 0;
        let modifiedAt = 0;
        try {
          const stat = fs.statSync(fullPath);
          size = d.isDirectory() ? 0 : stat.size;
          modifiedAt = stat.mtimeMs;
        } catch {
          // 无法 stat 的条目跳过大小/时间
        }
        return {
          name: d.name,
          path: fullPath,
          isDirectory: d.isDirectory(),
          size,
          modifiedAt,
        };
      })
      .sort((a, b) => {
        // 目录在前，文件在后；同类按名称排序
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ success: true, entries });
  } catch (error: any) {
    const status = error.message?.includes('Access denied') ? 403 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/files/upload
filesRouter.post('/upload', (req, res) => {
  try {
    const { dataBase64, fileName, targetDir, mimeType } = req.body;
    const workingDir = getWorkingDirectory();

    if (!dataBase64 || !fileName || !targetDir) {
      res.json({ success: false, error: 'Missing required fields: dataBase64, fileName, targetDir' });
      return;
    }

    const resolvedDir = assertWithinWorkspace(targetDir, workingDir);

    if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
      res.json({ success: false, error: 'Target directory not found' });
      return;
    }

    let rawBase64 = typeof dataBase64 === 'string' ? dataBase64.trim() : '';
    const commaIdx = rawBase64.indexOf(',');
    if (commaIdx !== -1 && rawBase64.slice(0, commaIdx).includes(';base64')) {
      rawBase64 = rawBase64.slice(commaIdx + 1);
    }

    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length) {
      res.json({ success: false, error: 'Invalid file data' });
      return;
    }

    const safeName = path.basename(fileName).replace(INVALID_FILE_NAME_PATTERN, '_');
    let outputPath = path.join(resolvedDir, safeName);

    // 文件名冲突时添加序号
    if (fs.existsSync(outputPath)) {
      const ext = path.extname(safeName);
      const base = safeName.slice(0, -ext.length || undefined);
      let counter = 1;
      while (fs.existsSync(outputPath)) {
        outputPath = path.join(resolvedDir, `${base} (${counter})${ext}`);
        counter++;
      }
    }

    // 校验最终写入路径仍在 workspace 内
    assertWithinWorkspace(outputPath, workingDir);

    fs.writeFileSync(outputPath, buffer);
    res.json({ success: true, path: outputPath });
  } catch (error: any) {
    const status = error.message?.includes('Access denied') ? 403 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// GET /api/files/download?path=<path>
filesRouter.get('/download', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ success: false, error: 'path parameter is required' });
      return;
    }

    const workingDir = getWorkingDirectory();
    const resolved = assertWithinWorkspace(filePath, workingDir);

    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }

    const fileName = path.basename(resolved);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    fs.createReadStream(resolved).pipe(res);
  } catch (error: any) {
    const status = error.message?.includes('Access denied') ? 403 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/files/delete (使用 POST 而非 DELETE，避免某些代理/CDN 剥离 DELETE body)
filesRouter.post('/delete', (req, res) => {
  try {
    const { targetPath } = req.body;
    if (!targetPath) {
      res.json({ success: false, error: 'targetPath is required' });
      return;
    }

    const workingDir = getWorkingDirectory();
    const resolved = assertWithinWorkspace(targetPath, workingDir);

    // 不允许删除工作目录本身
    const resolvedCwd = fs.realpathSync(path.resolve(workingDir));
    if (resolved === resolvedCwd) {
      res.status(403).json({ success: false, error: 'Cannot delete workspace root' });
      return;
    }

    if (!fs.existsSync(resolved)) {
      res.json({ success: false, error: 'Path not found' });
      return;
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      fs.rmdirSync(resolved); // 仅删除空目录
    } else {
      fs.unlinkSync(resolved);
    }

    res.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes('Access denied') ? 403 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/files/mkdir
filesRouter.post('/mkdir', (req, res) => {
  try {
    const { dirPath } = req.body;
    if (!dirPath) {
      res.json({ success: false, error: 'dirPath is required' });
      return;
    }

    const workingDir = getWorkingDirectory();
    const resolved = assertWithinWorkspace(dirPath, workingDir);

    if (fs.existsSync(resolved)) {
      res.json({ success: false, error: 'Path already exists' });
      return;
    }

    fs.mkdirSync(resolved, { recursive: true });
    res.json({ success: true, path: resolved });
  } catch (error: any) {
    const status = error.message?.includes('Access denied') ? 403 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/files/rename
filesRouter.post('/rename', (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      res.json({ success: false, error: 'oldPath and newPath are required' });
      return;
    }

    const workingDir = getWorkingDirectory();
    const resolvedOld = assertWithinWorkspace(oldPath, workingDir);
    const resolvedNew = assertWithinWorkspace(newPath, workingDir);

    if (!fs.existsSync(resolvedOld)) {
      res.json({ success: false, error: 'Source path not found' });
      return;
    }

    if (fs.existsSync(resolvedNew)) {
      res.json({ success: false, error: 'Target path already exists' });
      return;
    }

    fs.renameSync(resolvedOld, resolvedNew);
    res.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes('Access denied') ? 403 : 500;
    res.status(status).json({ success: false, error: error.message });
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
