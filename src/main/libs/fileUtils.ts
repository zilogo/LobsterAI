import path from 'path';
import fs from 'fs';

/**
 * 校验目标路径在 workingDirectory 内，防止路径穿越。
 * 使用 fs.realpathSync 解析 symlink，防止通过符号链接逃逸。
 */
export const assertWithinWorkspace = (targetPath: string, workingDirectory: string): string => {
  if (!workingDirectory) throw new Error('Working directory not configured');

  const resolvedCwd = fs.realpathSync(path.resolve(workingDirectory));
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(targetPath));
  } catch {
    // 目标不存在（如 mkdir/rename 新路径），对父目录做 realpath 校验
    const parentDir = path.dirname(path.resolve(targetPath));
    const resolvedParent = fs.realpathSync(parentDir);
    if (resolvedParent !== resolvedCwd && !resolvedParent.startsWith(resolvedCwd + path.sep)) {
      throw new Error('Access denied: path outside workspace');
    }
    return path.resolve(targetPath);
  }

  if (resolved !== resolvedCwd && !resolved.startsWith(resolvedCwd + path.sep)) {
    throw new Error('Access denied: path outside workspace');
  }
  return resolved;
};
