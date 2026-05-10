/**
 * Remove typical LLM preambles before the real style guide (user-facing markdown).
 */

const PREAMBLE_PATTERNS: RegExp[] = [
  /^Now I have gathered sufficient evidence\.[\s\S]*?(?=^#\s)/m,
  /^Based on (?:the |my )?(?:analysis|review|gathered evidence)[^.]*\.[\s\S]*?(?=^#\s)/m,
  /^I'll compile (?:the |a )?style\.md[^.]*\.[\s\S]*?(?=^#\s)/m,
];

/** Strip chatter before first markdown H1 heading when detectable; otherwise unchanged. */
export function stripLeadingModelPreamble(markdown: string): string {
  const t = markdown.trimStart();
  for (const re of PREAMBLE_PATTERNS) {
    const next = t.replace(re, "");
    if (next !== t && next.trimStart().startsWith("#")) {
      return next.trimStart();
    }
  }
  return t;
}
