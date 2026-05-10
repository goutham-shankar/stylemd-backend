"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeForLog = summarizeForLog;
function summarizeForLog(value, max = 160) {
    if (value === null || value === undefined) {
        return "none";
    }
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    return raw.length <= max ? raw : `${raw.slice(0, max)}...`;
}
