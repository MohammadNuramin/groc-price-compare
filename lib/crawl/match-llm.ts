import { normalizeSize } from "./extract";
import type { MatchGroup } from "./match";
import type { RawProduct } from "./types";

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:8200/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? "gemma-4-8b-thinking";
const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY ?? "16");
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? "60000");
const LLM_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS ?? "2048");
const MAX_PER_SHOP_PER_BATCH = 12;

function canonicalCategory(category: string): string {
  const lc = category.toLowerCase();
  if (lc.includes("rice")) return "rice";
  if (lc.includes("lentil") || lc.includes("daal") || lc.includes("dal") || lc.includes("pulse"))
    return "lentils";
  if (lc.includes("oil") && !lc.includes("ghee")) return "oil";
  if (lc.includes("ghee")) return "ghee";
  if (lc.includes("flour") || lc.includes("baking") || lc.includes("atta") || lc.includes("maida"))
    return "flour";
  if (lc.includes("sugar") || lc.includes("sweet")) return "sugar";
  if (lc.includes("salt")) return "salt";
  if (lc.includes("spice") || lc.includes("seasoning")) return "spices";
  if (lc.includes("egg")) return "eggs";
  if (lc.includes("dairy") || lc.includes("powder milk") || lc.includes("milk powder"))
    return "dairy";
  if (lc.includes("vegetable")) return "vegetables";
  if (lc.includes("fruit")) return "fruits";
  if (lc.includes("fish")) return "fish";
  if (lc.includes("meat") || lc.includes("beef") || lc.includes("chicken")) return "meat";
  if (lc.includes("tea") || lc.includes("coffee")) return "beverages";
  if (lc.includes("snack")) return "snacks";
  if (lc.includes("breakfast")) return "breakfast";
  if (lc.includes("biscuit")) return "biscuits";
  if (lc.includes("chocolate") || lc.includes("candy")) return "chocolate";
  if (lc.includes("noodle") || lc.includes("pasta")) return "noodles";
  if (lc.includes("sauce") || lc.includes("spread")) return "sauces";
  if (lc.includes("personal") || lc.includes("toilet") || lc.includes("hair") || lc.includes("body"))
    return "personal_care";
  if (lc.includes("clean") || lc.includes("household")) return "household";
  return lc.replace(/\s+/g, "_");
}

function sizeBucket(p: RawProduct): string | null {
  const n = normalizeSize(p.packSize);
  if (n.asGrams) return `g:${Math.round(n.asGrams)}`;
  if (n.asMl) return `ml:${Math.round(n.asMl)}`;
  if (n.asPieces) return `pcs:${Math.round(n.asPieces)}`;
  return null;
}

import type { Shop } from "../types";

interface Bucket {
  category: string;
  rawCategory: string;
  size: string;
  sizeDisplay: string | null;
  // Buckets for cross-shop pairing. We do PAIRWISE matching (A-vs-B, A-vs-C,
  // B-vs-C) so the same product list shape works for any pair of shops.
  byShop: Partial<Record<Shop, RawProduct[]>>;
}

const SHOP_PAIRS: Array<[Shop, Shop]> = [
  ["chaldal", "shwapno"],
  ["chaldal", "pandamart"],
  ["shwapno", "pandamart"],
];

