import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPageUrl, pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import { stripLeadingModelPreamble } from "@/lib/services/styleMarkdownSanitize";

test("canonicalPageUrl lowers host, strips www, trims slash on non-root path", () => {
  assert.equal(
    canonicalPageUrl("HTTPS://WWW.Example.COM/foo/"),
    "https://example.com/foo",
  );
  assert.equal(canonicalPageUrl("https://levainbakery.com/"), "https://levainbakery.com/");
});

test("pageUrlVariantsForLookup includes www and non-www", () => {
  const v = pageUrlVariantsForLookup("https://levainbakery.com/");
  assert.ok(v.some((x) => x.includes("www.levainbakery")));
  assert.ok(v.includes("https://levainbakery.com/"));
});

test("stripLeadingModelPreamble removes LLM chatter before first H1", () => {
  const raw =
    "Now I have gathered sufficient evidence. Let me compile the style.md based on evidence.\n\n---\n\n# Levain Bakery Style Guide\n\nBody";
  const out = stripLeadingModelPreamble(raw);
  assert.ok(out.startsWith("# Levain Bakery Style Guide"));
});
