// ============================================================
// คิดครัว — download raw data as Excel (Kong 2026-10-31)
// ============================================================
// GET ?dataset=goods-receipts&from=2026-09-01&to=2026-09-30&branch=&status=
//     &count=1   → { ok, docs, rows } for the dialog
//     (no count) → the .xlsx
// Each dataset opens with the capability of the page it comes from, so a
// download can never show more than that page does (src/server/raw-export.ts
// rules R1–R3). The workbook is written through ExcelJS's streaming writer:
// a year of per-bill sales is hundreds of thousands of rows on a 1 GB machine.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { EXPORT_DATASETS, exportFileName, rawExportQuerySchema, type ExportDataset } from "@/lib/validations/raw-export";
import { buildRawExportLogic, countRawExportLogic, writeRawExportWorkbook } from "@/server/raw-export";
import { getBranchesLogic } from "@/server/branch";

export const dynamic = "force-dynamic";

/**
 * The page each file comes from, and therefore who may take it. Written out
 * call by call, never looked up from a table: "who may download this?" must be
 * answerable by reading one line (tests/permissions-gate-shape G3).
 */
function gateFor(dataset: ExportDataset) {
  switch (dataset) {
    case "sales":
      return requireTenant("sales:view");
    case "goods-receipts":
      return requireTenant("receive:write");
    case "expenses":
      return requireTenant("expense:view");
    case "stock-counts":
      return requireTenant("count:write");
    case "stock-movements":
      return requireTenant("any:member");
    case "products":
      return requireTenant("any:member");
  }
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    const dataset = url.searchParams.get("dataset");
    if (!dataset || !(EXPORT_DATASETS as readonly string[]).includes(dataset)) return text("คำขอไม่ถูกต้อง", 400);
    const { tenantId, reach, costAccess } = await gateFor(dataset as ExportDataset);

    const parsed = rawExportQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "คำขอไม่ถูกต้อง";
      return url.searchParams.get("count") === "1"
        ? Response.json({ ok: false, formError: msg }, { status: 400, headers: { "Cache-Control": "no-store" } })
        : text(msg, 400);
    }
    const q = parsed.data;
    const ctx = { tenantId, reach, withMoney: costAccess !== null, q };

    if (q.count === "1") {
      const c = await countRawExportLogic(ctx);
      return Response.json({ ok: true, ...c }, { headers: { "Cache-Control": "no-store" } });
    }

    const [sheets, branches] = await Promise.all([buildRawExportLogic(ctx), q.branch ? getBranchesLogic(tenantId, reach) : Promise.resolve([])]);
    const branchName = q.branch ? (branches.find((b) => b.id === q.branch)?.name ?? null) : null;
    const name = exportFileName(q.dataset, q.from, q.to, branchName);
    return new Response(writeRawExportWorkbook(sheets), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name.ascii}"; filename*=UTF-8''${encodeURIComponent(name.thai)}`,
        "Cache-Control": "no-store",
      },
    });
  });
}
