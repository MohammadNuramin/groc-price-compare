import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { catalog } from "../catalog";
import type {
  CatalogItem,
  ComparisonRow,
  MatchType,
  PriceSnapshot,
  ScrapedOffer,
  Shop,
} from "../types";
import { searchChaldalCandidates } from "./chaldal";
import { searchShwapnoCandidates } from "./shwapno";
import { prefetchPandamart, searchPandamart } from "./pandamart";
import { pickBestMatch } from "./match";

const OUTPUT_PATH = "data/prices.json";
const PANDAMART_MANUAL_PATH = "data/pandamart-manual.json";

async function loadManualOverrides(): Promise<Record<string, ScrapedOffer>> {
  try {
    const raw = await readFile(PANDAMART_MANUAL_PATH, "utf8");
    const data = JSON.parse(raw) as Record<string, Partial<Omit<ScrapedOffer, "shop">>>;
    const out: Record<string, ScrapedOffer> = {};
    for (const [id, offer] of Object.entries(data)) {
      if (id.startsWith("_")) continue;
      out[id] = {
        shop: "pandamart",
        productName: offer.productName ?? "",
        brand: offer.brand ?? null,
        packSize: offer.packSize ?? null,
        price: offer.price ?? null,
        originalPrice: offer.originalPrice ?? null,
        available: offer.available ?? true,
        url: offer.url ?? null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function computeMatchType(offers: ComparisonRow["offers"]): MatchType {
  const present = Object.values(offers).filter((o): o is ScrapedOffer => Boolean(o));
  if (present.length < 2) return "single";
  const brands = present
    .map((o) => (o.brand ?? "").trim().toLowerCase())
    .filter((b) => b.length > 0);
  // If any offer lacks a brand, we can't claim apples-to-apples.
  if (brands.length < present.length) return "category";
  const first = brands[0];
  return brands.every((b) => b === first) ? "sku" : "category";
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

type CandidateFetcher = (q: string, n: number) => Promise<ScrapedOffer[]>;
const candidateFetchers: Record<"chaldal" | "shwapno", CandidateFetcher> = {
  chaldal: searchChaldalCandidates,
  shwapno: searchShwapnoCandidates,
};

async function resolveOffer(
  shop: "chaldal" | "shwapno",
  item: CatalogItem,
): Promise<{ offer: ScrapedOffer | null; debug?: string; error?: string }> {
  try {
    const candidates = await withTimeout(
      candidateFetchers[shop](item.queries[shop], 15),
      20_000,
      `${shop} candidates "${item.queries[shop]}"`,
    );
    if (candidates.length === 0) return { offer: null, debug: "0 candidates" };
    const picked = await withTimeout(
      pickBestMatch(item, candidates),
      30_000,
      `LLM match ${shop} ${item.id}`,
    );
    return {
      offer: picked,
      debug: picked
        ? `${candidates.length} candidates → "${picked.productName}"`
        : `${candidates.length} candidates → none matched`,
    };
  } catch (err) {
    return { offer: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function resolvePandamart(
  item: CatalogItem,
): Promise<{ offer: ScrapedOffer | null; error?: string }> {
  try {
    const offer = await withTimeout(
      searchPandamart(item.queries.pandamart),
      20_000,
      `pandamart "${item.queries.pandamart}"`,
    );
    return { offer };
  } catch (err) {
    return { offer: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const startedAt = Date.now();
  const rows: ComparisonRow[] = [];
  const errors: PriceSnapshot["errors"] = [];

  const manualOverrides = await loadManualOverrides();
  const manualCount = Object.keys(manualOverrides).length;
  if (manualCount > 0) {
    console.log(`Loaded ${manualCount} manual Pandamart overrides`);
  }

  let pandamartReady = false;
  if (process.env.SKIP_PANDAMART !== "1") {
    process.stdout.write("Warming Pandamart catalog ... ");
    try {
      const { count } = await withTimeout(prefetchPandamart(), 180_000, "prefetchPandamart");
      console.log(`OK (${count} products)`);
      pandamartReady = true;
    } catch (err) {
      console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
      errors.push({
        shop: "pandamart",
        message: `prefetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    console.log("Pandamart skipped (SKIP_PANDAMART=1)");
  }

  const CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? "6");

  async function processItem(item: CatalogItem): Promise<ComparisonRow> {
    const offers: ComparisonRow["offers"] = {};

    const tasks: Promise<{ shop: Shop; offer: ScrapedOffer | null; debug?: string; error?: string }>[] = [
      resolveOffer("chaldal", item).then((r) => ({ shop: "chaldal" as const, ...r })),
      resolveOffer("shwapno", item).then((r) => ({ shop: "shwapno" as const, ...r })),
    ];
    if (pandamartReady) {
      tasks.push(resolvePandamart(item).then((r) => ({ shop: "pandamart" as const, ...r })));
    }
    const results = await Promise.all(tasks);

    for (const { shop, offer, error } of results) {
      if (offer) offers[shop] = offer;
      if (error && !(shop === "pandamart" && manualOverrides[item.id])) {
        errors.push({ shop, message: `[${item.id}] ${error}` });
      }
    }

    if (!offers.pandamart && manualOverrides[item.id]) {
      offers.pandamart = manualOverrides[item.id];
    }

    const found = Object.keys(offers).length;
    const dbg = results
      .filter((r) => r.debug)
      .map((r) => `${r.shop}: ${r.debug}`)
      .join(" | ");
    console.log(`• ${item.displayName} ${found}/3 ${dbg ? `[${dbg}]` : ""}`);

    return {
      catalogId: item.id,
      displayName: item.displayName,
      category: item.category,
      matchType: computeMatchType(offers),
      offers,
    };
  }

  // Parallel pool: process CONCURRENCY items at a time, in catalog order.
  const queue = [...catalog];
  const collected: ComparisonRow[] = new Array(catalog.length);
  const indexByItem = new Map(catalog.map((c, i) => [c.id, i]));
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      const row = await processItem(item);
      collected[indexByItem.get(item.id)!] = row;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  rows.push(...collected);

  const snapshot: PriceSnapshot = { scrapedAt: new Date().toISOString(), rows, errors };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), "utf8");

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const filled = rows.reduce((acc, r) => acc + Object.keys(r.offers).length, 0);
  console.log(
    `\nDone in ${elapsed}s — ${filled}/${rows.length * 3} cells filled, ${errors.length} errors`,
  );
  if (errors.length > 0) {
    console.log("\nFirst errors:");
    for (const e of errors.slice(0, 10)) console.log(`  [${e.shop}] ${e.message}`);
  }
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
