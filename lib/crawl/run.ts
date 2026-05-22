import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { crawlChaldal } from "./chaldal";
import { crawlShwapno } from "./shwapno";
import type { CrawlSnapshot } from "./types";

const OUTPUT_PATH = "data/all-products.json";

async function main() {
  const startedAt = Date.now();
  console.log("Full crawl: Chaldal + Shwapno (parallel)\n");

  const [chaldal, shwapno] = await Promise.all([
    crawlChaldal((msg) => console.log(msg)).catch((err) => {
      console.error("Chaldal crawl FAILED:", err);
      return { products: [], categoriesCrawled: 0 };
    }),
    crawlShwapno((msg) => console.log(msg)).catch((err) => {
      console.error("Shwapno crawl FAILED:", err);
      return { products: [], categoriesCrawled: 0 };
    }),
  ]);

  const snapshot: CrawlSnapshot = {
    crawledAt: new Date().toISOString(),
    shops: {
      chaldal: { categoriesCrawled: chaldal.categoriesCrawled, productsFound: chaldal.products.length },
      shwapno: { categoriesCrawled: shwapno.categoriesCrawled, productsFound: shwapno.products.length },
    },
    products: [...chaldal.products, ...shwapno.products],
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), "utf8");

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nDone in ${elapsed}s — Chaldal ${chaldal.products.length} products in ${chaldal.categoriesCrawled} cats, Shwapno ${shwapno.products.length} products in ${shwapno.categoriesCrawled} cats. Total ${snapshot.products.length}. Wrote ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