function bucketize(products: RawProduct[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const p of products) {
    const size = sizeBucket(p);
    if (!size) continue;
    const cat = canonicalCategory(p.category);
    const key = `${cat}|${size}`;
    let b = map.get(key);
    if (!b) {
      const sn = normalizeSize(p.packSize);
      b = {
        category: cat,
        rawCategory: p.category,
        size,
        sizeDisplay: sn.display,
        byShop: {},
      };
      map.set(key, b);
    }
    if (!b.byShop[p.shop]) b.byShop[p.shop] = [];
    b.byShop[p.shop]!.push(p);
  }
  // Keep buckets that have at least 2 different shops represented (any pair).
  return Array.from(map.values()).filter(
    (b) => Object.keys(b.byShop).length >= 2,
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPrompt(chaldalBatch: RawProduct[], shwapnoBatch: RawProduct[]): string {
  const cList = chaldalBatch.map((p, i) => `${i + 1}. ${p.productName}`).join("\n");
  const sList = shwapnoBatch
    .map((p, i) => `${String.fromCharCode(65 + i)}. ${p.productName}`)
    .join("\n");
  return `Find ALL pairs of SAME products across two shops.

A pair is a match if:
- Same brand (Pusti = Pusti; ACI ≠ Fresh; Teer ≠ ACI)
- Same product type (soybean oil ≠ motor oil; mung dal ≠ masoor dal; turmeric ≠ chili)
- Same pack size (already same within this batch)

IMPORTANT: Minor wording differences DO NOT prevent a match. Treat as a match:
- "Pusti Fortified Soyabean Oil" matches "Pusti Soyabean Oil" (Fortified is a descriptor)
- "Teer Premium Sugar" matches "Teer Sugar" (Premium is a descriptor)
- "Marks Full Cream Milk Powder (Foil Pack)" matches "Marks Full Cream Milk Powder" (Foil Pack is packaging)

HOWEVER: Product SUB-TYPES are DIFFERENT products and must NEVER be matched together:
- "Extra Virgin Olive Oil" ≠ "Olive Oil" (different oil grade)
- "Pomace Olive Oil" ≠ "Extra Virgin Olive Oil"
- "Brown Rice" ≠ "White Rice"
- "Basmati Rice" ≠ "Miniket Rice" ≠ "Najirshail Rice" ≠ "Chinigura Rice"
- "Iodized Salt" ≠ "Rock Salt"
- "Mustard Oil" ≠ "Olive Oil" ≠ "Soybean Oil" ≠ "Sunflower Oil"
- "Mung Dal" ≠ "Masoor Dal" ≠ "Khesari Dal" ≠ "Anchor Dal"
- "Boiled Rice" ≠ "Raw Rice" (different processing)
- "Skin On Chicken" ≠ "Skinless Chicken"
- "Full Cream Milk" ≠ "Skim Milk"

If two products differ in sub-type but share brand+size, DO NOT pair them.

LIST A (Chaldal):
${cList}

LIST B (Shwapno):
${sList}

List ALL matching pairs as <A-num>=<B-letter>, one per line. If none match, output: none

Answer:`;
}

interface ChatResponse {
  choices?: { message?: { content?: string; reasoning_content?: string } }[];
}

async function callLLM(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: LLM_MAX_TOKENS,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const json = (await res.json()) as ChatResponse;
    // Prefer the clean `content` (final answer); fall back to `reasoning_content`
    // if the model put everything there. -thinking models split the two.
    return (
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.message?.reasoning_content ||
      ""
    );
  } finally {
    clearTimeout(timer);
  }
}

function parsePairs(reply: string, cMax: number, sMax: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (/^\s*none\s*$/im.test(reply.trim())) return out;
  // Accept "1=A", "A1=A", "A1=B.A", "1 = A", "1=B" (case-insensitive).
  // Tolerant of "A." or "B." prefixes the thinking model sometimes adds.
  const re = /(?:^|[^A-Za-z0-9])A?\.?\s*(\d+)\s*=\s*B?\.?\s*([A-Z])(?:[^A-Za-z]|$)/gi;
  const seenC = new Set<number>();
  const seenS = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    const c = parseInt(m[1], 10);
    const s = m[2].toUpperCase().charCodeAt(0) - 65;
    if (c < 1 || c > cMax || s < 0 || s >= sMax) continue;
    if (seenC.has(c) || seenS.has(s)) continue;
    seenC.add(c);
    seenS.add(s);
    out.push([c - 1, s]);
  }
  return out;
}

interface PairResult {
  bucket: Bucket;
  shopA: Shop;
  shopB: Shop;
  pairs: Array<[number, number]>; // indexes within bucket.byShop[shopA/B]
}

async function processBucketPair(
  bucket: Bucket,
  shopA: Shop,
  shopB: Shop,
): Promise<PairResult> {
  const a = bucket.byShop[shopA] ?? [];
  const b = bucket.byShop[shopB] ?? [];
  const allPairs: Array<[number, number]> = [];
  const aChunks = chunk(a, MAX_PER_SHOP_PER_BATCH);
  const bChunks = chunk(b, MAX_PER_SHOP_PER_BATCH);

  let aOffset = 0;
  for (const aBatch of aChunks) {
    let bOffset = 0;
    for (const bBatch of bChunks) {
      const reply = await callLLM(buildPrompt(aBatch, bBatch));
      const localPairs = parsePairs(reply, aBatch.length, bBatch.length);
      for (const [ai, bi] of localPairs) {
        allPairs.push([aOffset + ai, bOffset + bi]);
      }
      bOffset += bBatch.length;
    }
    aOffset += aBatch.length;
  }
  return { bucket, shopA, shopB, pairs: allPairs };
}

