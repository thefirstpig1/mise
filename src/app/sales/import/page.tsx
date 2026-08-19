// Sprint 4 Part 19 L5 — /sales/import: bring a POS file in.
//
// Server Component. The screen itself is a client wizard, because the file has
// to survive between the preview and the confirm (there is no object storage
// yet), and a Server Component cannot hold it.
//
// The recent-imports list underneath is not decoration. Rule P3 makes any day
// replaceable by a later file, so "which file put this number here, and when"
// is a live question — and a FAILED row with its Thai reasons is the answer to
// "why is Tuesday missing", which the previous system could never give.

import { requireTenant } from "@/lib/require-tenant";
import { getSalesImportProfilesLogic } from "@/server/menu";
import { getSalesImportBatchesLogic } from "@/server/sales-import";
import {
  FILE_ENCODING_LABELS_TH,
  SALES_FILE_KIND_LABELS_TH,
} from "@/lib/validations/sales-import";
import SalesImportWizard, {
  type ImportProfileOption,
} from "./_components/SalesImportWizard";

const BANGKOK_DATETIME = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_LABELS_TH: Record<string, string> = {
  PENDING: "รอตรวจ",
  PREVIEW: "ตรวจแล้ว ยังไม่ยืนยัน",
  COMMITTED: "นำเข้าแล้ว",
  FAILED: "ไม่ผ่าน",
  CANCELLED: "ยกเลิก",
};

type ErrorLogEntry = { rowNumber?: number; message?: string };

/** The first few reasons a file was refused, straight from the batch row. */
function firstReasons(errorLog: unknown): string[] {
  if (!Array.isArray(errorLog)) return [];
  return (errorLog as ErrorLogEntry[])
    .slice(0, 3)
    .map((e) => (e.rowNumber ? `แถวที่ ${e.rowNumber}: ${e.message ?? ""}` : (e.message ?? "")))
    .filter((s) => s !== "");
}

export default async function SalesImportPage() {
  const { tenantId } = await requireTenant();

  const [profiles, batches] = await Promise.all([
    getSalesImportProfilesLogic(tenantId),
    getSalesImportBatchesLogic(tenantId),
  ]);

  const options: ImportProfileOption[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    branchName: p.posIntegration.branch.name,
    posName: p.posIntegration.name,
    fileKindLabel: SALES_FILE_KIND_LABELS_TH[p.fileKind] ?? p.fileKind,
    encodingLabel: FILE_ENCODING_LABELS_TH[p.encoding] ?? p.encoding,
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold">นำเข้ายอดขาย</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            โหลดไฟล์ยอดขายจากหลังบ้านของ POS แล้วอัปที่นี่ — ไฟล์เดียวครอบได้หลายวัน
          </p>
        </div>
        <a href="/sales" className="text-sm text-primary hover:underline">
          ดูยอดขาย →
        </a>
      </div>

      <SalesImportWizard profiles={options} />

      {profiles.length > 0 && (
        <p className="text-xs text-muted-foreground">
          ไฟล์จาก POS เปลี่ยนรูปแบบ?{" "}
          <a href="/sales/import/profiles/new" className="text-primary underline">
            ตั้งค่ารูปแบบไฟล์ใหม่
          </a>
        </p>
      )}

      <section>
        <h3 className="text-sm font-medium">ประวัติการนำเข้า</h3>
        {batches.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">ยังไม่เคยนำเข้าไฟล์</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {batches.map((b) => {
              const reasons = b.status === "FAILED" ? firstReasons(b.errorLog) : [];
              return (
                <li key={b.id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{b.fileName}</span>
                    <span className="text-xs text-muted-foreground">
                      {STATUS_LABELS_TH[b.status] ?? b.status} ·{" "}
                      {BANGKOK_DATETIME.format(b.uploadedAt)}
                      {b.status === "COMMITTED" && ` · ${b.rowCount.toLocaleString("th-TH")} รายการ`}
                    </span>
                  </div>
                  {reasons.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-destructive">
                      {reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
