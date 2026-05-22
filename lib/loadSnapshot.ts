import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PriceSnapshot } from "./types";

const SNAPSHOT_PATH = join(process.cwd(), "data", "prices.json");

export async function loadSnapshot(): Promise<PriceSnapshot | null> {
  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf8");
    return JSON.parse(raw) as PriceSnapshot;
  } catch {
    return null;
  }
}
