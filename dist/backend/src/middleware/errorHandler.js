"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
exports.asyncHandler = asyncHandler;
function errorHandler(err, req, res, _next) {
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
    }
    catch {
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
function asyncHandler(fn) {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}
