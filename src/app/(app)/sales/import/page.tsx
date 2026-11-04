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
//
// Round 2 (Kong 2026-11-01, mockup 225p68BDqKAZTpd9MqDeph): "เตรียมการเผื่อไว้
// ว่าร้านเดียวกัน ต่างสาขาอาจจะใช้ POS ไม่เหมือนกันได้". The database always
// had a POS per branch; the screen let a shop register one POS, once. A shop
// with several branches now starts from its branches — each with its own POS,
// its own formats and its last import — and imports into the one it picks,
// offered only that branch's formats. A branch with none is one press from
// the setup wizard. Branches outside the reader's reach are not listed.

import Link from "next/link";
import type { Route } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getPosIntegrationsLogic, getSalesImportProfilesLogic } from "@/server/menu";
import { getSalesImportBatchesLogic } from "@/server/sales-import";
import {
  FILE_ENCODING_LABELS_TH,
  SALES_FILE_KIND_LABELS_TH,
} from "@/lib/validations/sales-import";
import SalesImportWizard, {
  type ImportProfileOption,
} from "./_components/SalesImportWizard";
import PageHeader from "@/components/ui/PageHeader";

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

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" });

export default async function SalesImportPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const [{ tenantId, reach }, sp] = await Promise.all([requireTenant("sales:import"), searchParams]);

  const [profiles, allBatches, branches, integrations] = await Promise.all([
    getSalesImportProfilesLogic(tenantId),
    getSalesImportBatchesLogic(tenantId),
    getBranchesLogic(tenantId, reach),
    getPosIntegrationsLogic(tenantId),
  ]);
  const inReach = new Set(branches.map((b) => b.id));
  const batches = allBatches.filter((b) => inReach.has(b.branchId));
  const many = branches.length > 1;
  const selected = many ? (branches.find((b) => b.id === sp.branch)?.id ?? null) : (branches[0]?.id ?? null);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const options: ImportProfileOption[] = profiles
    .filter((p) => p.posIntegration.branchId === selected)
    .map((p) => ({
      id: p.id,
      name: p.name,
      branchName: p.posIntegration.branch.name,
      posName: p.posIntegration.name,
      fileKindLabel: SALES_FILE_KIND_LABELS_TH[p.fileKind] ?? p.fileKind,
      encodingLabel: FILE_ENCODING_LABELS_TH[p.encoding] ?? p.encoding,
    }));
  const setupHref = (branchId: string | null) => (branchId ? `/sales/import/profiles/new?branch=${branchId}` : "/sales/import/profiles/new");

  const rows = branches.map((b) => {
    const pos = integrations.filter((i) => i.branchId === b.id);
    const formats = pos.reduce((n, i) => n + i.profiles.length, 0);
    const last = batches.find((x) => x.branchId === b.id && x.status === "COMMITTED");
    return { b, pos, formats, last };
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="นำเข้ายอดขาย"
        description="โหลดไฟล์ยอดขายจากหลังบ้านของ POS แล้วอัปโหลดที่นี่ — ไฟล์เดียวครอบได้หลายวัน"
        actions={
          <a href="/sales" className="btn-secondary">
            ดูยอดขาย
          </a>
        }
      />

      {many && (
        <section aria-label="สาขา" className="space-y-2">
          <p className="text-sm text-muted-foreground">เลือกสาขาที่จะนำเข้า · แต่ละสาขามี POS และรูปแบบไฟล์ของตัวเอง</p>
          <ul className="grid gap-2">
            {rows.map(({ b, pos, formats, last }) => {
              const on = b.id === selected;
              const href = (formats > 0 ? `/sales/import?branch=${b.id}` : setupHref(b.id)) as Route;
              return (
                <li
                  key={b.id}
                  className={`group relative flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border px-4 py-3 transition-colors hover:bg-muted/50 ${
                    on ? "border-primary bg-primary-soft ring-1 ring-primary" : formats > 0 ? "border-border bg-surface" : "border-dashed border-border-strong bg-surface"
                  }`}
                >
                  <Link href={href} scroll={false} aria-current={on ? "true" : undefined} className="min-w-28 font-display font-semibold after:absolute after:inset-0 after:content-['']">
                    {b.name}
                  </Link>
                  <span className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">
                    {pos.length === 0
                      ? "ยังไม่ได้ตั้ง POS ของสาขานี้"
                      : `${pos.map((i) => i.name).join(" · ")} · รูปแบบไฟล์ ${formats} แบบ${last ? ` · นำเข้าล่าสุด ${BANGKOK_DATE.format(last.uploadedAt)}` : ""}`}
                  </span>
                  <span aria-hidden className={formats > 0 ? "btn btn-sm" : "btn-secondary btn-sm"}>
                    {formats > 0 ? "นำเข้าไฟล์" : "ตั้ง POS ของสาขานี้"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {selected && (
        <SalesImportWizard key={selected} profiles={options} newProfileHref={setupHref(selected)} autoPickBranchId={selected} />
      )}

      {options.length > 0 && (
        <p className="text-xs text-muted-foreground">
          ไฟล์จาก POS เปลี่ยนรูปแบบ หรือสาขานี้ใช้ POS อีกยี่ห้อ?{" "}
          <a href={setupHref(selected)} className="text-primary underline">
            ตั้งรูปแบบไฟล์ใหม่
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
                    <span className="font-medium">
                      {b.fileName}
                      {many && <span className="font-normal text-muted-foreground"> · {branchName.get(b.branchId)}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {STATUS_LABELS_TH[b.status] ?? b.status} ·{" "}
                      {BANGKOK_DATETIME.format(b.uploadedAt)}
                      {b.status === "COMMITTED" && ` · ${b.lineCount.toLocaleString("th-TH")} แถว`}
                    </span>
                  </div>
                  {reasons.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-bad">
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
