import { NextResponse } from "next/server";
import { loadSnapshot } from "@/lib/loadSnapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await loadSnapshot();
  if (!snapshot) {
    return NextResponse.json(
      { error: "No price snapshot yet. Run: docker compose run --rm scraper" },
      { status: 404 },
    );
  }
  return NextResponse.json(snapshot);
}
