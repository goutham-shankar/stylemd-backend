import type { R2Doc } from "@/backend/src/services/finalizeStyleMdRun";
import type { StyleMdProvider } from "@/lib/stylemd-artifacts/types";

export type ResolveSource = "library" | "volt" | "scrape";

export interface ResolverContext {
  url: string;
  slug: string;
  jobId: string;
  provider: StyleMdProvider;
  userId?: string;
  userEmail?: string;
  debugMode?: boolean;
}

export interface ResolveResult {
  runId: string;
  source: ResolveSource;
  r2: R2Doc;
}

export interface DesignResolver {
  readonly name: ResolveSource;
  canResolve(ctx: ResolverContext): Promise<boolean>;
  resolve(ctx: ResolverContext): Promise<ResolveResult>;
}
