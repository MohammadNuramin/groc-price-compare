import type { RawProduct } from "./types";
import { extractBrand, extractSizeFromName, inferCategoryFromName } from "./extract";

const ENDPOINT = "https://catalog.chaldal.com/searchOld";
const API_KEY = "e964fc2d51064efa97e94db7c64bf3d044279d4ed0ad4bdd9dce89fecc9156f0";
const PAGE_SIZE = 250;

// Chaldal category IDs discovered via probe. Names are display labels.
// You can add more by viewing chaldal.com and watching XHR requests.
export const CHALDAL_CATEGORIES: { id: number; name: string }[] = [
  { id: 80, name: "Rice" },
  { id: 108, name: "Oil" },
  { id: 109, name: "Ghee" },
  { id: 198, name: "Lentils & Pulses" },
  { id: 111, name: "Salt & Sugar" },
  { id: 107, name: "Spices" },
  { id: 103, name: "Flour" },
  { id: 61, name: "Eggs" },
  { id: 1580, name: "Powder Milk" },
  { id: 12, name: "Fresh Vegetables" },
  { id: 1696, name: "Meat" },
  { id: 1235, name: "Frozen Fish" },
  { id: 1238, name: "Dried Fish" },
  { id: 18, name: "Tea" },
  { id: 1597, name: "Tea & Coffee" },
  // Common additional categories worth including for a "full" crawl. If any
  // of these don't exist on Chaldal the API just returns 0 hits — safe.
  { id: 13, name: "Fresh Fruits" },
  { id: 14, name: "Cooking & Baking" },
  { id: 15, name: "Snacks" },
  { id: 16, name: "Breakfast" },
  { id: 17, name: "Beverages" },
  { id: 25, name: "Personal Care" },
  { id: 27, name: "Cleaning & Household" },
];

interface ChaldalHit {
  name?: string;
  subText?: string;
  price?: number;
  mrp?: number;
  isAvailable?: boolean;
  slug?: string;
  objectID?: string;
  picturesUrls?: string[];
}

interface ChaldalSearchResponse {
  hits?: ChaldalHit[];
  nbHits?: number;
  nbPages?: number;
}

async function fetchPage(
  page: number,
  categoryId: number | null,
): Promise<ChaldalSearchResponse> {
  const body = {
    apiKey: API_KEY,
    storeId: 1,
    warehouseId: 8,
    pageSize: PAGE_SIZE,
    currentPageIndex: page,
    metropolitanAreaId: 1,
    query: "",
    productVariantId: -1,
    bundleId: { case: "None" },
    canSeeOutOfStock: "true",
    filters: categoryId === null ? [] : [`categories=${categoryId}`],
    maxOutOfStockCount: { case: "Some", fields: [5] },
    shouldShowAlternateProductsForAllOutOfStock: { case: "Some", fields: [true] },
    customerGuid: { case: "None" },
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://chaldal.com",
      Referer: "https://chaldal.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Chaldal HTTP ${res.status} (category=${categoryId ?? "all"} page=${page})`);
  }
  return (await res.json()) as ChaldalSearchResponse;
}

function hitToRawProduct(hit: ChaldalHit, categoryName: string): RawProduct | null {
  if (!hit.name) return null;
  const sizeRaw = hit.subText ?? extractSizeFromName(hit.name);
  return {
    shop: "chaldal",
    shopProductId: hit.objectID ?? hit.slug ?? hit.name,
    productName: hit.name,
    brand: extractBrand(hit.name),
    packSize: sizeRaw,
    category: categoryName,
    price: typeof hit.price === "number" ? hit.price : null,
    originalPrice: typeof hit.mrp === "number" ? hit.mrp : null,
    available: hit.isAvailable !== false,
    url: hit.slug ? `https://chaldal.com/${hit.slug}` : "https://chaldal.com/",
    imageUrl: hit.picturesUrls?.[0] ?? null,
  };
}

export async function crawlChaldal(
  onProgress?: (msg: string) => void,
): Promise<{ products: RawProduct[]; categoriesCrawled: number }> {
  const seen = new Map<string, RawProduct>();
  let categoriesCrawled = 0;

  // Phase 1: per-category crawl (gives us category labels where we know the ID).
  for (const cat of CHALDAL_CATEGORIES) {
    let page = 0;
    let totalPages = 1;
    let firstSeenInCat = 0;
    while (page < totalPages) {
      try {
        const resp = await fetchPage(page, cat.id);
        const hits = resp.hits ?? [];
        totalPages = resp.nbPages ?? 1;
        let added = 0;
        for (const h of hits) {
          const p = hitToRawProduct(h, cat.name);
          if (!p) continue;
          const key = `chaldal:${p.shopProductId}`;
          if (!seen.has(key)) {
            seen.set(key, p);
            added++;
          }
        }
        firstSeenInCat += added;
        page++;
      } catch (err) {
        onProgress?.(
          `  ! ${cat.name} (id=${cat.id}) page ${page} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }
    }
    if (firstSeenInCat > 0) categoriesCrawled++;
    onProgress?.(`  · Chaldal ${cat.name.padEnd(22)} (id=${cat.id}) → ${firstSeenInCat} new products`);
    await new Promise((r) => setTimeout(r, 150));
  }

  // Phase 2: catch-all no-filter pass. Picks up everything that lives in
  // categories we don't have IDs for. Products get a category inferred from
  // their name by keyword rules (shampoo/soap → Personal Care, biscuit →
  // Biscuits, etc.) so they can cross-shop bucket with Shwapno's named
  // categories. Anything that doesn't match a keyword rule is labeled
  // "Uncategorized".
  onProgress?.(`  · Chaldal no-filter sweep for remaining products …`);
  let allPage = 0;
  let allTotalPages = 1;
  let sweepAdded = 0;
  const inferredCounts = new Map<string, number>();
  while (allPage < allTotalPages) {
    try {
      const resp = await fetchPage(allPage, null);
      const hits = resp.hits ?? [];
      allTotalPages = resp.nbPages ?? 1;
      for (const h of hits) {
        if (!h.name) continue;
        const inferred = inferCategoryFromName(h.name) ?? "Uncategorized";
        const p = hitToRawProduct(h, inferred);
        if (!p) continue;
        const key = `chaldal:${p.shopProductId}`;
        if (!seen.has(key)) {
          seen.set(key, p);
          sweepAdded++;
          inferredCounts.set(inferred, (inferredCounts.get(inferred) ?? 0) + 1);
        }
      }
      allPage++;
    } catch (err) {
      onProgress?.(
        `  ! no-filter page ${allPage} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
  }
  if (sweepAdded > 0) categoriesCrawled++;
  onProgress?.(`  · Chaldal no-filter sweep            → ${sweepAdded} new products`);
  const breakdown = Array.from(inferredCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${cat}=${n}`)
    .join(", ");
  if (breakdown) onProgress?.(`     inferred categories: ${breakdown}`);

  return { products: Array.from(seen.values()), categoriesCrawled };
}
