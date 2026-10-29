// ============================================================
// คิดครัว — a month of bill photos and slips as one .zip (ADR 0037 Q5–Q6)
// ============================================================
// GET /api/advances/export?month=YYYY-MM — refund:pay, within branch reach.
// The zip streams as it is built (src/server/advance-export.ts says why).
// ============================================================

import { Readable } from "node:stream";
import { requireTenant } from "@/lib/require-tenant";
import { collectMonthExportLogic, monthZipStream } from "@/server/advance-export";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("bad month", { status: 400 });
  const { tenantId, reach } = await requireTenant("refund:pay");
  const data = await collectMonthExportLogic(tenantId, reach, month);
  const stream = await monthZipStream(month, data);
  const name = `บิลและสลิป-${month}.zip`;
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="bills-${month}.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
