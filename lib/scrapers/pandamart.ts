import type { ScrapedOffer } from "../types";

const VENDOR_CODE = process.env.PANDAMART_VENDOR_CODE ?? "w2lx";
const VENDOR_URL = `https://www.foodpanda.com.bd/darkstore/${VENDOR_CODE}/pandamart`;

interface PandamartProduct {
  id?: string;
  name?: string;
  description?: string;
  price?: number;
  originalPrice?: number;
  isAvailable?: boolean;
  unitPricingInfo?: { quantity?: number; unit?: string };
  parentId?: string;
}

interface PreloadedState {
  products?: Record<string, PandamartProduct> | PandamartProduct[];
}

let cache: { products: PandamartProduct[]; fetchedAt: number } | null = null;
let loadingPromise: Promise<PandamartProduct[]> | null = null;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function scoreMatch(query: string, name: string): number {
  const qTokens = tokenize(query);
  const nTokens = new Set(tokenize(name));
  if (qTokens.length === 0) return 0;
  let hits = 0;
  for (const t of qTokens) if (nTokens.has(t)) hits++;
  return hits / qTokens.length;
}

async function loadPandamartCatalog(): Promise<PandamartProduct[]> {
  if (cache && Date.now() - cache.fetchedAt < 10 * 60 * 1000) {
    return cache.products;
  }
  if (loadingPromise) return loadingPromise;

  loadingPromise = doLoad().finally(() => {
    loadingPromise = null;
  });
  return loadingPromise;
}

async function doLoad(): Promise<PandamartProduct[]> {
  const { launch } = (await import("cloakbrowser")) as typeof import("cloakbrowser");

  const proxy = process.env.CLOAKBROWSER_PROXY;
  const launchOpts: Record<string, unknown> = { headless: true, humanize: true };
  if (proxy) {
    launchOpts.proxy = proxy;
    launchOpts.geoip = true;
  }

  const browser = await launch(launchOpts);
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });
    const page = await context.newPage();

    await page.goto(VENDOR_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    try {
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { __PRELOADED_STATE__?: unknown }).__PRELOADED_STATE__ !==
          "undefined",
        { timeout: 45_000 },
      );
    } catch (waitErr) {
      const diag = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        bodyStart: (document.body?.innerText || "").slice(0, 400),
        hasCaptcha: !!document.querySelector(".px-captcha-error,[id*=captcha],[class*=captcha]"),
        scriptMarkers: Array.from(document.scripts)
          .map((s) => s.text.slice(0, 80))
          .filter((t) => t.includes("__PRELOADED") || t.includes("_px"))
          .slice(0, 3),
      }));
      throw new Error(
        `Pandamart: __PRELOADED_STATE__ not found. URL=${diag.url} TITLE="${diag.title}" CAPTCHA=${diag.hasCaptcha} BODY="${diag.bodyStart.replace(/\n/g, " | ")}"`,
      );
    }

    const state = (await page.evaluate(
      () => (window as unknown as { __PRELOADED_STATE__: PreloadedState }).__PRELOADED_STATE__,
    )) as PreloadedState;

    let products: PandamartProduct[] = [];
    if (Array.isArray(state.products)) {
      products = state.products.filter((p): p is PandamartProduct => Boolean(p?.name));
    } else if (state.products && typeof state.products === "object") {
      products = Object.values(state.products).filter(
        (p): p is PandamartProduct => Boolean(p?.name),
      );
    }

    if (products.length === 0) {
      throw new Error("Pandamart: __PRELOADED_STATE__ present but no products parsed");
    }

    cache = { products, fetchedAt: Date.now() };
    return products;
  } finally {
    await browser.close();
  }
}

export async function prefetchPandamart(): Promise<{ count: number }> {
  const products = await loadPandamartCatalog();
  return { count: products.length };
}

export async function searchPandamart(query: string): Promise<ScrapedOffer | null> {
  const products = await loadPandamartCatalog();
  if (products.length === 0) return null;

  let best: { product: PandamartProduct; score: number } | null = null;
  for (const p of products) {
    if (!p || !p.name) continue;
    const s = scoreMatch(query, p.name);
    if (s > 0 && (!best || s > best.score)) {
      best = { product: p, score: s };
    }
  }

  if (!best || best.score < 0.5) return null;
  const p = best.product;

  return {
    shop: "pandamart",
    productName: p.name ?? "",
    brand: null,
    packSize:
      p.unitPricingInfo?.quantity && p.unitPricingInfo?.unit
        ? `${p.unitPricingInfo.quantity}${p.unitPricingInfo.unit}`
        : null,
    price: typeof p.price === "number" ? p.price : null,
    originalPrice: typeof p.originalPrice === "number" ? p.originalPrice : null,
    available: p.isAvailable !== false,
    url: VENDOR_URL,
  };
}
