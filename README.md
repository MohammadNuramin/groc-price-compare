# BD Grocery Price Compare

A full-website price comparison tool for Bangladeshi online grocery shops. Crawls the entire catalog of [Chaldal](https://chaldal.com/) and [Shwapno](https://www.shwapno.com/), then uses an LLM (Gemma 4 8B Thinking) to find cross-shop SKU matches and split ambiguous brand+size groups into clean apples-to-apples comparisons.

## Features

- **Full-catalog crawl** — ~4,400+ products across ~25 categories from two of Bangladesh's largest online grocers
- **LLM-assisted matching** — Gemma 4 disambiguates products like "Extra Virgin Olive Oil" vs "Olive Oil" within the same brand+size, and finds cross-shop pairs that fuzzy string matching would miss
- **Three match qualities** — strict deterministic (same brand string + normalized size + variety), LLM-augmented (handles wording variance like "Fortified" descriptors and "(Foil Pack)" suffixes), and a brand-token sanity check that rejects spurious LLM matches
- **Honest UI** — "LOWEST" only when one shop is strictly cheaper; "SAME PRICE" when shops tie; "ambiguous" when a row groups multiple SKUs that can't be cleanly split
- **Two browse modes** — cross-shop matches sorted by biggest savings, or browse all 4,400+ raw products with shop/category/search filters
- **Fast** — parallel async crawl in ~45 seconds; matching in 4–5 minutes with 16 LLM workers

## Architecture

```
┌─────────────────┐        ┌─────────────────┐
│   Chaldal API   │        │   Shwapno API   │
│ catalog.chaldal │        │ shwapno.com/api │
└────────┬────────┘        └────────┬────────┘
         │ paginated category fetch │
         └────────────┬─────────────┘
                      ▼
              ┌───────────────┐
              │  Full crawl   │
              │ ~4,400 SKUs   │  →  data/all-products.json
              └───────┬───────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
┌──────────────┐           ┌─────────────────┐
│ Deterministic│           │  LLM matcher    │
│  bucketing   │           │ Gemma 4 8B-Th.  │
│ brand+size+  │           │ vLLM endpoint   │
│   variety    │◄──────────│  16 workers     │
└──────┬───────┘           └────────┬────────┘
       │  multi-SKU buckets         │ cross-shop
       │  to LLM for splitting      │ pair discovery
       └────────────┬───────────────┘
                    ▼
        ┌───────────────────────┐
        │  Brand-token sanity   │  →  data/matches.json
        │       check           │
        └───────────┬───────────┘
                    ▼
        ┌───────────────────────┐
        │  Next.js App Router   │
        │  /api/products        │
        │  /api/matches         │
        │  / (browse UI)        │
        └───────────────────────┘
```

## Tech stack

- **Next.js 15** (App Router, TypeScript, Tailwind)
- **Node 22** (built-in `fetch`)
- **Docker Compose** — `web` service (Next.js dev server) and a one-shot tool runner for crawl/match commands
- **vLLM** — serves Gemma 4 8B Thinking on an external OpenAI-compatible endpoint (configurable via `LLM_BASE_URL`)
- No headless browser, no Playwright dependency — pure HTTP + JSON APIs for both shops

## Setup

Prereqs: Docker + access to an OpenAI-compatible LLM endpoint (e.g. a local vLLM server serving any Gemma 4 / Llama / Qwen 3 thinking model).

```bash
git clone <this-repo-url>
cd groc-price-compare
docker compose build web
```

Configure the LLM endpoint in `docker-compose.yml` (or pass via `-e` flags). Defaults assume a vLLM server at `http://localhost:8200/v1` serving a model named `gemma-4-8b-thinking`.

## Usage

```bash
# 1. Crawl both shops (~45 seconds, no LLM)
docker compose run --rm web npm run crawl

# 2. Match products across shops (~4–5 minutes with LLM)
docker compose run --rm \
    -e LLM_BASE_URL=http://your-llm:8200/v1 \
    -e LLM_MODEL=gemma-4-8b-thinking \
    -e LLM_CONCURRENCY=16 \
    web npm run match

# 3. Start the web UI
docker compose up -d web
# → open http://localhost:3000
```

Outputs (gitignored):
- `data/all-products.json` — raw crawl, ~4 MB
- `data/matches.json` — cross-shop matches, ~200 KB

## Configuration (env vars)

| Var | Default | Description |
|---|---|---|
| `LLM_BASE_URL` | `http://localhost:8200/v1` | OpenAI-compatible LLM endpoint |
| `LLM_MODEL` | `gemma-4-8b-thinking` | Model name as served by the LLM |
| `LLM_CONCURRENCY` | `16` | Parallel LLM workers |
| `LLM_TIMEOUT_MS` | `60000` | Per-request timeout |
| `LLM_MAX_TOKENS` | `2048` | Max tokens per LLM call |
| `SKIP_PANDAMART` | `1` | Skip the Pandamart/Foodpanda scraper (PerimeterX-blocked from datacenter IPs) |
| `SCRAPE_CONCURRENCY` | `8` | Parallel workers for the legacy per-item scraper |

## Matching approach

The matcher runs in three phases:

1. **Deterministic bucketing** (`lib/crawl/match.ts`) groups products by `category | variety | lowercase_brand | unit | qty`. Same-brand-same-size pairs across shops fall into the same bucket. Variety hints (Miniket vs Najirshail vs Chinigura rice; Extra Virgin vs Pomace olive oil) keep distinct sub-types apart.

2. **LLM multi-SKU split** (`lib/crawl/match-llm.ts` → `splitMultiSkuWithLLM`) takes buckets that still have multiple Chaldal AND multiple Shwapno products (e.g., a brand carrying both Extra Virgin and regular Olive Oil at 5L) and asks the LLM to pair Chaldal[i] ↔ Shwapno[j]. If the LLM produces no pairs, the bucket is dropped (better to show nothing than misleading prices).

3. **LLM cross-shop matching** (`findLLMMatches`) takes products that didn't match deterministically and groups them by `(canonical_category, normalized_size)`. For each bucket with both Chaldal + Shwapno products, the LLM proposes pairs. A **brand-token sanity check** then rejects pairs whose extracted brands share no token (catches "Radhuni Mustard Oil" being mis-paired with "KENT Pomace Olive Oil").

Brand and pack size are extracted from product names heuristically (first capitalized tokens up to a descriptor word like "Fortified"/"Premium"; regex on `1kg`/`500g`/`1ltr`/`200ml`/`12 pcs`). The LLM also emits its own brand opinion alongside each match pair, which is used as a fallback.

## Project layout

```
.
├── app/
│   ├── page.tsx                 # Server component: loads snapshot, renders shell
│   ├── BrowseView.tsx           # Client component: tabs, search, filters, tables
│   ├── api/products/route.ts    # Paginated raw product listing
│   ├── api/matches/route.ts     # Cross-shop match groups, sorted by savings
│   └── api/prices/route.ts      # (Legacy) curated catalog comparison
├── lib/
│   ├── crawl/
│   │   ├── chaldal.ts           # Chaldal full-category crawl
│   │   ├── shwapno.ts           # Shwapno full-category crawl (discovers catalogIds from HTML)
│   │   ├── extract.ts           # Heuristic brand + size + variety extractor
│   │   ├── match.ts             # Deterministic same-brand-same-size grouping
│   │   ├── match-llm.ts         # LLM-assisted multi-SKU split + cross-shop matching
│   │   ├── run.ts               # `npm run crawl` entrypoint
│   │   └── match-run.ts         # `npm run match` entrypoint
│   ├── scrapers/                # (Legacy) per-item scrapers from the v1 catalog approach
│   ├── catalog.ts               # (Legacy) curated catalog of 20 commodities
│   ├── loadCrawl.ts             # Cached file loader for the web UI
│   └── types.ts                 # Shared types
├── data/                        # (Gitignored) generated outputs
├── Dockerfile                   # node:22-bookworm-slim + Chromium deps (for legacy CloakBrowser path)
└── docker-compose.yml
```

## Caveats and known issues

- **Pandamart (Foodpanda) is excluded** by default. Their CDN uses PerimeterX with a "Press & Hold" challenge that blocks datacenter IPs regardless of TLS fingerprint or browser stealth. CloakBrowser support is wired (`lib/scrapers/pandamart.ts`) and works if you supply a residential proxy via `CLOAKBROWSER_PROXY`, but without one Pandamart will always serve a captcha page.
- **Chaldal category coverage is incomplete.** The crawler iterates a hand-picked list of Chaldal category IDs (`lib/crawl/chaldal.ts:CHALDAL_CATEGORIES`); IDs that don't exist on Chaldal return 0 results silently. Pull more IDs from your browser's network tab on `chaldal.com` to extend coverage.
- **Heuristic brand extraction is imperfect.** Products without a clear brand prefix (generic vegetables, eggs labeled by farm) get an extracted "brand" that's actually a descriptor. These mostly self-correct in matching since both shops use similar descriptors.
- **LLM matching is non-deterministic** at high concurrency. Re-running `npm run match` can yield slightly different match counts (±5%). Stable matches dominate the noise.
- **Prices are snapshot-based**, not live. Re-run `npm run crawl` + `npm run match` to refresh.
- **Not affiliated** with Chaldal, Shwapno, or any other retailer. For personal price-checking only.

## License

MIT
