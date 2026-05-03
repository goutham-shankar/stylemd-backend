
/**
 * Canonical page URL + lookup variants so `https://a.com/` and `https://www.a.com` resolve to the same row.
 * Strips all query parameters and hash fragments for strict deduplication.
 */

export function canonicalPageUrl(raw: string): string {
  const trimmed = raw.trim();
  const u = new URL(trimmed);
  const proto = u.protocol.toLowerCase();
  let hostname = u.hostname.toLowerCase();
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  let pathname = u.pathname || "/";
  if (pathname !== "/" && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  
  // STRIP all query params and hash fragments
  return `${proto}//${hostname}${pathname === "/" ? "/" : pathname}`;
}

/** Alias strings commonly stored alongside the canonical URL in Mongo unique indexes. */
export function pageUrlVariantsForLookup(raw: string): string[] {
  const trimmed = raw.trim();
  const out = new Set<string>([trimmed]);
  try {
    const canon = canonicalPageUrl(trimmed);
    out.add(canon);
    const u = new URL(canon);
    const path = u.pathname === "/" ? "/" : u.pathname;
    const nonWww = `${u.protocol}//${u.hostname}${path}`;
    out.add(nonWww);
    out.add(`${u.protocol}//www.${u.hostname}${path}`);
  } catch {
    /* keep trimmed only */
  }
  return [...out];
}
