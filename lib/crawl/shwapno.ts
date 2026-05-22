import type { RawProduct } from "./types";
import { extractBrand, extractSizeFromName } from "./extract";

const BASE = "https://www.shwapno.com";
const PAGE_SIZE = 200;

// Known category slugs. catalogId is discovered at crawl time by scraping
// the category page HTML. Slugs found by probing the homepage.
export const SHWAPNO_SLUGS: { slug: string; name: string }[] = [
  { slug: "packed-rice", name: "Rice" },
  { slug: "oil", name: "Oil" },
  { slug: "ghee", name: "Ghee" },
  { slug: "daal-or-lentil", name: "Lentils" },
  { slug: "sugar", name: "Sugar" },
  { slug: "salt", name: "Salt" },
  { slug: "eggs", name: "Eggs" },
  { slug: "dairy", name: "Dairy" },
  { slug: "fresh-vegetables", name: "Fresh Vegetables" },
  { slug: "fresh-fruits", name: "Fresh Fruits" },
  { slug: "meat", name: "Meat" },
  { slug: "beef", name: "Beef" },
  { slug: "chicken", name: "Chicken" },
  { slug: "fish", name: "Fish" },
  { slug: "tea", name: "Tea" },
  { slug: "coffee", name: "Coffee" },
  { slug: "baking-ingredients", name: "Baking & Flour" },
  { slug: "spices", name: "Spices" },
  { slug: "snacks", name: "Snacks" },
  { slug: "breakfast", name: "Breakfast" },
  { slug: "beverages", name: "Beverages" },
  { slug: "biscuits-and-cookies", name: "Biscuits" },
  { slug: "chocolate-and-candy", name: "Chocolate & Candy" },
  { slug: "noodles-pasta", name: "Noodles & Pasta" },
  { slug: "sauces-and-spreads", name: "Sauces & Spreads" },
  { slug: "frozen-foods", name: "Frozen Foods" },
  { slug: "baby-food", name: "Baby Food" },
  { slug: "personal-care", name: "Personal Care" },
  { slug: "household", name: "Household" },
  { slug: "cleaning", name: "Cleaning" },
];

interface ShwapnoProduct {
  name?: string;
  sku?: string;
  seName?: string;
  price?: { priceValue?: number; oldPriceValue?: number };
  stockAvailability?: string;
  picture?: { largeDeviceUrl?: { fullSizeImageUrl?: string } };
}

// /api/category/products returns products UNWRAPPED (different from /api/search).
interface ShwapnoCategoryResp {
  products?: ShwapnoProduct[];
  totalPages?: number;
  pageNumber?: number;
  totalItems?: number;
  hasNextPage?: boolean;
}

const CATALOG_ID_REGEX = /\\?"catalogId\\?"\s*:\s*\\?"([0-9a-f]{24})\\?"/i;

async function discoverCatalogId(slug: string): Promise<string | null> {
  const res = await fetch(`${BASE}/${slug}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(CATALOG_ID_REGEX);
  return m?.[1] ?? null;
}

async function fetchCategoryPage(
  catalogId: string,
  page: number,
): Promise<ShwapnoCategoryResp> {
  const url = `${BASE}/api/category/products?id=${catalogId}&pagesize=${PAGE_SIZE}&pageNumber=${page}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
      Referer: BASE,
    },
  });
  if (!res.ok) throw new Error(`Shwapno HTTP ${res.status} (catalogId=${catalogId} page=${page})`);
  return (await res.json()) as ShwapnoCategoryResp;
}

function productToRaw(p: ShwapnoProduct, categoryName: string): RawProduct | null {
  if (!p?.name) return null;
  const sizeRaw = extractSizeFromName(p.name);
  const priceValue = p.price?.priceValue;
  const oldPriceValue = p.price?.oldPriceValue;
  return {
    shop: "shwapno",
    shopProductId: p.sku ?? p.seName ?? p.name,
    productName: p.name,
    brand: extractBrand(p.name),
    packSize: sizeRaw,
    category: categoryName,
    price: typeof priceValue === "number" && priceValue > 0 ? priceValue : null,
    originalPrice: typeof oldPriceValue === "number" && oldPriceValue > 0 ? oldPriceValue : null,
    available: p.stockAvailability !== "Out of stock",
    url: p.seName ? `${BASE}/${p.seName}` : BASE,
    imageUrl: p.picture?.largeDeviceUrl?.fullSizeImageUrl ?? null,
  };
}

export async function crawlShwapno(
  onProgress?: (msg: string) => void,
): Promise<{ products: RawProduct[]; categoriesCrawled: number }> {
  const seen = new Map<string, RawProduct>();
  let categoriesCrawled = 0;

  for (const cat of SHWAPNO_SLUGS) {
    let catalogId: string | null = null;
    try {
      catalogId = await discoverCatalogId(cat.slug);
    } catch (err) {
      onProgress?.(`  ! discover catalogId for ${cat.slug} failed: ${(err as Error).message}`);
    }
    if (!catalogId) {
      onProgress?.(`  - Shwapno ${cat.name.padEnd(20)} slug=${cat.slug}: no catalogId`);
      continue;
    }

    let page = 1;
    let totalPages = 1;
    let firstSeenInCat = 0;
    while (page <= totalPages) {
      try {
        const resp = await fetchCategoryPage(catalogId, page);
        const products = resp.products ?? [];
        totalPages = resp.totalPages ?? 1;
        let added = 0;
        for (const sp of products) {
          const p = productToRaw(sp, cat.name);
          if (!p) continue;
          const key = `shwapno:${p.shopProductId}`;
          if (!seen.has(key)) {
            seen.set(key, p);
            added++;
          }
        }
        firstSeenInCat += added;
        if (!resp.hasNextPage) break;
        page++;
      } catch (err) {
        onProgress?.(
          `  ! ${cat.name} (cid=${catalogId}) page ${page} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }
    }
    if (firstSeenInCat > 0) categoriesCrawled++;
    onProgress?.(`  · Shwapno ${cat.name.padEnd(20)} → ${firstSeenInCat} new products`);
    await new Promise((r) => setTimeout(r, 200));
  }

  return { products: Array.from(seen.values()), categoriesCrawled };
}
