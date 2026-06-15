import type { StyleMdProvider } from "@/lib/stylemd-artifacts/types";

export type ScrapeJobData = {
  url: string;
  provider: StyleMdProvider;
};

export type ScrapeJobResult = {
  runId: string;
  r2: {
    previewHtml: string;
    designMd: string;
    screenshot?: string;
  };
};

export const SCRAPE_QUEUE = "scrape";
