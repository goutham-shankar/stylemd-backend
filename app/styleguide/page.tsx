import { notFound, redirect } from "next/navigation";
import { getLatestStyleMdShowcaseRunSummary } from "@/lib/stylemd-artifacts/runManager";

export const dynamic = "force-dynamic";

export default async function LatestStyleguidePage() {
  const summary = await getLatestStyleMdShowcaseRunSummary();
  if (!summary || !summary.showcase.available) {
    notFound();
  }
  redirect(summary.showcase.canonicalUrl);
}
