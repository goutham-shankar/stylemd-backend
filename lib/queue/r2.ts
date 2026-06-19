import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

// ───────────────────────────────────────────────────────────────────────────
// Version constants — bumped when pipeline output, worker code, or storage
// schema changes meaningfully. Persisted into Mongo per-run for observability.
// ───────────────────────────────────────────────────────────────────────────
export const PIPELINE_VERSION = "1.0.0";
export const WORKER_VERSION = "1.0.0";
export const STORAGE_VERSION = "v2.1";

// ───────────────────────────────────────────────────────────────────────────
// R2 layout — stable structure, slug-keyed, re-scrapes overwrite.
//
//   designprobe/
//     └── websites/
//          └── {slug}/
//                ├── manifest.json            ← self-describing index (v2.1+)
//                ├── preview.html
//                ├── design.md
//                ├── screenshot.jpg
//                ├── semantic_structure.json
//                ├── design_tokens.json
//                ├── assets/
//                │     ├── logo.svg
//                │     ├── favicon.ico
//                │     └── og-image.jpg
//                └── debug/                   ← only present when debugMode=true
//                      └── raw.html
//
// Note: raw.html is NOT a default artifact in v2.1+. It only gets uploaded
// when the caller passes `debugMode: true` in the scrape request payload.
// ───────────────────────────────────────────────────────────────────────────

export const R2_ARTIFACT_NAMES = {
  manifest: "manifest.json",
  previewHtml: "preview.html",
  designMd: "design.md",
  screenshot: "screenshot.jpg",
  semanticStructure: "semantic_structure.json",
  designTokens: "design_tokens.json",
} as const;

export type R2ArtifactName = keyof typeof R2_ARTIFACT_NAMES;

/** Debug-only artifact paths (only uploaded when debugMode=true). */
export const R2_DEBUG_ARTIFACT_NAMES = {
  rawHtml: "debug/raw.html",
} as const;
export type R2DebugArtifactName = keyof typeof R2_DEBUG_ARTIFACT_NAMES;

/** Build an R2 key under the `websites/{slug}/` namespace. */
export function r2KeyFor(slug: string, artifact: R2ArtifactName | string): string {
  // If `artifact` is one of the named artifacts, look up the filename. Otherwise
  // treat it as a literal sub-path (e.g. "assets/logo.png" or "debug/raw.html").
  const sub =
    (R2_ARTIFACT_NAMES as Record<string, string>)[artifact] ??
    (R2_DEBUG_ARTIFACT_NAMES as Record<string, string>)[artifact] ??
    artifact;
  return `websites/${slug}/${sub}`;
}

// ───────────────────────────────────────────────────────────────────────────
// manifest.json — self-describing index of every artifact in a snapshot.
//
// Stored at `websites/{slug}/manifest.json`. Always present — the manifest
// path is derivable from {slug}, so we never store its URL in Mongo.
//
// Consumers (frontend, downstream tools) fetch this single file to learn
// what's available without hitting Mongo or guessing filenames.
// ───────────────────────────────────────────────────────────────────────────

export type Manifest = {
  domain: string;
  slug: string;
  generatedAt: string;
  pipelineVersion: string;
  workerVersion: string;
  storageVersion: string;
  artifacts: {
    previewHtml: string;
    designMd: string;
    screenshot: string | null;
    designTokens: string | null;
    semanticStructure: string | null;
  };
  assets: {
    logo: string | null;
    favicon: string | null;
    appleIcon: string | null;
    ogImage: string | null;
  };
  debug?: {
    rawHtml?: string;
  };
};

/** Filenames are relative to `websites/{slug}/` — they're stable per layout. */
export function buildManifest(input: {
  domain: string;
  slug: string;
  generatedAt?: Date;
  has: {
    screenshot: boolean;
    designTokens: boolean;
    semanticStructure: boolean;
    logo?: boolean;
    favicon?: boolean;
    appleIcon?: boolean;
    ogImage?: boolean;
    rawHtml?: boolean;
  };
}): Manifest {
  const m: Manifest = {
    domain: input.domain,
    slug: input.slug,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    pipelineVersion: PIPELINE_VERSION,
    workerVersion: WORKER_VERSION,
    storageVersion: STORAGE_VERSION,
    artifacts: {
      previewHtml: R2_ARTIFACT_NAMES.previewHtml,
      designMd: R2_ARTIFACT_NAMES.designMd,
      screenshot: input.has.screenshot ? R2_ARTIFACT_NAMES.screenshot : null,
      designTokens: input.has.designTokens ? R2_ARTIFACT_NAMES.designTokens : null,
      semanticStructure: input.has.semanticStructure ? R2_ARTIFACT_NAMES.semanticStructure : null,
    },
    assets: {
      logo: input.has.logo ? "assets/logo.svg" : null,
      favicon: input.has.favicon ? "assets/favicon.ico" : null,
      appleIcon: input.has.appleIcon ? "assets/apple-icon.png" : null,
      ogImage: input.has.ogImage ? "assets/og-image.jpg" : null,
    },
  };
  if (input.has.rawHtml) {
    m.debug = { rawHtml: R2_DEBUG_ARTIFACT_NAMES.rawHtml };
  }
  return m;
}

let _r2BaseWarned = false;

/** Resolve an R2 key to a public URL via R2_PUBLIC_BASE. Pass through absolute URLs. */
export function r2PublicUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.startsWith("https://") || key.startsWith("http://")) return key;
  const base = process.env.R2_PUBLIC_BASE;
  if (!base) {
    if (!_r2BaseWarned) {
      console.warn("[r2] R2_PUBLIC_BASE is not set — asset URLs will resolve to null. Set it to your R2 public bucket URL.");
      _r2BaseWarned = true;
    }
    return null;
  }
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

// ───────────────────────────────────────────────────────────────────────────
// S3 client — lazy, env-driven
// ───────────────────────────────────────────────────────────────────────────

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} environment variable is required for R2 uploads`);
  return v;
}

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: "auto",
    endpoint: envOrThrow("R2_ENDPOINT"),
    credentials: {
      accessKeyId: envOrThrow("R2_KEY"),
      secretAccessKey: envOrThrow("R2_SECRET"),
    },
  });
  return _s3;
}

/**
 * Upload to R2. Returns the *key* (not URL) — callers persist keys in Mongo
 * and resolve to URLs at read time via r2PublicUrl().
 */
export async function uploadR2(
  key: string,
  body: string | Buffer,
  contentType: string,
): Promise<string> {
  const bucket = envOrThrow("R2_BUCKET");
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await s3().send(cmd);
      return key;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

/** Delete an object from R2 (used by migration cleanup, not the worker). */
export async function deleteR2(key: string): Promise<void> {
  const bucket = envOrThrow("R2_BUCKET");
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Fetch an object's body as text. Used on the cache-hit path to return the
 * design.md content that v2 storage keeps in R2 (not Mongo). Returns null on
 * any failure so callers can degrade gracefully rather than throw.
 */
export async function fetchR2Text(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  // External URL (e.g. volt reference) — fetch directly
  if (key.startsWith("https://") || key.startsWith("http://")) {
    try {
      const resp = await fetch(key, { signal: AbortSignal.timeout(15_000) });
      return resp.ok ? await resp.text() : null;
    } catch {
      return null;
    }
  }
  try {
    const bucket = envOrThrow("R2_BUCKET");
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = out.Body as { transformToString?: () => Promise<string> } | undefined;
    if (body?.transformToString) return await body.transformToString();
    return null;
  } catch {
    return null;
  }
}
