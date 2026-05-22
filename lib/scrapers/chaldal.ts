import type { ScrapedOffer } from "../types";

const ENDPOINT = "https://catalog.chaldal.com/searchOld";
const API_KEY = "e964fc2d51064efa97e94db7c64bf3d044279d4ed0ad4bdd9dce89fecc9156f0";

interface ChaldalHit {
  name: string;
  subText?: string;
  price: number;
  mrp?: number;
  isAvailable?: boolean;
  slug?: string;
  objectID?: string;
}

interface ChaldalSearchResponse {
  hits?: ChaldalHit[];
}

function hitToOffer(hit: ChaldalHit): ScrapedOffer {
  return {
    shop: "chaldal",
    productName: hit.name,
    brand: null,
    packSize: hit.subText ?? null,
    price: typeof hit.price === "number" ? hit.price : null,
    originalPrice: typeof hit.mrp === "number" ? hit.mrp : null,
    available: hit.isAvailable !== false,
    url: hit.slug ? `https://chaldal.com/${hit.slug}` : "https://chaldal.com/",
  };
}

export async function searchChaldalCandidates(query: string, n = 8): Promise<ScrapedOffer[]> {
  const body = {
    apiKey: API_KEY,
    storeId: 1,
    warehouseId: 8,
    pageSize: n,
    currentPageIndex: 0,
    metropolitanAreaId: 1,
    query,
    productVariantId: -1,
    bundleId: { case: "None" },
    canSeeOutOfStock: "false",
    filters: [],
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
    throw new Error(`Chaldal HTTP ${res.status} for query "${query}"`);
  }

  const json = (await res.json()) as ChaldalSearchResponse;
  return (json.hits ?? []).filter((h) => h?.name).map(hitToOffer);
}

export async function searchChaldal(query: string): Promise<ScrapedOffer | null> {
  const candidates = await searchChaldalCandidates(query, 1);
  return candidates[0] ?? null;
}
