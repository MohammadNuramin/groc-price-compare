import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CrawlSnapshot } from "./crawl/types";
import { buildMatchGroups, type MatchGroup } from "./crawl/match";

const SNAPSHOT_PATH = join(process.cwd(), "data", "all-products.json");
const MATCHES_PATH = join(process.cwd(), "data", "matches.json");

let cached: {
  snapshot: CrawlSnapshot;
  groups: MatchGroup[];
  matchSource: "deterministic" | "deterministic+llm";
  loadedAt: number;
} | null = null;

interface MatchesSnapshot {
  matchedAt: string;
  llmModel: string | null;
  groups: MatchGroup[];
  totals: { deterministic: number; llm: number; combined: number };
}

export async function loadCrawl(): Promise<{
  snapshot: CrawlSnapshot;
  groups: MatchGroup[];
  matchSource: "deterministic" | "deterministic+llm";
} | null> {
  if (cached && Date.now() - cached.loadedAt < 60_000) {
    return {
      snapshot: cached.snapshot,
      groups: cached.groups,
      matchSource: cached.matchSource,
    };
  }
  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf8");
    const snapshot = JSON.parse(raw) as CrawlSnapshot;

    // Prefer matches.json (deterministic + LLM) if present.
    let groups: MatchGroup[];
    let matchSource: "deterministic" | "deterministic+llm";
    try {
      const matchesRaw = await readFile(MATCHES_PATH, "utf8");
      const matches = JSON.parse(matchesRaw) as MatchesSnapshot;
      groups = matches.groups;
      matchSource = matches.totals.llm > 0 ? "deterministic+llm" : "deterministic";
    } catch {
      groups = buildMatchGroups(snapshot.products);
      matchSource = "deterministic";
    }

    cached = { snapshot, groups, matchSource, loadedAt: Date.now() };
    return { snapshot, groups, matchSource };
  } catch {
    return null;
  }
}
