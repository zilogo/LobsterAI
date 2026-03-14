import type { Request, Response, NextFunction } from 'express';

/**
 * 可选 token 认证中间件。
 * 设置环境变量 LOBSTERAI_AUTH_TOKEN 启用认证。
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requiredToken = process.env.LOBSTERAI_AUTH_TOKEN;

  // 未设置 token 时跳过认证
  if (!requiredToken) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token !== requiredToken) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  next();
}
