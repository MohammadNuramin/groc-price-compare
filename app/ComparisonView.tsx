"use client";

import { useMemo, useState } from "react";
import type { ComparisonRow, Shop } from "@/lib/types";

const SHOPS: { id: Shop; label: string; colorClass: string }[] = [
  { id: "chaldal", label: "Chaldal", colorClass: "text-chaldal" },
  { id: "shwapno", label: "Shwapno", colorClass: "text-shwapno" },
  { id: "pandamart", label: "Pandamart", colorClass: "text-pandamart" },
];

function formatBdt(n: number | null | undefined): string {
  if (typeof n !== "number") return "—";
  return `৳${n.toLocaleString("en-BD")}`;
}

interface Props {
  rows: ComparisonRow[];
  categories: string[];
  minPrices: Record<string, Shop[]>;
}

export function ComparisonView({ rows, categories, minPrices }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== "All" && r.category !== category) return false;
      if (!q) return true;
      if (r.displayName.toLowerCase().includes(q)) return true;
      for (const shop of Object.keys(r.offers) as Shop[]) {
        const name = r.offers[shop]?.productName?.toLowerCase() ?? "";
        if (name.includes(q)) return true;
      }
      return false;
    });
  }, [rows, query, category]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          placeholder="Search products (e.g. 'rice', 'sugar')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
        >
          <option value="All">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-600">
            <tr>
              <th className="px-4 py-3">Product</th>
              {SHOPS.map((s) => (
                <th key={s.id} className={`px-4 py-3 ${s.colorClass}`}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                  No products match your filter.
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const winners = minPrices[row.catalogId] ?? [];
              return (
                <tr key={row.catalogId} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-neutral-900">{row.displayName}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-neutral-500">{row.category}</span>
                      {row.matchType === "sku" && (
                        <span
                          className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700"
                          title="Same brand at multiple shops — direct price comparison is fair"
                        >
                          Brand match
                        </span>
                      )}
                      {row.matchType === "category" && (
                        <span
                          className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-600"
                          title="Different brands across shops — shown as cheapest available in this category at each shop"
                        >
                          Different brands
                        </span>
                      )}
                    </div>
                  </td>
                  {SHOPS.map((s) => {
                    const offer = row.offers[s.id];
                    const isWinner = winners.includes(s.id);
                    if (!offer) {
                      return (
                        <td key={s.id} className="px-4 py-3 align-top text-neutral-400">
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={s.id} className="px-4 py-3 align-top">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`text-base font-semibold ${
                              isWinner ? "text-emerald-700" : "text-neutral-900"
                            }`}
                          >
                            {formatBdt(offer.price)}
                          </span>
                          {typeof offer.originalPrice === "number" &&
                            offer.originalPrice > (offer.price ?? 0) && (
                              <span className="text-xs text-neutral-400 line-through">
                                {formatBdt(offer.originalPrice)}
                              </span>
                            )}
                          {isWinner && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                              Lowest
                            </span>
                          )}
                        </div>
                        {offer.brand && (
                          <div className="mt-1 text-xs font-medium text-neutral-700">
                            {offer.brand}
                          </div>
                        )}
                        <a
                          href={offer.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 line-clamp-2 block text-xs text-neutral-500 hover:text-neutral-700 hover:underline"
                          title={offer.productName}
                        >
                          {offer.productName}
                          {offer.packSize ? ` · ${offer.packSize}` : ""}
                        </a>
                        {row.matchType === "category" && (
                          <div className="mt-1 text-[10px] text-neutral-500">
                            Cheapest {row.displayName} here
                          </div>
                        )}
                        {!offer.available && (
                          <div className="mt-1 text-[10px] font-medium uppercase text-amber-600">
                            Out of stock
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
