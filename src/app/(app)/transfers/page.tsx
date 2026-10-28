// Sprint 3 Part 18 L5a — /transfers: what we sent, and what is coming.
//
// Server Component. Filters live in the URL (`?branch=&direction=&status=`) so
// the view is linkable and `revalidatePath("/transfers")` from the L4 write path
// refreshes whatever the user is actually looking at.
//
// **This is the first list in the system that has to ask which END of a document
// the reader means.** /transfers at ทองหล่อ means "what we sent" to the person
// who packed the truck and "what is arriving" to the person waiting for it, and
// a single branch filter cannot tell those apart — hence `direction`, defaulting
// to both.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix, `a669e05`).

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { MAX_TRANSFER_ROWS, getTransfersLogic } from "@/server/transfer";
import {
  TRANSFER_DIRECTION_LABELS_TH,
  TRANSFER_DIRECTION_VALUES,
  TRANSFER_STATUS_LABELS_TH,
  TRANSFER_STATUS_VALUES,
  getTransfersQuerySchema,
} from "@/lib/validations/transfer";
import { toTransferView } from "./_components/transfer-view";


import EmptyState from "@/components/ui/EmptyState";
import { RowChevron } from "@/components/ui/ActionLink";
import FilterLink from "@/components/ui/FilterLink";
const STATUS_STYLE: Record<string, string> = {
  SENT: "border-warn-border bg-warn-bg text-warn",
  RECEIVED: "border-good-border bg-good-bg text-good",
  VOIDED: "border-border bg-muted/40 text-muted-foreground",
};

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{
    branch?: string;
    direction?: string;
    status?: string;
  }>;
}) {
  const { tenantId, reach, costAccess} = await requireTenant("any:member");
  const sp = await searchParams;

  const query = getTransfersQuerySchema.safeParse({
    branchId: sp.branch,
    direction: sp.direction,
    status: sp.status,
    includeReversalLines: "false",
  });

  // Side by side (2026-10-01): the list never needed the branch list first.
  const [branches, transfers] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    query.success ? getTransfersLogic(tenantId, query.data, reach) : Promise.resolve([]),
  ]);
  const fetched = transfers.map((t) => toTransferView(t, costAccess));
  const truncated = fetched.length > MAX_TRANSFER_ROWS;
  const rows = truncated ? fetched.slice(0, MAX_TRANSFER_ROWS) : fetched;

  const waiting = rows.filter((t) => t.status === "SENT");

  const linkFor = (next: { status?: string; branch?: string; direction?: string }) => {
    const q = new URLSearchParams();
    const st = next.status ?? sp.status;
    const br = next.branch ?? sp.branch;
    const dir = next.direction ?? sp.direction;
    if (st) q.set("status", st);
    if (br) q.set("branch", br);
    if (br && dir && dir !== "ANY") q.set("direction", dir);
    const qs = q.toString();
    return qs ? `/transfers?${qs}` : "/transfers";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">ใบโอน</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ของถูกตัดจากสาขาต้นทางและเข้าสาขาปลายทางตั้งแต่กดส่ง — การกดรับคือการยืนยันว่ามีคนปลายทางนับของแล้ว
          </p>
        </div>
        <a
          href="/transfers/new"
          className="btn"
        >
          สร้างใบโอน
        </a>
      </div>

      {branches.length < 2 && (
        // The feature cannot be used at all with one branch, and saying so is
        // better than an empty list that looks broken (Part 17's UX lesson: an
        // empty state must distinguish "nothing to show" from "not set up").
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          การโอนต้องมีอย่างน้อย 2 สาขา — ตอนนี้ระบบมี {branches.length} สาขา
        </div>
      )}

      {/* Filters answer at once, like every list (kit, 2026-10-28). Direction
          only means something once a branch is chosen. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="seg">
          <FilterLink href={linkFor({ status: "" })} className={`seg-item ${!sp.status ? "is-on" : ""}`}>
            ทุกสถานะ
          </FilterLink>
          {TRANSFER_STATUS_VALUES.map((s) => (
            <FilterLink key={s} href={linkFor({ status: s })} className={`seg-item ${sp.status === s ? "is-on" : ""}`}>
              {TRANSFER_STATUS_LABELS_TH[s]}
            </FilterLink>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sp.branch && (
            <div className="seg">
              {TRANSFER_DIRECTION_VALUES.map((d) => (
                <FilterLink key={d} href={linkFor({ direction: d })} className={`seg-item ${(sp.direction ?? "ANY") === d ? "is-on" : ""}`}>
                  {TRANSFER_DIRECTION_LABELS_TH[d]}
                </FilterLink>
              ))}
            </div>
          )}
          {branches.length > 1 && (
            <div className="seg">
              <FilterLink href={linkFor({ branch: "", direction: "" })} className={`seg-item ${!sp.branch ? "is-on" : ""}`}>
                ทุกสาขา
              </FilterLink>
              {branches.map((b) => (
                <FilterLink key={b.id} href={linkFor({ branch: b.id })} className={`seg-item ${sp.branch === b.id ? "is-on" : ""}`}>
                  {b.name}
                </FilterLink>
              ))}
            </div>
          )}
        </div>
      </div>

      {waiting.length > 0 && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
          <strong>{waiting.length} ใบยังไม่มีใครกดรับ</strong> — ของอยู่ในยอดของสาขาปลายทางแล้ว
          แต่ยังไม่มีใครที่ปลายทางนับยืนยัน
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState art={branches.length < 2 ? "setup" : "none"}>
          {branches.length < 2
            ? "ยังโอนของไม่ได้ เพราะต้องมีอย่างน้อย 2 สาขา"
            : "ยังไม่มีใบโอนที่ตรงกับเงื่อนไขนี้"}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((t) => (
            <li key={t.id}>
              {/* Kong (2026-09-28): the whole card opens the transfer, not only
                  its number — a number in plain text did not look pressable. */}
              <a
                href={`/transfers/${t.id}`}
                className={`group block rounded-lg border bg-surface p-4 transition hover:border-primary-line hover:shadow-md ${t.status === "SENT" ? "border-warn-border" : "border-border"}`}
              >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium group-hover:text-primary">{t.tfNumber}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t.fromBranch.name} → {t.toBranch.name} · {t.dispatchedAtLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${STATUS_STYLE[t.status] ?? ""}`}
                  >
                    {t.statusLabel}
                  </span>
                  <RowChevron label={t.status === "SENT" ? "รอรับ" : undefined} />
                </div>
              </div>

              {/* The hint travels with every row on purpose: "กำลังส่ง" read on
                  its own says the stock has not moved, which is false. */}
              <p className="mt-2 text-xs text-muted-foreground">{t.statusHint}</p>

              <p className="mt-2 text-sm">
                {t.lineCount} รายการ · มูลค่า{" "}
                {/* An empty gap would read as "this transfer was worth
                    nothing". Say whose limit it is (rule A8). */}
                {t.costHidden ? (
                  <span className="text-muted-foreground">ไม่มีสิทธิ์ดู</span>
                ) : (
                  <>{t.totalCost} ฿</>
                )}
                {t.hasShortage && (
                  <span className="ml-2 rounded-full border border-bad-border bg-bad-bg px-2 py-0.5 text-xs text-bad">
                    ของมาไม่ครบ
                  </span>
                )}
                {t.driverName && (
                  <span className="ml-2 text-muted-foreground">
                    คนขับ: {t.driverName}
                    {t.driverConfirmedAt ? " (ยืนยันแล้ว)" : ""}
                  </span>
                )}
              </p>
              </a>
            </li>
          ))}
        </ul>
      )}

      {truncated && (
        <p className="text-xs text-muted-foreground">
          แสดง {MAX_TRANSFER_ROWS} ใบแรกเท่านั้น — กรองให้แคบลงเพื่อดูใบที่เหลือ
        </p>
      )}
    </div>
  );
}
