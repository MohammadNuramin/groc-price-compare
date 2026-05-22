import type { Shop } from "../types";

export interface RawProduct {
  shop: Shop;
  shopProductId: string;
  productName: string;
  brand: string | null;
  packSize: string | null;
  category: string;
  price: number | null;
  originalPrice: number | null;
  available: boolean;
  url: string | null;
  imageUrl: string | null;
}

export interface CrawlSnapshot {
  crawledAt: string;
  shops: { [K in Shop]?: { categoriesCrawled: number; productsFound: number } };
  products: RawProduct[];
}
