import { NextResponse } from "next/server";
import { loadCrawl } from "@/lib/loadCrawl";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.toLowerCase().trim() ?? "";
  const category = url.searchParams.get("category");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 1000);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  const data = await loadCrawl();
  if (!data) {
    return NextResponse.json({ error: "No crawl snapshot." }, { status: 404 });
  }

  let groups = data.groups;
  if (category) groups = groups.filter((g) => g.category.toLowerCase() === category.toLowerCase());
  if (q) {
    groups = groups.filter((g) => {
      if (g.brand?.toLowerCase().includes(q)) return true;
      for (const offers of Object.values(g.offers)) {
        for (const o of offers ?? []) {
          if (o.productName.toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }
  // Sort: groups with biggest absolute price gap first (most interesting to shoppers).
  groups = [...groups].sort((a, b) => {
    const aGap = priceGap(a);
    const bGap = priceGap(b);
    return bGap - aGap;
  });

  const total = groups.length;
  return NextResponse.json({
    total,
    offset,
    limit,
    crawledAt: data.snapshot.crawledAt,
    groups: groups.slice(offset, offset + limit),
  });
}

function priceGap(g: { offers: Record<string, unknown> }): number {
  const prices: number[] = [];
  for (const offers of Object.values((g as { offers: Record<string, { price: number | null }[]> }).offers)) {
    for (const o of offers ?? []) if (typeof o.price === "number") prices.push(o.price);
  }
  if (prices.length < 2) return 0;
  return Math.max(...prices) - Math.min(...prices);
}
