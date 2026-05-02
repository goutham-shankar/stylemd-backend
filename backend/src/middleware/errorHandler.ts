import type { Request, Response, NextFunction } from "express";

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;
  const message = err.message || "Internal Server Error";

  console.error(`[error] ${req.method} ${req.path} → ${statusCode}: ${message}`);

  if (req.path.startsWith("/api")) {
    res.status(statusCode).json({ ok: false, error: message });
    return;
  }

  try {
    res.status(statusCode).render("error", {
      statusCode,
      message,
      title: `Error ${statusCode}`,
    });
  } catch {
    res.status(statusCode).send(`
      <!doctype html>
      <html><head><title>Error ${statusCode}</title></head>
      <body style="background:#0a0f1a;color:#e8f4ff;font-family:sans-serif;padding:2rem">
        <h1>Error ${statusCode}</h1>
        <pre>${message}</pre>
      </body></html>
    `);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
