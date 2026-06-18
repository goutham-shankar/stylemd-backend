import { libraryResolver } from "./libraryResolver";
import { voltResolver } from "./voltResolver";
import { scrapeResolver } from "./scrapeResolver";
import type { ResolverContext, ResolveResult } from "./types";

// Waterfall order: Volt (getdesign.md) → Library (curated) → Scrape (live)
const RESOLVERS = [voltResolver, libraryResolver, scrapeResolver];

export async function resolveDesign(ctx: ResolverContext): Promise<ResolveResult> {
  for (const resolver of RESOLVERS) {
    let can = false;
    try {
      can = await resolver.canResolve(ctx);
      console.log(`[resolver] ${resolver.name}.canResolve(${ctx.url}) → ${can}`);
    } catch (err) {
      console.error(`[resolver] ${resolver.name}.canResolve THREW for ${ctx.url}:`, err);
    }
    if (can) {
      console.log(`[resolver] ${resolver.name} selected for ${ctx.url}`);
      return resolver.resolve(ctx);
    }
  }
  // scrapeResolver.canResolve always returns true — this is unreachable
  throw new Error(`No resolver found for ${ctx.url}`);
}

export type { ResolverContext, ResolveResult, ResolveSource } from "./types";
