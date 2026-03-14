import type { Request, Response, NextFunction } from 'express';

/**
 * 统一错误处理中间件
 */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[Server] Error:', err.message || err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    error: message,
  });
}
