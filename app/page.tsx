import Link from "next/link";
import { loadCrawl } from "@/lib/loadCrawl";
import { BrowseView } from "./BrowseView";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await loadCrawl();

  if (!data) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">BD Grocery Price Compare</h1>
        <div className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900">
          <p className="font-medium">No crawl snapshot yet.</p>
          <p className="mt-2 text-sm">Run the crawler to generate one:</p>
          <pre className="mt-3 rounded bg-amber-100 px-3 py-2 font-mono text-xs">
            docker compose run --rm web npm run crawl
          </pre>
        </div>
      </main>
    );
  }

  const { snapshot, groups } = data;
  const crawledAt = new Date(snapshot.crawledAt);
  const categories = Array.from(new Set(snapshot.products.map((p) => p.category))).sort();
  const totalChaldal = snapshot.shops.chaldal?.productsFound ?? 0;
  const totalShwapno = snapshot.shops.shwapno?.productsFound ?? 0;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">BD Grocery Price Compare</h1>
          <p className="mt-1 text-sm text-neutral-600">
            <span className="inline-block rounded bg-chaldal px-1.5 py-0.5 text-xs font-medium text-white">
              Chaldal
            </span>{" "}
            <span className="font-medium">{totalChaldal.toLocaleString()}</span> products ·{" "}
            <span className="inline-block rounded bg-shwapno px-1.5 py-0.5 text-xs font-medium text-white">
              Shwapno
            </span>{" "}
            <span className="font-medium">{totalShwapno.toLocaleString()}</span> products ·{" "}
            <span className="font-medium">{groups.length.toLocaleString()}</span> cross-shop matches
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Last crawled <time dateTime={snapshot.crawledAt}>{crawledAt.toLocaleString()}</time>
          </p>
        </div>
      </header>

      <BrowseView categories={categories} initialMatchCount={groups.length} />

      <footer className="mt-12 text-xs text-neutral-500">
        <p>
          Brand and pack size extracted heuristically from product names. Cross-shop matches require
          same brand + same normalized pack size + same category. Differing-brand prices are listed
          separately (no winner badge — not apples-to-apples).
        </p>
        <p className="mt-2 flex gap-3">
          <Link href="/api/products?limit=20" className="underline">
            Raw products JSON
          </Link>
          <Link href="/api/matches?limit=20" className="underline">
            Raw matches JSON
          </Link>
        </p>
      </footer>
    </main>
  );
}
