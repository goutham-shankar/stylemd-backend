import type { StyleMdProvider } from "@/lib/stylemd-artifacts/types";

export type ScrapeJobData = {
  url: string;
  provider: StyleMdProvider;
  /**
   * When true, the worker also uploads `raw.html` under
   * `websites/{slug}/debug/raw.html`. Off by default to keep R2 lean.
   */
  debugMode?: boolean;
  /** Firebase UID of the user who triggered this scrape. */
  userId?: string;
  userEmail?: string;
};

/** R2 keys (not URLs) — resolve via r2PublicUrl() at read time. */
export type R2Keys = {
  slug: string;
  previewHtml: string | null;
  designMd: string | null;
  screenshot: string | null;
  semanticStructure: string | null;
  designTokens: string | null;
  assets: Record<string, string | null>;
};

export type ScrapeJobResult = {
  runId: string;
  r2: R2Keys;
};

export const SCRAPE_QUEUE = "scrape";
