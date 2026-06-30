import type { RawProduct } from "./types";
import { extractBrand, extractSizeFromName } from "./extract";

// Live Pandamart (foodpanda darkstore) crawl via the foodpanda GraphQL API.
//
// foodpanda's website is fronted by PerimeterX, which blocks DATACENTER IPs
// (you get a 403 "Access to this page has been denied" page). From a
// RESIDENTIAL IP, however, the catalog GraphQL endpoint answers plain HTTP
// POSTs with no auth token — only self-generated `perseus-*` ids are needed.
//
// Strategy: `getShopDetails` (includeCategoryTree) returns the full category
// tree; then `getProductsByCategoryList` per category/subcategory node returns
// that node's products. We union parent + subcategory nodes (the parent query
// caps results, so subcategories fill the gaps) and dedupe by globalCatalogID.
//
// If this fails (e.g. run from a blocked datacenter IP), the caller falls back
// to the Wayback-Machine crawler in `pandamart-wayback.ts`.

const ENDPOINT = process.env.PANDAMART_GRAPHQL ?? "https://bd.fd-api.com/api/v5/graphql";
const GLOBAL_ENTITY = process.env.PANDAMART_ENTITY ?? "FP_BD";
const LOCALE = process.env.PANDAMART_LOCALE ?? "en_BD";
// One or more darkstore vendor codes (from the /darkstore/<code>/... URL).
const VENDORS = (process.env.PANDAMART_VENDORS ?? "vbpl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CONCURRENCY = Math.max(1, Number(process.env.PANDAMART_CONCURRENCY ?? "3"));
const REQUEST_DELAY_MS = Number(process.env.PANDAMART_DELAY_MS ?? "90");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PRODUCT_FIELDS = `fragment ProductFields on Product {
  attributes(keys: $attributes) { key value }
  globalCatalogID isAvailable name originalPrice price productID stockAmount urls
  weightableAttributes { weightedOriginalPrice weightedPrice weightValue { unit value } }
}`;

const SHOP_QUERY = `fragment CategoryFields on Category { categoryType name id }
fragment SubCategoryFields on SubCategory { id name productsCount }
fragment CategoryTreeFields on CategoryTree { category { ...CategoryFields } productsCount subCategories { ...SubCategoryFields } }
query getShopDetails($featureFlags:[FunWithFlag!],$globalEntityId:String!,$isDarkstore:Boolean!,$locale:String!,$userCode:String,$vendorCode:String!,$includeCategoryTree:Boolean!){
  shopDetails {
    categories(input:{customerID:$userCode,funWithFlags:$featureFlags,globalEntityID:$globalEntityId,isDarkstore:$isDarkstore,locale:$locale,platform:"web",vendorID:$vendorCode}) @include(if:$includeCategoryTree){ ...CategoryTreeFields }
  }
}`;

const CAT_QUERY = `${PRODUCT_FIELDS}
query getProductsByCategoryList($attributes:[String!],$categoryId:String!,$featureFlags:[FunWithFlag!],$globalEntityId:String!,$isDarkstore:Boolean!,$locale:String!,$vendorID:String!){
  categoryProductList(input:{categoryID:$categoryId,funWithFlags:$featureFlags,globalEntityID:$globalEntityId,isDarkstore:$isDarkstore,locale:$locale,platform:"web",vendorID:$vendorID}){
    categoryProducts { id name items { ...ProductFields } }
  }
}`;

const ATTR_KEYS = ["baseUnit", "baseContentValue", "sku"];

interface PFProduct {
  globalCatalogID?: string;
  productID?: string;
  name?: string;
  price?: number;
  originalPrice?: number;
  isAvailable?: boolean;
  urls?: string[];
}

interface CategoryNode {
  id: string;
  name: string;
  subIds: string[];
}

function perseus(): string {
  return `${Date.now()}.${Math.floor(Math.random() * 1e18)}.${Math.random().toString(36).slice(2, 12)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function gql(
  query: string,
  variables: Record<string, unknown>,
  opName: string,
  retries = 2,
): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-global-entity-id": GLOBAL_ENTITY,
          "x-pd-language-id": "1",
          "x-apollo-operation-name": opName,
          "x-fp-api-key": "volo",
          "perseus-client-id": perseus(),
          "perseus-session-id": perseus(),
          platform: "web",
          "x-requested-with": "XMLHttpRequest",
          origin: "https://www.foodpanda.com.bd",
          referer: "https://www.foodpanda.com.bd/",
          "user-agent": UA,
        },
        body: JSON.stringify({ query, variables, operationName: opName }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json?.errors && !json?.data) {
        throw new Error(json.errors[0]?.message ?? "GraphQL error");
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function fetchCategoryTree(vendorCode: string): Promise<CategoryNode[]> {
  const json = await gql(
    SHOP_QUERY,
    {
      globalEntityId: GLOBAL_ENTITY,
      isDarkstore: true,
      locale: LOCALE,
      vendorCode,
      includeCategoryTree: true,
      featureFlags: [],
    },
    "getShopDetails",
  );
  const cats = json?.data?.shopDetails?.categories ?? [];
  return cats
    .map((c: any): CategoryNode | null => {
      const id = c?.category?.id;
      if (!id) return null;
      return {
        id,
        name: c?.category?.name ?? "Uncategorized",
        subIds: (c?.subCategories ?? []).map((s: any) => s?.id).filter(Boolean),
      };
    })
    .filter((c: CategoryNode | null): c is CategoryNode => c !== null);
}

async function fetchCategoryProducts(vendorCode: string, categoryId: string): Promise<PFProduct[]> {
  const json = await gql(
    CAT_QUERY,
    {
      categoryId,
      globalEntityId: GLOBAL_ENTITY,
      isDarkstore: true,
      locale: LOCALE,
      vendorID: vendorCode,
      attributes: ATTR_KEYS,
      featureFlags: [],
    },
    "getProductsByCategoryList",
  );
  const groups = json?.data?.categoryProductList?.categoryProducts ?? [];
  const out: PFProduct[] = [];
  for (const g of groups) for (const it of g?.items ?? []) out.push(it);
  return out;
}

function toRawProduct(p: PFProduct, category: string, vendorCode: string): RawProduct | null {
  const id = p.productID ?? p.globalCatalogID;
  if (!id || !p.name) return null;
  const price = typeof p.price === "number" && p.price > 0 ? p.price : null;
  const original =
    typeof p.originalPrice === "number" && p.originalPrice > 0 ? p.originalPrice : null;
  return {
    shop: "pandamart",
    shopProductId: String(id),
    productName: p.name,
    brand: extractBrand(p.name),
    packSize: extractSizeFromName(p.name),
    category,
    price,
    originalPrice: original,
    available: p.isAvailable !== false,
    url: `https://www.foodpanda.com.bd/darkstore/${vendorCode}/?productID=${id}`,
    imageUrl: Array.isArray(p.urls) && p.urls.length > 0 ? p.urls[0] : null,
  };
}

