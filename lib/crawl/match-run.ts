import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CrawlSnapshot, RawProduct } from "./types";
import { buildMatchGroups, type MatchGroup } from "./match";
import { findLLMMatches, splitMultiSkuWithLLM } from "./match-llm";

const SNAPSHOT_PATH = "data/all-products.json";
const MATCHES_PATH = "data/matches.json";

interface MatchesSnapshot {
  matchedAt: string;
  llmModel: string | null;
  llmBaseUrl: string | null;
  totals: { deterministic: number; llm: number; combined: number };
  groups: MatchGroup[];
}

async function main() {
  const startedAt = Date.now();
  const raw = await readFile(SNAPSHOT_PATH, "utf8");
  const snapshot = JSON.parse(raw) as CrawlSnapshot;
  console.log(`Loaded crawl: ${snapshot.products.length} products`);

  // Phase 1: deterministic bucketing by brand+size+variety+category. Same
  // brand+size buckets may still contain multiple distinct SKUs (e.g., Extra
  // Virgin vs regular Olio Orolio 5L).
  const rawDetGroups = buildMatchGroups(snapshot.products);
  console.log(`Deterministic groups (pre-split): ${rawDetGroups.length}`);

  // Phase 2: LLM splits multi-SKU groups into 1:1 pairs by name semantics.
  const detGroups = await splitMultiSkuWithLLM(rawDetGroups, {
    onProgress: (msg) => console.log(msg),
  });
  console.log(`Deterministic matches (after split): ${detGroups.length}`);

  // Phase 3: LLM-augmented matching for remaining unmatched products.
  const excludeKeys = new Set<string>();
  for (const g of detGroups) {
    for (const offers of Object.values(g.offers)) {
      for (const o of offers ?? []) excludeKeys.add(`${o.shop}:${o.shopProductId}`);
    }
  }

  const llmGroups = await findLLMMatches(snapshot.products as RawProduct[], excludeKeys, {
    onProgress: (msg) => console.log(msg),
  });

  // Dedupe: if a deterministic group already covers a (chaldal_id, shwapno_id)
  // pair, drop any LLM group with the same pair.
  const detPairs = new Set<string>();
  for (const g of detGroups) {
    const cIds = (g.offers.chaldal ?? []).map((o) => o.shopProductId);
    const sIds = (g.offers.shwapno ?? []).map((o) => o.shopProductId);
    for (const c of cIds) for (const s of sIds) detPairs.add(`${c}::${s}`);
  }
  const filteredLlm = llmGroups.filter((g) => {
    const cId = g.offers.chaldal?.[0]?.shopProductId;
    const sId = g.offers.shwapno?.[0]?.shopProductId;
    return !(cId && sId && detPairs.has(`${cId}::${sId}`));
  });

  const combined = [...detGroups, ...filteredLlm];

  const out: MatchesSnapshot = {
    matchedAt: new Date().toISOString(),
    llmModel: process.env.LLM_MODEL ?? "gemma-4-8b",
    llmBaseUrl: process.env.LLM_BASE_URL ?? "http://localhost:8200/v1",
    totals: {
      deterministic: detGroups.length,
      llm: filteredLlm.length,
      combined: combined.length,
    },
    groups: combined,
  };

  await mkdir(dirname(MATCHES_PATH), { recursive: true });
  await writeFile(MATCHES_PATH, JSON.stringify(out, null, 2), "utf8");

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nDone in ${elapsed}s — det=${detGroups.length} + llm=${filteredLlm.length} = ${combined.length} combined matches. Wrote ${MATCHES_PATH}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
