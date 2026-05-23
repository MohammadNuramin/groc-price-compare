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

// Keyword-based category inference for products that come in via the no-filter
// Chaldal sweep (where the API doesn't echo back a category label). Order
// matters: more specific rules first so "chocolate chip cookie" lands in
// Biscuits rather than Chocolate.
const CATEGORY_RULES: Array<{ keywords: RegExp; category: string }> = [
  // Specific staples we already have category labels for
  { keywords: /\b(soybean|soyabean|mustard|sunflower|olive|coconut|rice bran)\s+oil\b/i, category: "Oil" },
  { keywords: /\bghee\b/i, category: "Ghee" },
  { keywords: /\b(masoor|moshur|mung|moog|khesari|chola|chana|chickpea|anchor|lentil|dal|daal|pulse)\b/i, category: "Lentils" },
  { keywords: /\b(miniket|najirshail|chinigura|basmati|jeerashail|banglamati|kalijira|polao|pulao|brown rice|paddy)\b/i, category: "Rice" },
  { keywords: /\b(atta|maida|suji|semolina|besan|whole wheat|flour)\b/i, category: "Flour" },
  { keywords: /\bsugar|misri\b/i, category: "Sugar" },
  { keywords: /\b(iodized|rock|sea|himalayan)?\s*salt\b/i, category: "Salt" },
  { keywords: /\b(turmeric|holud|chili|chilli|cumin|coriander|dhonia|jira|cinnamon|cardamom|elaichi|cloves|laung|fennel|mouri|garam masala|spice|seasoning|paprika|black pepper|gol morich)\b/i, category: "Spices" },
  { keywords: /\b(egg|eggs)\b/i, category: "Eggs" },
  { keywords: /\b(milk powder|powder milk|condensed milk|evaporated milk|cheese|butter|yogurt|dahi|paneer|whipping cream)\b/i, category: "Dairy" },
  { keywords: /\b(broiler|chicken|beef|mutton|lamb|duck|turkey|sausage|bacon|ham)\b/i, category: "Meat" },
  { keywords: /\b(rui|katla|ilish|hilsha|tilapia|pangas|magur|koi|prawn|shrimp|crab|tuna|salmon|sardine|fish)\b/i, category: "Fish" },
  { keywords: /\b(potato|onion|garlic|ginger|tomato|cucumber|carrot|cabbage|cauliflower|spinach|brinjal|eggplant|pumpkin|okra|lemon|lime|coriander leaf|mint)\b/i, category: "Fresh Vegetables" },
  { keywords: /\b(apple|banana|orange|mango|grape|watermelon|pineapple|strawberry|guava|papaya|pomegranate|kiwi|pear|peach|plum|berry|dragon fruit)\b/i, category: "Fresh Fruits" },
  // Drinks
  { keywords: /\b(tea bag|black tea|green tea|oolong|herbal tea|tea leaf)\b/i, category: "Tea" },
  { keywords: /\b(coffee|nescafe|espresso|cappuccino|latte)\b/i, category: "Tea" },
  { keywords: /\b(juice|nectar|drink|soda|cola|pepsi|sprite|fanta|7up|mountain dew|mojito|smoothie|squash|energy drink|sports drink|mineral water|drinking water|coconut water)\b/i, category: "Beverages" },
  // Snacks, sweets
  { keywords: /\b(chocolate|candy|toffee|lollipop|gum|mint|kitkat|snickers|mars|bounty|twix|m&m|gummy)\b/i, category: "Chocolate" },
  { keywords: /\b(biscuit|cookie|cracker|wafer|rusk)\b/i, category: "Biscuits" },
  { keywords: /\b(chips|kurkure|popcorn|namkeen|bhujia|mixture|chanachur|jhuri|cheese ball)\b/i, category: "Snacks" },
  { keywords: /\b(noodle|pasta|spaghetti|macaroni|ramen|maggi|lasagna|vermicelli|sevia|semai)\b/i, category: "Noodles" },
  // Sauces and spreads
  { keywords: /\b(ketchup|mayo|mayonnaise|sauce|vinegar|chutney|pickle|achar|jam|jelly|marmalade|honey|spread|peanut butter|nutella)\b/i, category: "Sauces" },
  // Frozen
  { keywords: /\b(frozen|paratha|samosa|spring roll|nugget|patty|tikka|kebab|mom\b|momo|ice cream|popsicle|ice lolly)\b/i, category: "Frozen Foods" },
  // Breakfast
  { keywords: /\b(oats|oatmeal|cornflake|cereal|muesli|granola|porridge|breakfast bar|chocomalt|complan|horlicks)\b/i, category: "Breakfast" },
  // Baby
  { keywords: /\b(baby|infant|cerelac|similac|nan\b|lactogen|farex|nestum|gerber|diaper|pampers|huggies|wipes)\b/i, category: "Baby Food" },
  // Personal care
  { keywords: /\b(shampoo|conditioner|hair oil|hair color|hair cream|hair gel|hair spray|hair mask)\b/i, category: "Personal Care" },
  { keywords: /\b(soap|body wash|hand wash|face wash|shower gel|loofah|bath salt)\b/i, category: "Personal Care" },
  { keywords: /\b(toothpaste|toothbrush|mouthwash|dental floss|dental)\b/i, category: "Personal Care" },
  { keywords: /\b(deodorant|antiperspirant|perfume|cologne|body spray|body mist|talcum|powder body)\b/i, category: "Personal Care" },
  { keywords: /\b(lotion|moisturizer|sunscreen|sunblock|face cream|night cream|day cream|serum|face mask|toner|cleanser|scrub|exfoliator|petroleum jelly|vaseline)\b/i, category: "Personal Care" },
  { keywords: /\b(razor|shaving|after shave|beard|trimmer|epilator|hair removal|wax strip)\b/i, category: "Personal Care" },
  { keywords: /\b(sanitary|pad|tampon|panty liner|menstrual)\b/i, category: "Personal Care" },
  { keywords: /\b(makeup|cosmetic|lipstick|lip balm|chapstick|mascara|eyeliner|foundation|concealer|blush|nail polish|nail file|kajal)\b/i, category: "Personal Care" },
  { keywords: /\b(hand sanitizer|hand cream|antibacterial)\b/i, category: "Personal Care" },
  // Household
  { keywords: /\b(detergent|laundry|fabric softener|stain remover|bleach|surf|rin|tide|wheel)\b/i, category: "Household" },
  { keywords: /\b(dishwash|dish soap|vim|dishwasher)\b/i, category: "Household" },
  { keywords: /\b(floor cleaner|toilet cleaner|surface cleaner|all purpose cleaner|harpic|lizol|domex|colin|odonil)\b/i, category: "Household" },
  { keywords: /\b(mosquito|insect|cockroach|rat killer|pest control|odomos|good knight|mortein|hit)\b/i, category: "Household" },
  { keywords: /\b(tissue|toilet paper|paper towel|kitchen roll|napkin)\b/i, category: "Household" },
  { keywords: /\b(garbage bag|trash bag|cling film|aluminum foil|baking paper|zip lock|food container)\b/i, category: "Household" },
  { keywords: /\b(air freshener|room freshener|incense|agarbatti|candle|matchbox|lighter|battery)\b/i, category: "Household" },
  { keywords: /\b(broom|mop|bucket|sponge|scrubber|brush|duster|gloves|wiper)\b/i, category: "Household" },
  // Cooking
  { keywords: /\b(yeast|baking powder|baking soda|vanilla essence|food color|cocoa powder|gelatin|corn flour|custard|icing sugar)\b/i, category: "Flour" },
];

export function inferCategoryFromName(name: string): string | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(name)) return rule.category;
  }
  return null;
}
