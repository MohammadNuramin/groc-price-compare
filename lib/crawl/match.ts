import type { Shop } from "../types";
import { extractVariety, normalizeSize } from "./extract";
import type { RawProduct } from "./types";

export interface MatchGroup {
  key: string;
  brand: string | null;
  sizeDisplay: string | null;
  asGrams: number | null;
  asMl: number | null;
  asPieces: number | null;
  variety: string | null;
  category: string;
  offers: { [K in Shop]?: RawProduct[] };
  cheapestPrice: number | null;
  cheapestShop: Shop | null;
}

function canonicalBrand(s: string | null): string {
  return (s ?? "").toLowerCase().trim();
}

function canonicalSize(p: RawProduct): { display: string | null; unit: "g" | "ml" | "pcs" | "raw"; qty: number | null } {
  const norm = normalizeSize(p.packSize);
  if (norm.asGrams) return { display: norm.display, unit: "g", qty: norm.asGrams };
  if (norm.asMl) return { display: norm.display, unit: "ml", qty: norm.asMl };
  if (norm.asPieces) return { display: norm.display, unit: "pcs", qty: norm.asPieces };
  return { display: norm.display, unit: "raw", qty: null };
}

function canonicalCategory(category: string): string {
  // Lump similar category names across shops.
  const lc = category.toLowerCase();
  if (lc.includes("rice")) return "rice";
  if (lc.includes("lentil") || lc.includes("daal") || lc.includes("dal") || lc.includes("pulse")) return "lentils";
  if (lc.includes("oil") && !lc.includes("ghee")) return "oil";
  if (lc.includes("ghee")) return "ghee";
  if (lc.includes("flour") || lc.includes("baking") || lc.includes("atta") || lc.includes("maida")) return "flour";
  if (lc.includes("sugar") || lc.includes("sweet")) return "sugar";
  if (lc.includes("salt")) return "salt";
  if (lc.includes("spice") || lc.includes("seasoning")) return "spices";
  if (lc.includes("egg")) return "eggs";
  if (lc.includes("dairy") || lc.includes("powder milk") || lc.includes("milk powder")) return "dairy";
  if (lc.includes("vegetable")) return "vegetables";
  if (lc.includes("fruit")) return "fruits";
  if (lc.includes("fish")) return "fish";
  if (lc.includes("meat") || lc.includes("beef") || lc.includes("chicken")) return "meat";
  if (lc.includes("tea") || lc.includes("coffee")) return "beverages";
  if (lc.includes("snack")) return "snacks";
  if (lc.includes("breakfast")) return "breakfast";
  return lc.replace(/\s+/g, "_");
}

export function buildMatchGroups(products: RawProduct[]): MatchGroup[] {
  const map = new Map<string, MatchGroup>();

  for (const p of products) {
    const brand = canonicalBrand(p.brand);
    const size = canonicalSize(p);
    const variety = extractVariety(p.productName) ?? "";
    const cat = canonicalCategory(p.category);

    // Key requires brand+size+variety (or category) for an SKU match.
    // Products without a brand can't form SKU matches — skip them for the
    // match-pair view (they still appear in the all-products list).
    if (!brand || !size.qty) continue;

    const key = `${cat}|${variety}|${brand}|${size.unit}|${size.qty}`;
    let g = map.get(key);
    if (!g) {
      const norm = normalizeSize(p.packSize);
      g = {
        key,
        brand: p.brand,
        sizeDisplay: norm.display,
        asGrams: norm.asGrams,
        asMl: norm.asMl,
        asPieces: norm.asPieces,
        variety: variety || null,
        category: p.category,
        offers: {},
        cheapestPrice: null,
        cheapestShop: null,
      };
      map.set(key, g);
    }
    if (!g.offers[p.shop]) g.offers[p.shop] = [];
    g.offers[p.shop]!.push(p);
    if (typeof p.price === "number" && p.price > 0) {
      if (g.cheapestPrice === null || p.price < g.cheapestPrice) {
        g.cheapestPrice = p.price;
        g.cheapestShop = p.shop;
      }
    }
  }

  // Only keep groups where 2+ shops are present (cross-shop matches).
  // Multi-SKU disambiguation (e.g., Extra Virgin vs regular Olio Orolio 5L)
  // happens in a later LLM-driven pass — match.ts stays pure/deterministic.
  return Array.from(map.values()).filter((g) => Object.keys(g.offers).length >= 2);
}
