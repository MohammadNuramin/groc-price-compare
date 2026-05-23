import type { RawProduct } from "./types";
import { extractBrand, extractSizeFromName, inferCategoryFromName } from "./extract";

// Foodpanda (Pandamart's parent) is blocked by PerimeterX from every IP
// we have access to. The Internet Archive's Wayback Machine has archived
// snapshots of Pandamart product pages and darkstore listings that contain
// the full product JSON embedded as `window.__PRELOADED_STATE__`. We pull the
// latest snapshot for each archived URL, regex-extract the product entries,
// and dedupe globally.
//
// Caveat: prices are as of the snapshot date (can be days to months stale).

const CDX_BASE = "https://web.archive.org/cdx/search/cdx";
const WB = "https://web.archive.org/web";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// Match the product JSON objects that ship inside __PRELOADED_STATE__. They
// have a stable shape: `{"description":"...", "globalCatalogId":"...uuid...",
// "id":"...", ..., "isAvailable":true|false, "name":"...", ..., "price":N, ...}`.
// The fields appear in a consistent order; minor variance allowed.
const PRODUCT_RE =
  /\{"description":"[^"]{0,400}","globalCatalogId":"([a-f0-9-]{20,})","id":"([0-9]+)","imageUrl":"([^"]{0,400})"[^}]*?"isAvailable":(true|false),"name":"([^"]{1,200})"[^}]*?"originalPrice":([0-9.]+),"parentId":"[^"]*","price":([0-9.]+)[^}]*?"attributes":\{"baseContentValue":([0-9.]+),"baseUnit":"([a-z]*)"/g;

interface ProductMatch {
  globalCatalogId: string;
  id: string;
  imageUrl: string;
  isAvailable: boolean;
  name: string;
  originalPrice: number;
  price: number;
  baseContentValue: number;
  baseUnit: string;
}

function decodeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function unwrapWaybackImage(url: string): string {
  // Wayback rewrites image URLs to /web/<timestamp>im_/<original>. Strip back.
  const m = url.match(/web\.archive\.org\/web\/[^/]+\/(https?:\/\/.+)$/);
  return m ? decodeUnicode(m[1]) : decodeUnicode(url);
}

// baseContentValue/baseUnit in the Pandamart JSON is the per-unit base for
// price normalization (e.g. "1 l" for an oil bottle even if the actual pack
// is 5L). The real pack size lives in the product name — extract it there.
function packSize(name: string): string | null {
  return extractSizeFromName(name);
}

function extractProducts(html: string): ProductMatch[] {
  const out: ProductMatch[] = [];
  PRODUCT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRODUCT_RE.exec(html)) !== null) {
    out.push({
      globalCatalogId: m[1],
      id: m[2],
      imageUrl: m[3],
      isAvailable: m[4] === "true",
      name: decodeUnicode(m[5]),
      originalPrice: parseFloat(m[6]),
      price: parseFloat(m[7]),
      baseContentValue: parseFloat(m[8]),
      baseUnit: m[9],
    });
  }
  return out;
}

interface CdxRow {
  urlkey: string;
  timestamp: string;
  original: string;
}

async function cdxList(urlPattern: string): Promise<CdxRow[]> {
  const url = `${CDX_BASE}?url=${encodeURIComponent(urlPattern)}&output=json&filter=statuscode:200&collapse=urlkey&fl=urlkey,timestamp,original`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Wayback CDX HTTP ${res.status}`);
  const data = (await res.json()) as string[][];
  if (data.length <= 1) return [];
  // data[0] is the header row
  return data.slice(1).map(([urlkey, timestamp, original]) => ({
    urlkey,
    timestamp,
    original,
  }));
}

async function fetchSnapshot(timestamp: string, original: string): Promise<string> {
  const u = `${WB}/${timestamp}/${original}`;
  const res = await fetch(u, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Wayback fetch HTTP ${res.status} for ${u}`);
  return await res.text();
}

function toRawProduct(p: ProductMatch): RawProduct | null {
  if (!p.name) return null;
  const size = packSize(p.name);
  const category = inferCategoryFromName(p.name) ?? "Uncategorized";
  return {
    shop: "pandamart",
    shopProductId: p.id,
    productName: p.name,
    brand: extractBrand(p.name),
    packSize: size,
    category,
    price: p.price > 0 ? p.price : null,
    originalPrice: p.originalPrice > 0 ? p.originalPrice : null,
    available: p.isAvailable,
    url: `https://www.foodpanda.com.bd/groceries/product/${p.id}`,
    imageUrl: unwrapWaybackImage(p.imageUrl),
  };
}

export async function crawlPandamartWayback(
  onProgress?: (msg: string) => void,
): Promise<{ products: RawProduct[]; categoriesCrawled: number }> {
  onProgress?.("Pandamart (Wayback) — enumerating archived URLs …");

  const [darkstoreUrls, productUrls] = await Promise.all([
    cdxList("foodpanda.com.bd/darkstore/*"),
    cdxList("foodpanda.com.bd/groceries/product/*"),
  ]);
  onProgress?.(
    `  ${darkstoreUrls.length} darkstore + ${productUrls.length} groceries archived URLs`,
  );

  // Keep latest snapshot per urlkey
  const latest = new Map<string, CdxRow>();
  for (const row of [...darkstoreUrls, ...productUrls]) {
    const existing = latest.get(row.urlkey);
    if (!existing || row.timestamp > existing.timestamp) latest.set(row.urlkey, row);
  }
  const urls = Array.from(latest.values());
  onProgress?.(`  ${urls.length} unique archived URLs to fetch`);

  // Fetch concurrently (small concurrency to be polite to Wayback)
  const seen = new Map<string, RawProduct>();
  const CONCURRENCY = 4;
  const queue = [...urls];
  let done = 0;
  let totalProductsSeen = 0;
  async function worker() {
    while (queue.length > 0) {
      const u = queue.shift();
      if (!u) return;
      try {
        const html = await fetchSnapshot(u.timestamp, u.original);
        const products = extractProducts(html);
        totalProductsSeen += products.length;
        for (const p of products) {
          const key = `pandamart:${p.id}`;
          if (!seen.has(key)) {
            const rp = toRawProduct(p);
            if (rp) seen.set(key, rp);
          }
        }
      } catch (err) {
        onProgress?.(
          `  ! ${u.urlkey} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      done++;
      if (done % 10 === 0 || done === urls.length) {
        onProgress?.(
          `  · ${done}/${urls.length} URLs fetched, ${seen.size} unique products so far`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const products = Array.from(seen.values());
  const categoriesCrawled = new Set(products.map((p) => p.category)).size;
  onProgress?.(
    `Pandamart (Wayback) done — ${products.length} unique products from ${urls.length} archived pages (${totalProductsSeen} product instances seen)`,
  );
  return { products, categoriesCrawled };
}
