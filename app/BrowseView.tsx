"use client";

import { useEffect, useMemo, useState } from "react";
import type { RawProduct } from "@/lib/crawl/types";
import type { MatchGroup } from "@/lib/crawl/match";

type Tab = "matches" | "all";
type ShopFilter = "all" | "chaldal" | "shwapno";

const SHOP_COLOR: Record<string, string> = {
  chaldal: "bg-chaldal",
  shwapno: "bg-shwapno",
  pandamart: "bg-pandamart",
};

function bdt(n: number | null | undefined): string {
  if (typeof n !== "number") return "—";
  return `৳${n.toLocaleString("en-BD")}`;
}

interface ProductsResp {
  total: number;
  offset: number;
  limit: number;
  products: RawProduct[];
}

interface MatchesResp {
  total: number;
  offset: number;
  limit: number;
  groups: MatchGroup[];
}

interface Props {
  categories: string[];
  initialMatchCount: number;
}

export function BrowseView({ categories, initialMatchCount }: Props) {
  const [tab, setTab] = useState<Tab>("matches");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [shop, setShop] = useState<ShopFilter>("all");

  const [products, setProducts] = useState<RawProduct[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [matches, setMatches] = useState<MatchGroup[]>([]);
  const [matchesTotal, setMatchesTotal] = useState(initialMatchCount);
  const [loading, setLoading] = useState(false);

  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (category !== "All") params.set("category", category);
    params.set("limit", "300");

    if (tab === "matches") {
      fetch(`/api/matches?${params}`)
        .then((r) => r.json() as Promise<MatchesResp>)
        .then((d) => {
          if (cancelled) return;
          setMatches(d.groups ?? []);
          setMatchesTotal(d.total ?? 0);
        })
        .finally(() => !cancelled && setLoading(false));
    } else {
      if (shop !== "all") params.set("shop", shop);
      fetch(`/api/products?${params}`)
        .then((r) => r.json() as Promise<ProductsResp>)
        .then((d) => {
          if (cancelled) return;
          setProducts(d.products ?? []);
          setProductsTotal(d.total ?? 0);
        })
        .finally(() => !cancelled && setLoading(false));
    }
    return () => {
      cancelled = true;
    };
  }, [tab, debouncedQuery, category, shop]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral-200">
        <TabButton active={tab === "matches"} onClick={() => setTab("matches")}>
          Cross-shop matches ({matchesTotal.toLocaleString()})
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All products ({productsTotal.toLocaleString() || "all"})
        </TabButton>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          placeholder={
            tab === "matches"
              ? "Search matched products (e.g. 'pusti', 'soyabean', 'sugar')"
              : "Search all products (e.g. 'rice 5kg', 'turmeric')"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm"
        >
          <option value="All">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {tab === "all" && (
          <select
            value={shop}
            onChange={(e) => setShop(e.target.value as ShopFilter)}
            className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="all">All shops</option>
            <option value="chaldal">Chaldal only</option>
            <option value="shwapno">Shwapno only</option>
          </select>
        )}
      </div>

      {loading && <div className="mb-2 text-xs text-neutral-500">Loading…</div>}

      {tab === "matches" ? (
        <MatchesTable groups={matches} />
      ) : (
        <ProductsTable products={products} />
      )}

      {tab === "matches" && matches.length === 0 && !loading && (
        <p className="mt-4 text-sm text-neutral-500">
          No cross-shop matches for these filters. Try clearing filters or switch to "All products".
        </p>
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-neutral-900 text-neutral-900"
          : "border-transparent text-neutral-500 hover:text-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

function MatchesTable({ groups }: { groups: MatchGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-600">
          <tr>
            <th className="px-4 py-3">Brand · Size · Category</th>
            <th className="px-4 py-3 text-chaldal">Chaldal</th>
            <th className="px-4 py-3 text-shwapno">Shwapno</th>
            <th className="px-4 py-3">Price gap</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {groups.map((g) => {
            const cOffers = g.offers.chaldal ?? [];
            const sOffers = g.offers.shwapno ?? [];
            const isMultiSku = cOffers.length > 1 || sOffers.length > 1;
            const allOffers = ([...cOffers, ...sOffers]).filter(
              (o) => typeof o.price === "number",
            );
            const prices = allOffers.map((o) => o.price as number);
            // Only compute a price gap when both cells are single-SKU. Multi-
            // SKU rows would mix unrelated prices and overstate savings.
            const min = !isMultiSku && prices.length > 0 ? Math.min(...prices) : null;
            const max = !isMultiSku && prices.length > 0 ? Math.max(...prices) : null;
            const gap = min !== null && max !== null ? max - min : null;
            return (
              <tr key={g.key} className="hover:bg-neutral-50">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-neutral-900">{g.brand}</div>
                  <div className="text-xs text-neutral-600">{g.sizeDisplay}</div>
                  <div className="text-xs text-neutral-500">{g.category}</div>
                </td>
                <OfferCell offers={g.offers.chaldal ?? []} minPrice={min} maxPrice={max} />
                <OfferCell offers={g.offers.shwapno ?? []} minPrice={min} maxPrice={max} />
                <td className="px-4 py-3 align-top text-sm">
                  {isMultiSku ? (
                    <span
                      className="text-xs text-neutral-500"
                      title="Multiple SKUs in this group — can't compute a fair gap"
                    >
                      ambiguous
                    </span>
                  ) : gap !== null && gap > 0 ? (
                    <span className="font-semibold text-emerald-700">save ৳{gap.toLocaleString("en-BD")}</span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OfferCell({
  offers,
  minPrice,
  maxPrice,
}: {
  offers: RawProduct[];
  minPrice: number | null;
  maxPrice: number | null;
}) {
  if (offers.length === 0) {
    return (
      <td className="px-4 py-3 align-top text-neutral-400">—</td>
    );
  }
  // When the row has only one offer per shop and prices tie, both cells
  // show "Same price" (a neutral chip) instead of "Lowest" on both.
  const priceTied = minPrice !== null && maxPrice !== null && minPrice === maxPrice;
  return (
    <td className="px-4 py-3 align-top">
      {offers.map((o, i) => {
        const isMin = typeof o.price === "number" && o.price === minPrice;
        return (
          <div key={i} className={i > 0 ? "mt-2 border-t border-neutral-100 pt-2" : ""}>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-base font-semibold ${isMin && !priceTied ? "text-emerald-700" : "text-neutral-900"}`}
              >
                {bdt(o.price)}
              </span>
              {typeof o.originalPrice === "number" && o.originalPrice > (o.price ?? 0) && (
                <span className="text-xs text-neutral-400 line-through">{bdt(o.originalPrice)}</span>
              )}
              {isMin && offers.length === 1 && priceTied && (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600">
                  Same price
                </span>
              )}
              {isMin && offers.length === 1 && !priceTied && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                  Lowest
                </span>
              )}
            </div>
            <a
              href={o.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 line-clamp-2 block text-xs text-neutral-500 hover:text-neutral-700 hover:underline"
              title={o.productName}
            >
              {o.productName}
            </a>
            {!o.available && (
              <div className="mt-0.5 text-[10px] font-medium uppercase text-amber-600">Out of stock</div>
            )}
          </div>
        );
      })}
    </td>
  );
}

function ProductsTable({ products }: { products: RawProduct[] }) {
  if (products.length === 0) {
    return (
      <p className="mt-4 text-sm text-neutral-500">No products match these filters.</p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-600">
          <tr>
            <th className="px-4 py-3">Shop</th>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Brand</th>
            <th className="px-4 py-3">Size</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3 text-right">Price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {products.map((p, i) => (
            <tr key={`${p.shop}:${p.shopProductId}:${i}`} className="hover:bg-neutral-50">
              <td className="px-4 py-3 align-top">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white ${SHOP_COLOR[p.shop] ?? "bg-neutral-500"}`}
                >
                  {p.shop}
                </span>
              </td>
              <td className="px-4 py-3 align-top">
                <a
                  href={p.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-neutral-900 hover:underline"
                  title={p.productName}
                >
                  {p.productName}
                </a>
                {!p.available && (
                  <div className="mt-0.5 text-[10px] font-medium uppercase text-amber-600">Out of stock</div>
                )}
              </td>
              <td className="px-4 py-3 align-top text-xs text-neutral-700">{p.brand ?? "—"}</td>
              <td className="px-4 py-3 align-top text-xs text-neutral-600">{p.packSize ?? "—"}</td>
              <td className="px-4 py-3 align-top text-xs text-neutral-500">{p.category}</td>
              <td className="px-4 py-3 align-top text-right">
                <div className="font-semibold text-neutral-900">{bdt(p.price)}</div>
                {typeof p.originalPrice === "number" && p.originalPrice > (p.price ?? 0) && (
                  <div className="text-xs text-neutral-400 line-through">{bdt(p.originalPrice)}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
