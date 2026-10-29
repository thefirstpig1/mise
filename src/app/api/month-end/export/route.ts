// ============================================================
// คิดครัว — download the month-end file (Kong 2026-10-29)
// ============================================================
// GET ?month=2026-09&program=peak&mode=full&split=0&scope=company
//     &stock=1&branches=0&bills=0
// Gated on cost:view — the file is stock value and cost of sales — and
// narrowed to the reader's branches (rule ME6). Account codes come from the
// shop's saved settings only, never from the address bar.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { monthEndExportQuerySchema } from "@/lib/validations/accounting-export";
import { getMonthEndLogic } from "@/server/month-end";
import { getAccountingExportSettingsLogic } from "@/server/accounting-export-settings";
import { writeMonthEndFile } from "@/server/month-end-export";
import { toMonthEndView, journalFigures } from "@/lib/month-end-view";
import { buildMonthEndJournal } from "@/lib/month-end-journal";
import { fileNameFor, programOf } from "@/lib/accounting-formats";
import { missingCodes } from "@/lib/accounting-codes";

export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const { tenantId, reach } = await requireTenant("cost:view");
    const url = new URL(req.url);
    const parsed = monthEndExportQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return text("คำขอไม่ถูกต้อง", 400);
    const q = parsed.data;

    const [data, settings] = await Promise.all([
      getMonthEndLogic(tenantId, q.month, reach, { withBills: q.bills }),
      getAccountingExportSettingsLogic(tenantId),
    ]);
    if (data === null) return text("ยังไม่มีสาขาที่คุณดูได้", 404);
    const view = toMonthEndView(data);
    const journal = buildMonthEndJournal({
      branches: journalFigures(view),
      mode: q.mode,
      split: q.split && view.recipeMethod,
      scope: q.scope,
      accounts: settings.accounts,
    });

    // A file the program would read with blank accounts is not a file worth
    // sending — the dialog already stops here; this is the same rule server-side.
    const missing = missingCodes(programOf(q.program), journal);
    if (missing.length > 0) {
      return text(`ยังไม่ได้ใส่รหัสบัญชี: ${missing.map((a) => settings.accounts[a].name).join(", ")}`, 409);
    }

    const file = await writeMonthEndFile(q.program, {
      view,
      journal,
      include: { stock: q.stock, branches: q.branches, bills: q.bills },
    });
    const name = fileNameFor(q.program, q.month);
    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${name.ascii}"; filename*=UTF-8''${encodeURIComponent(name.thai)}`,
        "Cache-Control": "no-store",
      },
    });
  });
}
