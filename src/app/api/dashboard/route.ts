// GET /api/dashboard?what=trend — the six-month chart's read, moved off a
// Server Action on 2026-10-04 (mise-ui-review §5c). The function validates its
// own input and calls requireTenant itself, exactly as the action did.

import { guardRead, readInput } from "@/lib/read-api";
import { readMonthlyTrend } from "@/app/(app)/dashboard/trend-read";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(() => read(req));
}

async function read(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const input = readInput(url);
  if (url.searchParams.get("what") !== "trend" || input === null || typeof input !== "object") {
    return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
  }
  return json(await readMonthlyTrend(input as Parameters<typeof readMonthlyTrend>[0]));
}
