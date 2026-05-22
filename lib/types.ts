export type Shop = "chaldal" | "shwapno" | "pandamart";

export interface CatalogItem {
  id: string;
  displayName: string;
  category: string;
  queries: { [K in Shop]: string };
}

export interface ScrapedOffer {
  shop: Shop;
  productName: string;
  brand: string | null;
  packSize: string | null;
  price: number | null;
  originalPrice: number | null;
  available: boolean;
  url: string | null;
}

export type MatchType = "sku" | "category" | "single";

export interface ComparisonRow {
  catalogId: string;
  displayName: string;
  category: string;
  matchType: MatchType;
  offers: { [K in Shop]?: ScrapedOffer };
}

export interface PriceSnapshot {
  scrapedAt: string;
  rows: ComparisonRow[];
  errors: { shop: Shop; message: string }[];
}
