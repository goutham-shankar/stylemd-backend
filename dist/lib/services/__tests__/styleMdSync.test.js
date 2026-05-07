"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const pageUrlCanonical_1 = require("../../../lib/services/pageUrlCanonical");
const styleMarkdownSanitize_1 = require("../../../lib/services/styleMarkdownSanitize");
(0, node_test_1.default)("canonicalPageUrl lowers host, strips www, trims slash on non-root path", () => {
    strict_1.default.equal((0, pageUrlCanonical_1.canonicalPageUrl)("HTTPS://WWW.Example.COM/foo/"), "https://example.com/foo");
    strict_1.default.equal((0, pageUrlCanonical_1.canonicalPageUrl)("https://levainbakery.com/"), "https://levainbakery.com/");
});
(0, node_test_1.default)("pageUrlVariantsForLookup includes www and non-www", () => {
    const v = (0, pageUrlCanonical_1.pageUrlVariantsForLookup)("https://levainbakery.com/");
    strict_1.default.ok(v.some((x) => x.includes("www.levainbakery")));
    strict_1.default.ok(v.includes("https://levainbakery.com/"));
});
(0, node_test_1.default)("stripLeadingModelPreamble removes LLM chatter before first H1", () => {
    const raw = "Now I have gathered sufficient evidence. Let me compile the style.md based on evidence.\n\n---\n\n# Levain Bakery Style Guide\n\nBody";
    const out = (0, styleMarkdownSanitize_1.stripLeadingModelPreamble)(raw);
    strict_1.default.ok(out.startsWith("# Levain Bakery Style Guide"));
});
