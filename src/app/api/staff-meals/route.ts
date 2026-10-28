// GET /api/staff-meals?what=summary — the staff-meal สรุป tab's read
// (mise-ui-review §5c: client reads are GET routes, not Server Actions).

import { guardRead, readInput } from "@/lib/read-api";
import { readStaffMealSummary } from "@/app/(app)/staff-meals/summary-read";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(() => read(req));
}

async function read(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const input = readInput(url);
  if (url.searchParams.get("what") !== "summary" || input === null || typeof input !== "object") {
    return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
  }
  return json(await readStaffMealSummary(input as Parameters<typeof readStaffMealSummary>[0]));
}
