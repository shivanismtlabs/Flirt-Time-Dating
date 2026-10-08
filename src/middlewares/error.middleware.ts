import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

export const notFoundHandler = (req: Request, res: Response) => {
  return sendError(res, `Route not found - ${req.originalUrl}`, 404);
};

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Error:', err);
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';
  return sendError(res, message, statusCode, process.env.NODE_ENV === 'development' ? err.stack : undefined);
};
