import { NextResponse } from "next/server";
import { loadCrawl } from "@/lib/loadCrawl";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const shop = url.searchParams.get("shop"); // chaldal | shwapno | (null = all)
  const category = url.searchParams.get("category");
  const q = url.searchParams.get("q")?.toLowerCase().trim() ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 1000);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  const data = await loadCrawl();
  if (!data) {
    return NextResponse.json(
      { error: "No crawl snapshot. Run: docker compose run --rm web npm run crawl" },
      { status: 404 },
    );
  }

  let filtered = data.snapshot.products;
  if (shop) filtered = filtered.filter((p) => p.shop === shop);
  if (category) filtered = filtered.filter((p) => p.category === category);
  if (q) {
    filtered = filtered.filter(
      (p) =>
        p.productName.toLowerCase().includes(q) ||
        (p.brand?.toLowerCase().includes(q) ?? false),
    );
  }

  const total = filtered.length;
  const slice = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    total,
    offset,
    limit,
    crawledAt: data.snapshot.crawledAt,
    shops: data.snapshot.shops,
    products: slice,
  });
}
