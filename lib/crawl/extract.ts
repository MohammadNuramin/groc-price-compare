// Lightweight heuristic brand + pack-size extraction from product names.
// Used during full-site crawl to avoid an LLM call per product.

const DESCRIPTOR_TOKENS = new Set([
  "fortified", "premium", "standard", "fresh", "pure", "deshi", "imported",
  "local", "extra", "virgin", "full", "cream", "instant", "any", "brand",
  "free", "half", "boiled", "raw", "with", "skin", "the", "and",
  "a", "an", "of", "for",
]);

const SIZE_REGEX =
  /(\d+(?:\.\d+)?)\s*(kg|kgs|gm|g|ml|l|ltr|litre|liter|pcs|pc|pack|pieces|piece)\b/i;

const SIZE_RANGE_REGEX = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(kg|gm|g|ml|l|ltr|litre|pcs|pc)\b/i;

const SIZE_TOLERANCE_REGEX =
  /±\s*\d+\s*(kg|gm|g|ml|l|ltr|litre)\s+(\d+(?:\.\d+)?)\s*(kg|gm|g|ml|l|ltr|litre|pcs|pc)\b/i;

function normalizeUnit(u: string): string {
  const lc = u.toLowerCase();
  if (lc === "kgs") return "kg";
  if (lc === "gm" || lc === "g") return "g";
  if (lc === "ltr" || lc === "litre" || lc === "liter" || lc === "l") return "l";
  if (lc === "ml") return "ml";
  if (lc === "pc" || lc === "pcs" || lc === "piece" || lc === "pieces" || lc === "pack") return "pcs";
  return lc;
}

export function normalizeSize(packSize: string | null): {
  display: string | null;
  asGrams: number | null;
  asMl: number | null;
  asPieces: number | null;
} {
  if (!packSize) return { display: null, asGrams: null, asMl: null, asPieces: null };

  // Strip "± 50 gm" tolerance noise, look for the real pack size after.
  const tolMatch = packSize.match(SIZE_TOLERANCE_REGEX);
  if (tolMatch) {
    const qty = parseFloat(tolMatch[2]);
    const unit = normalizeUnit(tolMatch[3]);
    return packToGrams(qty, unit, `${qty} ${unit}`);
  }

  const rangeMatch = packSize.match(SIZE_RANGE_REGEX);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]);
    const hi = parseFloat(rangeMatch[2]);
    const unit = normalizeUnit(rangeMatch[3]);
    const mid = (lo + hi) / 2;
    return packToGrams(mid, unit, `${lo}-${hi} ${unit}`);
  }

  const m = packSize.match(SIZE_REGEX);
  if (!m) return { display: packSize.trim() || null, asGrams: null, asMl: null, asPieces: null };

  const qty = parseFloat(m[1]);
  const unit = normalizeUnit(m[2]);
  return packToGrams(qty, unit, `${qty} ${unit}`);
}

function packToGrams(qty: number, unit: string, display: string) {
  if (unit === "kg") return { display, asGrams: qty * 1000, asMl: null, asPieces: null };
  if (unit === "g") return { display, asGrams: qty, asMl: null, asPieces: null };
  if (unit === "l") return { display, asGrams: null, asMl: qty * 1000, asPieces: null };
  if (unit === "ml") return { display, asGrams: null, asMl: qty, asPieces: null };
  if (unit === "pcs") return { display, asGrams: null, asMl: null, asPieces: qty };
  return { display, asGrams: null, asMl: null, asPieces: null };
}

export function extractSizeFromName(name: string): string | null {
  const tolMatch = name.match(SIZE_TOLERANCE_REGEX);
  if (tolMatch) return `${tolMatch[2]} ${normalizeUnit(tolMatch[3])}`;
  const m = name.match(SIZE_REGEX);
  if (!m) return null;
  return `${m[1]} ${normalizeUnit(m[2])}`;
}

export function extractBrand(productName: string): string | null {
  // Tokenize on whitespace; take leading capitalized tokens up to a descriptor
  // or non-letter token. Handles single-token ("Pusti") and two-token brands
  // ("ACI Pure", "Chefs Choice", "Diploma Instant" → only "Diploma" since
  // Instant is descriptor).
  const tokens = productName.split(/\s+/);
  const out: string[] = [];
  for (const tok of tokens) {
    if (!/^[A-Za-z][A-Za-z'.&-]+$/.test(tok)) break;
    if (DESCRIPTOR_TOKENS.has(tok.toLowerCase()) && out.length > 0) break;
    if (out.length >= 2) break;
    out.push(tok);
  }
  if (out.length === 0) return null;
  // Filter out cases where the "brand" is actually the product noun
  // (e.g., "Sugar" alone, "Salt" alone). If brand has only 1 token AND
  // it matches a common produce noun, return null.
  const produceNouns = new Set([
    "sugar", "salt", "oil", "rice", "flour", "atta", "maida", "potato", "onion",
    "garlic", "fish", "chicken", "beef", "egg", "eggs", "milk", "tea",
    "moshur", "mug", "mung", "masoor", "broiler", "rui", "ilish", "katla",
  ]);
  if (out.length === 1 && produceNouns.has(out[0].toLowerCase())) return null;
  return out.join(" ");
}

// Crude "what kind of product is this" — used to bucket items inside a
// category. E.g., within "Rice" category, distinguish miniket / najirshail /
// chinigura / basmati / brown.
const VARIETY_HINTS: Record<string, string[]> = {
  miniket: ["miniket", "minicate"],
  najirshail: ["najirshail", "nazirshail", "najir shail"],
  chinigura: ["chinigura", "kataribhog"],
  basmati: ["basmati"],
  banglamati: ["banglamati"],
  jeerashail: ["jeerashail", "zira shail", "zirashail"],
  brown_rice: ["brown rice"],
  polao_rice: ["polao", "pulao", "kalijira", "kalo jira"],
  soybean_oil: ["soyabean", "soybean", "soya bean"],
  sunflower_oil: ["sunflower"],
  mustard_oil: ["mustard", "sorisha"],
  olive_oil: ["olive"],
  coconut_oil: ["coconut"],
  rice_bran_oil: ["rice bran"],
  ghee: ["ghee"],
  masoor: ["masoor", "moshur", "red lentil", "red dal"],
  mung: ["mung", "moog", "mug"],
  khesari: ["khesari"],
  anchor: ["anchor"],
  chickpea: ["chola", "chickpea", "chana"],
  black_tea: ["black tea"],
  green_tea: ["green tea"],
  refined_sugar: ["refined sugar", "white sugar"],
  iodized_salt: ["iodized salt", "iodised salt"],
  rock_salt: ["rock salt", "pink salt"],
  full_cream_milk: ["full cream milk", "full-cream milk"],
  skim_milk: ["skim", "skimmed"],
  atta: ["atta"],
  maida: ["maida", "white flour"],
  suji: ["suji", "semolina"],
};

export function extractVariety(name: string): string | null {
  const lc = name.toLowerCase();
  for (const [variety, hints] of Object.entries(VARIETY_HINTS)) {
    for (const h of hints) {
      if (lc.includes(h)) return variety;
    }
  }
  return null;
}
