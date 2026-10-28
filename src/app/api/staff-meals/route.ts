// GET /api/staff-meals — the staff-meal screen's reads
// (mise-ui-review §5c: client reads are GET routes, not Server Actions):
//   what=summary&q={month,branchId?}  the สรุป tab
//   what=board                         the ticket board's poll (ADR 0035) —
//                                      was getTicketBoardAction, handed down as a prop

import { guardRead, readInput } from "@/lib/read-api";
import { requireTenant } from "@/lib/require-tenant";
import { readStaffMealSummary } from "@/app/(app)/staff-meals/summary-read";
import { readTicketBoard } from "@/app/(app)/staff-meals/ticket-board-read";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(() => read(req));
}

async function read(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get("what") === "board") {
    const { tenantId, membership, reach, can } = await requireTenant("staffmeal:write");
    const board = await readTicketBoard({ tenantId, userId: membership.userId, reach, canApprove: can("staffmeal:approve") });
    return json({ ok: true, board });
  }
  const input = readInput(url);
  if (url.searchParams.get("what") !== "summary" || input === null || typeof input !== "object") {
    return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
  }
  return json(await readStaffMealSummary(input as Parameters<typeof readStaffMealSummary>[0]));
}