// Run async tasks with a fixed concurrency and a small inter-request delay.
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
      if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export async function crawlPandamartLive(
  onProgress?: (msg: string) => void,
): Promise<{ products: RawProduct[]; categoriesCrawled: number }> {
  const seen = new Map<string, RawProduct>();
  let categoriesCrawled = 0;

  for (const vendor of VENDORS) {
    onProgress?.(`Pandamart (live) — ${vendor}: fetching category tree …`);
    const cats = await fetchCategoryTree(vendor);
    if (cats.length === 0) {
      throw new Error(`Pandamart live: no categories for vendor ${vendor} (blocked or bad code?)`);
    }
    onProgress?.(`  ${cats.length} categories for ${vendor}`);

    for (const cat of cats) {
      const before = seen.size;
      const nodeIds = [cat.id, ...cat.subIds];
      await pool(nodeIds, CONCURRENCY, async (nodeId) => {
        let items: PFProduct[] = [];
        try {
          items = await fetchCategoryProducts(vendor, nodeId);
        } catch {
          return; // node failed after retries; skip
        }
        for (const it of items) {
          const id = it.productID ?? it.globalCatalogID;
          if (!id) continue;
          const key = `pandamart:${id}`;
          if (!seen.has(key)) {
            const rp = toRawProduct(it, cat.name, vendor);
            if (rp) seen.set(key, rp);
          }
        }
      });
      categoriesCrawled++;
      onProgress?.(`  · ${cat.name.padEnd(26)} +${seen.size - before} (total ${seen.size})`);
    }
  }

  const products = [...seen.values()];
  onProgress?.(
    `Pandamart (live) done — ${products.length} unique products across ${categoriesCrawled} categories`,
  );
  return { products, categoriesCrawled };
}
