"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cache = new Map();
function set(key, value, ttlSeconds = 60) {
    const expires = Date.now() + ttlSeconds * 1000;
    cache.set(key, { value, expires });
}
function get(key) {
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (Date.now() > entry.expires) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}
function del(key) {
    cache.delete(key);
}
exports.default = { set, get, del };
