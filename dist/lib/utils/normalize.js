"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function normalize(obj) {
    const out = {
        url: obj.url,
        title: obj.title ? String(obj.title).trim() : null,
        description: obj.description ? String(obj.description).trim() : null,
        h1: obj.h1 ? String(obj.h1).trim() : null,
        canonical: obj.canonical ? String(obj.canonical).trim() : null,
        images: Array.isArray(obj.images) ? obj.images.map(String) : [],
        contentText: obj.contentText ? String(obj.contentText).trim() : null,
        rawHtml: obj.rawHtml ? String(obj.rawHtml) : null,
    };
    return out;
}
exports.default = normalize;
