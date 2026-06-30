import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { crawlChaldal } from "./chaldal";
import { crawlShwapno } from "./shwapno";
import { crawlPandamartWayback } from "./pandamart-wayback";
import { crawlPandamartLive } from "./pandamart-live";
import type { CrawlSnapshot } from "./types";

const OUTPUT_PATH = "data/all-products.json";

// PANDAMART_MODE: "live" (default, GraphQL — needs a residential IP),
// "wayback" (Internet Archive, stale prices), or "off".
// Live is tried first and falls back to Wayback on failure / zero results.
async function crawlPandamart(
  onProgress: (msg: string) => void,
): Promise<{ products: import("./types").RawProduct[]; categoriesCrawled: number }> {
  const mode = process.env.PANDAMART_MODE ?? "live";
  if (mode === "off") return { products: [], categoriesCrawled: 0 };
  if (mode !== "wayback") {
    try {
      const live = await crawlPandamartLive(onProgress);
      if (live.products.length > 0) return live;
      onProgress("Pandamart live returned 0 products — falling back to Wayback");
    } catch (err) {
      onProgress(
        `Pandamart live failed (${err instanceof Error ? err.message : String(err)}) — falling back to Wayback`,
      );
    }
  }
  return crawlPandamartWayback(onProgress);
}

async function main() {
  const startedAt = Date.now();
  console.log("Full crawl: Chaldal + Shwapno + Pandamart (parallel)\n");

  const [chaldal, shwapno, pandamart] = await Promise.all([
    crawlChaldal((msg) => console.log(msg)).catch((err) => {
      console.error("Chaldal crawl FAILED:", err);
      return { products: [], categoriesCrawled: 0 };
    }),
    crawlShwapno((msg) => console.log(msg)).catch((err) => {
      console.error("Shwapno crawl FAILED:", err);
      return { products: [], categoriesCrawled: 0 };
    }),
    crawlPandamart((msg) => console.log(msg)).catch((err) => {
      console.error("Pandamart crawl FAILED:", err);
      return { products: [], categoriesCrawled: 0 };
    }),
  ]);

  const snapshot: CrawlSnapshot = {
    crawledAt: new Date().toISOString(),
    shops: {
      chaldal: { categoriesCrawled: chaldal.categoriesCrawled, productsFound: chaldal.products.length },
      shwapno: { categoriesCrawled: shwapno.categoriesCrawled, productsFound: shwapno.products.length },
      pandamart: { categoriesCrawled: pandamart.categoriesCrawled, productsFound: pandamart.products.length },
    },
    products: [...chaldal.products, ...shwapno.products, ...pandamart.products],
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), "utf8");

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nDone in ${elapsed}s — Chaldal ${chaldal.products.length} / Shwapno ${shwapno.products.length} / Pandamart ${pandamart.products.length}. Total ${snapshot.products.length}. Wrote ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
