import { DesignLibrary } from "@/backend/src/models/DesignLibrary";
import { uploadR2, r2KeyFor } from "@/lib/queue/r2";
import { safeWrite } from "@/lib/mongodb";
import { StyleMdRun } from "@/backend/src/models/StyleMdRun";
import { pageUrlVariantsForLookup } from "@/lib/services/pageUrlCanonical";
import type { DesignResolver, ResolverContext, ResolveResult } from "./types";

async function findLibraryEntry(url: string) {
  const variants = pageUrlVariantsForLookup(url);
  return DesignLibrary.findOne({ url: { $in: variants }, active: true }).lean();
}

export const libraryResolver: DesignResolver = {
  name: "library",

  async canResolve(ctx) {
    const entry = await findLibraryEntry(ctx.url);
    if (entry) (ctx as any)._libraryEntry = entry;
    return Boolean(entry);
  },

  async resolve(ctx) {
    const entry = ((ctx as any)._libraryEntry ?? await findLibraryEntry(ctx.url)) as any;
    if (!entry) throw new Error(`No library entry for ${ctx.url}`);

    const runId = ctx.jobId;
    const now = new Date();

    const designMdKey = await uploadR2(
      r2KeyFor(ctx.slug, "designMd"),
      entry.designMd as string,
      "text/markdown; charset=utf-8",
    );

    const r2Doc = {
      slug: ctx.slug,
      previewHtml: null,
      designMd: designMdKey,
      screenshot: null,
      semanticStructure: null,
      designTokens: null,
      assets: {} as Record<string, never>,
    };

    await safeWrite(() =>
      StyleMdRun.updateOne(
        { runId },
        {
          $set: {
            runId,
            url: ctx.url,
            slug: ctx.slug,
            status: "completed",
            source: "library",
            r2: r2Doc,
            durationMs: 0,
            updatedAt: now,
            lastScrapedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      ),
    );

    return { runId, source: "library", r2: r2Doc };
  },
};