function brandTokens(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function brandsCompatible(a: string | null, b: string | null): boolean {
  const aT = brandTokens(a);
  const bT = brandTokens(b);
  // Both empty → ambiguous, reject (LLM shouldn't be making brandless matches).
  if (aT.size === 0 || bT.size === 0) return false;
  // Require at least one shared brand token.
  for (const t of aT) if (bT.has(t)) return true;
  return false;
}

function pairsToMatchGroups(results: PairResult[]): MatchGroup[] {
  const groups: MatchGroup[] = [];
  let rejected = 0;
  for (const { bucket, shopA, shopB, pairs } of results) {
    const aList = bucket.byShop[shopA] ?? [];
    const bList = bucket.byShop[shopB] ?? [];
    for (const [ai, bi] of pairs) {
      const ap = aList[ai];
      const bp = bList[bi];
      if (!ap || !bp) continue;
      // Brand sanity check — LLM occasionally pairs same-size/same-category
      // products with completely different brands. Require at least one
      // shared brand token.
      if (!brandsCompatible(ap.brand, bp.brand)) {
        rejected++;
        continue;
      }
      const sn = normalizeSize(ap.packSize);
      const aPrice = typeof ap.price === "number" ? ap.price : Infinity;
      const bPrice = typeof bp.price === "number" ? bp.price : Infinity;
      const cheapest = aPrice <= bPrice ? ap : bp;
      const offers: { [K in Shop]?: RawProduct[] } = {};
      offers[shopA] = [ap];
      offers[shopB] = [bp];
      groups.push({
        key: `llm:${bucket.category}|${bucket.size}|${shopA}:${ap.shopProductId}|${shopB}:${bp.shopProductId}`,
        brand: ap.brand ?? bp.brand,
        sizeDisplay: sn.display,
        asGrams: sn.asGrams,
        asMl: sn.asMl,
        asPieces: sn.asPieces,
        variety: null,
        category: ap.category,
        offers,
        cheapestPrice: typeof cheapest.price === "number" ? cheapest.price : null,
        cheapestShop: cheapest.shop,
      });
    }
  }
  return groups;
}

export interface LLMMatchOptions {
  onProgress?: (msg: string) => void;
}

// Split a deterministic group that has multiple Chaldal AND multiple Shwapno
// products (same brand+size+variety but distinct SKUs) into separate 1:1 rows
// using the LLM to figure out which Chaldal matches which Shwapno.
export async function splitMultiSkuWithLLM(
  groups: MatchGroup[],
  opts: LLMMatchOptions = {},
): Promise<MatchGroup[]> {
  const clean: MatchGroup[] = [];
  const multiSku: MatchGroup[] = [];
  for (const g of groups) {
    const c = (g.offers.chaldal ?? []).length;
    const s = (g.offers.shwapno ?? []).length;
    if (c <= 1 && s <= 1) clean.push(g);
    else multiSku.push(g);
  }
  if (multiSku.length === 0) return clean;
  opts.onProgress?.(
    `Multi-SKU split: ${multiSku.length} groups to disambiguate via LLM`,
  );

  // Worker pool over the multi-SKU groups.
  const queue = [...multiSku];
  const split: MatchGroup[] = [];
  let done = 0;
  async function worker() {
    while (queue.length > 0) {
      const g = queue.shift();
      if (!g) return;
      try {
        const subgroups = await splitOneGroup(g);
        split.push(...subgroups);
      } catch (err) {
        opts.onProgress?.(
          `  ! split failed for ${g.brand} ${g.sizeDisplay}: ${(err as Error).message}`,
        );
        // Fall back: keep the original group (lumped) so we don't lose data
        split.push(g);
      }
      done++;
      if (done % 5 === 0 || done === multiSku.length) {
        opts.onProgress?.(`  · ${done}/${multiSku.length} multi-SKU groups split`);
      }
    }
  }
  await Promise.all(Array.from({ length: LLM_CONCURRENCY }, () => worker()));
  return [...clean, ...split];
}

function buildSplitPrompt(c: RawProduct[], s: RawProduct[]): string {
  // Tighter prompt for the multi-SKU split task: brand+size are ALREADY the
  // same, the model only has to align sub-types between the two lists.
  const cList = c.map((p, i) => `${i + 1}. ${p.productName}`).join("\n");
  const sList = s
    .map((p, i) => `${String.fromCharCode(65 + i)}. ${p.productName}`)
    .join("\n");
  return `These two lists contain the same brand and same pack size, but different sub-types of the product. Pair each Chaldal item with the Shwapno item that is the SAME sub-type.

Sub-type examples (NEVER mix these):
- "Extra Virgin Olive Oil" ≠ "Olive Oil" (different oil grades)
- "Pomace Olive Oil" ≠ "Extra Virgin Olive Oil"
- "Boiled Rice" ≠ "Raw Rice"
- "Skin On" ≠ "Skinless"
- "Whole Wheat" ≠ "White"
- "Iodized" ≠ "Rock"
- "Full Cream" ≠ "Skim"
- different rice varieties (Miniket / Najirshail / Chinigura) never mix

LIST A (Chaldal):
${cList}

LIST B (Shwapno):
${sList}

For each Chaldal item, output one pair as <number>=<letter>. If a Chaldal item has no matching Shwapno sub-type, omit it. If nothing matches, output: none

Answer:`;
}

async function splitOneGroup(g: MatchGroup): Promise<MatchGroup[]> {
  const c = g.offers.chaldal ?? [];
  const s = g.offers.shwapno ?? [];
  // Same brand+size in this group — LLM picks 1:1 pairs from the SKU
  // descriptors that remain in the product names (Extra Virgin vs regular,
  // Skin On vs Skinless, Boiled vs Raw, etc.).
  const reply = await callLLM(buildSplitPrompt(c, s));
  const pairs = parsePairs(reply, c.length, s.length);
  const out: MatchGroup[] = [];
  let subIdx = 0;
  const usedC = new Set<number>();
  const usedS = new Set<number>();
  for (const [ci, si] of pairs) {
    const cp = c[ci];
    const sp = s[si];
    if (!cp || !sp) continue;
    usedC.add(ci);
    usedS.add(si);
    const cheapest =
      (typeof cp.price === "number" ? cp.price : Infinity) <=
      (typeof sp.price === "number" ? sp.price : Infinity)
        ? cp
        : sp;
    out.push({
      ...g,
      key: `${g.key}|sub${subIdx++}|${cp.shopProductId}|${sp.shopProductId}`,
      offers: { chaldal: [cp], shwapno: [sp] },
      cheapestPrice: typeof cheapest.price === "number" ? cheapest.price : null,
      cheapestShop: cheapest.shop,
    });
  }
  // If the LLM produced ZERO pairs for a multi-SKU group, we can't safely
  // display it — the price gap would mix unrelated prices. Drop it rather
  // than show misleading numbers. (Caller can retry with a bigger model.)
  return out;
}

export async function findLLMMatches(
  products: RawProduct[],
  excludeKeys: Set<string>,
  opts: LLMMatchOptions = {},
): Promise<MatchGroup[]> {
  // Strip out products already in deterministic match groups (excludeKeys) so
  // we only spend LLM budget on the unmatched remainder. Identify products by
  // a shop-scoped id.
  const remaining = products.filter(
    (p) => !excludeKeys.has(`${p.shop}:${p.shopProductId}`),
  );
  opts.onProgress?.(
    `LLM-match pass: ${remaining.length} unmatched products (${products.length - remaining.length} already paired deterministically)`,
  );

  const buckets = bucketize(remaining);
  opts.onProgress?.(
    `Bucketed into ${buckets.length} (category × size) buckets with ≥2 shops present`,
  );

  // Build a flat list of (bucket, shopA, shopB) work items — one per pair of
  // shops co-present in each bucket.
  type Work = { bucket: Bucket; a: Shop; b: Shop };
  const work: Work[] = [];
  for (const b of buckets) {
    for (const [a, c] of SHOP_PAIRS) {
      const aN = (b.byShop[a] ?? []).length;
      const cN = (b.byShop[c] ?? []).length;
      if (aN > 0 && cN > 0) work.push({ bucket: b, a, b: c });
    }
  }
  opts.onProgress?.(
    `${work.length} (bucket × shop-pair) work items to send to LLM`,
  );

  // Worker pool over work items
  const queue = [...work];
  const results: PairResult[] = [];
  let done = 0;
  async function worker() {
    while (queue.length > 0) {
      const w = queue.shift();
      if (!w) return;
      try {
        const r = await processBucketPair(w.bucket, w.a, w.b);
        results.push(r);
        done++;
        if (done % 20 === 0 || done === work.length) {
          opts.onProgress?.(
            `  · ${done}/${work.length} work items done (${results.reduce((a, r) => a + r.pairs.length, 0)} raw pairs)`,
          );
        }
      } catch (err) {
        opts.onProgress?.(
          `  ! ${w.a}↔${w.b} ${w.bucket.category}|${w.bucket.size} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: LLM_CONCURRENCY }, () => worker()));

  const groups = pairsToMatchGroups(results);
  opts.onProgress?.(
    `LLM-match pass: produced ${groups.length} new match groups (after brand sanity check)`,
  );
  return groups;
}
