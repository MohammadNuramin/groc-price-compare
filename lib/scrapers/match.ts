import type { CatalogItem, ScrapedOffer } from "../types";

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:8103/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? "cyankiwi/gemma-4-26B-A4B-it-AWQ-4bit";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? "15000");

const STOPWORDS = new Set([
  "and", "or", "with", "the", "of", "for", "from", "in", "on", "at",
  "kg", "g", "gm", "ml", "l", "ltr", "litre", "liter", "pcs", "pc", "pack",
  "free", "premium", "fortified", "standard", "any", "brand",
  "imported", "local", "skin", "boiled", "half",
]);

const DESCRIPTOR_TOKENS = new Set([
  "fortified", "premium", "standard", "fresh", "pure", "deshi", "imported",
  "local", "extra", "virgin", "full", "cream", "instant", "any", "brand",
  "free", "half", "boiled", "raw", "with", "skin",
]);

function normalizeBrand(s: string | null): string | null {
  if (!s) return null;
  // Stop at the first newline / pipe / hash / quote — the model sometimes
  // emits multiple "<idx>|<brand>" lines or trailing junk.
  const firstLine = s.split(/[\n\r|#"]/, 1)[0] ?? "";
  // Strip parenthesized suffixes ("(Any Brand)") and trailing size tokens.
  const cleaned = firstLine
    .replace(/\(.*$/, "")
    .replace(/\b\d+\s*(kg|g|gm|ml|l|ltr|litre|pcs|pc)\b.*$/i, "")
    .trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  if (lower === "generic" || lower === "none" || lower === "n/a") return null;
  // Cap brand at first 4 words to avoid the model dumping the whole name.
  const words = cleaned.split(/\s+/).slice(0, 4).join(" ");
  return words;
}

function heuristicBrand(productName: string): string | null {
  // Take leading capitalized tokens until we hit a descriptor or non-letter
  // token. Handles "Pusti Fortified Soyabean Oil 1 ltr" → "Pusti" and
  // "ACI Pure Mung Dal 1kg" → "ACI Pure".
  const raw = productName.split(/\s+/);
  const out: string[] = [];
  for (const tok of raw) {
    if (!/^[A-Za-z][A-Za-z'.-]+$/.test(tok)) break;
    if (DESCRIPTOR_TOKENS.has(tok.toLowerCase()) && out.length > 0) break;
    if (out.length >= 2) break;
    out.push(tok);
  }
  return out.length > 0 ? out.join(" ") : null;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function sharesContentToken(item: CatalogItem, offerName: string): boolean {
  const itemTokens = new Set([...tokens(item.displayName), ...tokens(item.category)]);
  const offerTokens = tokens(offerName);
  for (const t of offerTokens) if (itemTokens.has(t)) return true;
  return false;
}

function formatCandidate(offer: ScrapedOffer, idx: number): string {
  const size = offer.packSize ? ` [${offer.packSize}]` : "";
  const price = typeof offer.price === "number" ? `৳${offer.price}` : "—";
  return `${idx + 1}. ${offer.productName}${size} ${price}`;
}

function buildPrompt(item: CatalogItem, candidates: ScrapedOffer[]): string {
  const list = candidates.map((c, i) => formatCandidate(c, i)).join("\n");
  return `You match grocery products across shops in Bangladesh.

CATALOG ITEM: ${item.displayName}
CATEGORY: ${item.category}

CANDIDATES from the shop:
${list}

Pick the candidate that is the SAME product (same product type, matching pack size). If no candidate is a real match, reply 0 — DO NOT force a pick.

STRICT rules — reply 0 unless ALL hold:
1. Same product type: "soybean oil" ≠ motor oil / gear oil / engine oil / body oil / hair oil. "mung dal" ≠ masoor dal. "onion 1kg" ≠ onion chips / french fry. "garlic" ≠ noodles. "turmeric" ≠ soft drink. "rui fish" ≠ dry fish powder / cat food.
2. Same pack size (or close): 1L is not 4L; 500g is not 1kg; 12 eggs is not 6 or 30.
3. Brand can differ — same product across brands is OK.
4. If only one candidate is given and it does not match, STILL reply 0.

Output format: <index>|<brand>
- <index> is 1-${candidates.length} for the chosen candidate, or 0 if no match.
- <brand> is the brand name from the chosen product (e.g., Pusti, Teer, ACI Pure, Fresh, Memory, Chefs Choice, Radhuni). Multi-word brands are OK. Leave EMPTY if no match (index=0) or if the product is generic/unbranded.

Examples of valid output:
3|Pusti
5|ACI Pure
2|Teer
0|

Reply with ONLY that one line. No explanation, no other text.`;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

function withBrand(offer: ScrapedOffer, brand: string | null): ScrapedOffer {
  const normalized = normalizeBrand(brand);
  const finalBrand = normalized ?? heuristicBrand(offer.productName);
  return { ...offer, brand: finalBrand };
}

export async function pickBestMatch(
  item: CatalogItem,
  candidates: ScrapedOffer[],
): Promise<ScrapedOffer | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const only = candidates[0];
    if (!sharesContentToken(item, only.productName)) return null;
    return withBrand(only, null);
  }

  const prompt = buildPrompt(item, candidates);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 24,
        temperature: 0,
        stop: ["\n"],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status} (model=${LLM_MODEL})`);
  }

  const json = (await res.json()) as ChatResponse;
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "";

  // Expected format: "<index>|<brand>". Tolerate "<index>" alone.
  const pipeAt = raw.indexOf("|");
  const indexPart = pipeAt >= 0 ? raw.slice(0, pipeAt) : raw;
  const brandPart = pipeAt >= 0 ? raw.slice(pipeAt + 1) : "";

  const m = indexPart.match(/-?\d+/);
  if (!m) {
    throw new Error(`LLM returned unparseable reply: ${JSON.stringify(raw)}`);
  }
  const idx = parseInt(m[0], 10);
  if (idx === 0) return null;
  if (idx < 1 || idx > candidates.length) return null;

  const picked = candidates[idx - 1];

  // Sanity check: if the LLM picked something with zero overlap to the catalog
  // item (e.g. "garlic" → "Sedaap Noodles"), override to "no match". Stops the
  // model from forcing a pick when shop search returned irrelevant results.
  if (!sharesContentToken(item, picked.productName)) return null;

  return withBrand(picked, brandPart);
}
