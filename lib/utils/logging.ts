export function summarizeForLog(value: unknown, max = 160): string {
  if (value === null || value === undefined) {
    return "none";
  }
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.length <= max ? raw : `${raw.slice(0, max)}...`;
}
