export interface NormalizableData {
  url: string; 
  title?: string | null; 
  description?: string | null; 
  h1?: string | null; 
  canonical?: string | null; 
  images?: unknown[]; 
  contentText?: string | null; 
  rawHtml?: string | null;
  screenshotBase64?: string | null;
  brandAssets?: {
    logo?: string | null;
    favicon?: string | null;
    appleIcon?: string | null;
    ogImage?: string | null;
  } | null;
}

export interface NormalizedData {
  url: string;
  title: string | null;
  description: string | null;
  h1: string | null;
  canonical: string | null;
  images: string[];
  contentText: string | null;
  screenshotBase64: string | null;
  brandAssets: {
    logo: string | null;
    favicon: string | null;
    appleIcon: string | null;
    ogImage: string | null;
  };
}

export function normalize(obj: NormalizableData): NormalizedData {
  return {
    url: obj.url, 
    title: obj.title ? String(obj.title).trim() : null, 
    description: obj.description ? String(obj.description).trim() : null,
    h1: obj.h1 ? String(obj.h1).trim() : null, 
    canonical: obj.canonical ? String(obj.canonical).trim() : null,
    images: Array.isArray(obj.images) ? obj.images.map(String) : [], 
    contentText: obj.contentText ? String(obj.contentText).trim() : null,
    screenshotBase64: obj.screenshotBase64 ? String(obj.screenshotBase64) : null,
    brandAssets: {
      logo: obj.brandAssets?.logo ?? null,
      favicon: obj.brandAssets?.favicon ?? null,
      appleIcon: obj.brandAssets?.appleIcon ?? null,
      ogImage: obj.brandAssets?.ogImage ?? null,
    },
  };
}
