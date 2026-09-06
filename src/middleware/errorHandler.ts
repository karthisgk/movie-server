import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { logger } from '../utils/logger.js';

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

export const errorHandler: ErrorRequestHandler = (
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const status = err.status ?? err.statusCode ?? 500;

  // Log full error server-side (including stack trace)
  logger.error(`HTTP ${status}: ${err.message}`);

  // Return safe response — no stack traces or internals
  if (!res.headersSent) {
    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : err.message,
    });
  }
};

/** Catches 404s for routes that don't exist */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}
