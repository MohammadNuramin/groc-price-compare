import type { ScrapedOffer } from "../types";

const ENDPOINT = "https://www.shwapno.com/api/search";

interface ShwapnoPrice {
  oldPriceValue?: number;
  priceValue?: number;
}

interface ShwapnoProduct {
  name: string;
  sku?: string;
  seName?: string;
  price?: ShwapnoPrice;
  stockAvailability?: string;
}

interface ShwapnoProductWrapper {
  product: ShwapnoProduct;
}

interface ShwapnoSearchResponse {
  products?: ShwapnoProductWrapper[];
}

function productToOffer(p: ShwapnoProduct): ScrapedOffer {
  const priceValue = p.price?.priceValue;
  const oldPriceValue = p.price?.oldPriceValue;
  return {
    shop: "shwapno",
    productName: p.name,
    brand: null,
    packSize: null,
    price: typeof priceValue === "number" && priceValue > 0 ? priceValue : null,
    originalPrice: typeof oldPriceValue === "number" && oldPriceValue > 0 ? oldPriceValue : null,
    available: p.stockAvailability !== "Out of stock",
    url: p.seName ? `https://www.shwapno.com/${p.seName}` : "https://www.shwapno.com/",
  };
}

async function fetchShwapno(url: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        Referer: "https://www.shwapno.com/",
      },
    });
    if (res.ok) return res;
    // Retry transient upstream errors (502/503/504); fail fast on 4xx.
    if (res.status >= 500 && i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      continue;
    }
    lastErr = new Error(`Shwapno HTTP ${res.status}`);
    throw lastErr;
  }
  throw lastErr ?? new Error("Shwapno: out of retries");
}

export async function searchShwapnoCandidates(query: string, n = 8): Promise<ScrapedOffer[]> {
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}`;
  const res = await fetchShwapno(url);
  const json = (await res.json()) as ShwapnoSearchResponse;
  return (json.products ?? [])
    .slice(0, n)
    .map((w) => w?.product)
    .filter((p): p is ShwapnoProduct => Boolean(p?.name))
    .map(productToOffer);
}

export async function searchShwapno(query: string): Promise<ScrapedOffer | null> {
  const candidates = await searchShwapnoCandidates(query, 1);
  return candidates[0] ?? null;
}
