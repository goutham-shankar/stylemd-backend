"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = requireAdmin;
/**
 * Minimal admin gate — checks Authorization: Bearer <ADMIN_TOKEN>.
 * Set ADMIN_TOKEN in env to a strong random string.
 */
function requireAdmin(req, res, next) {
    const token = process.env.ADMIN_TOKEN;
    if (!token) {
        res.status(503).json({ ok: false, error: "Admin disabled: set ADMIN_TOKEN" });
        return;
    }
    const header = req.headers.authorization || "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (provided !== token) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
    }
    next();
}
