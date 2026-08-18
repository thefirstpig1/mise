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

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

const STATUS_STYLE: Record<string, string> = {
  SENT: "border-amber-300 bg-amber-50 text-amber-800",
  RECEIVED: "border-emerald-300 bg-emerald-50 text-emerald-800",
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
  const { tenantId } = await requireTenant();
  const sp = await searchParams;

  const branches = await getBranchesLogic(tenantId);

  const query = getTransfersQuerySchema.safeParse({
    branchId: sp.branch,
    direction: sp.direction,
    status: sp.status,
    includeReversalLines: "false",
  });

  const fetched = query.success
    ? (await getTransfersLogic(tenantId, query.data)).map(toTransferView)
    : [];
  const truncated = fetched.length > MAX_TRANSFER_ROWS;
  const rows = truncated ? fetched.slice(0, MAX_TRANSFER_ROWS) : fetched;

  const waiting = rows.filter((t) => t.status === "SENT");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">ใบโอน</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ของถูกตัดจากสาขาต้นทางและเข้าสาขาปลายทางตั้งแต่กดส่ง — การกดรับคือการยืนยันว่ามีคนปลายทางนับของแล้ว
          </p>
        </div>
        <a
          href="/transfers/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
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

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
      >
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">สาขา</span>
          <select name="branch" defaultValue={sp.branch ?? ""} className={inputClass}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">ทิศทาง</span>
          <select
            name="direction"
            defaultValue={sp.direction ?? "ANY"}
            className={inputClass}
          >
            {TRANSFER_DIRECTION_VALUES.map((d) => (
              <option key={d} value={d}>
                {TRANSFER_DIRECTION_LABELS_TH[d]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">สถานะ</span>
          <select name="status" defaultValue={sp.status ?? ""} className={inputClass}>
            <option value="">ทุกสถานะ</option>
            {TRANSFER_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {TRANSFER_STATUS_LABELS_TH[s]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
        >
          กรอง
        </button>
      </form>

      {waiting.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>{waiting.length} ใบยังไม่มีใครกดรับ</strong> — ของอยู่ในยอดของสาขาปลายทางแล้ว
          แต่ยังไม่มีใครที่ปลายทางนับยืนยัน
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          {branches.length < 2
            ? "ยังโอนของไม่ได้ เพราะต้องมีอย่างน้อย 2 สาขา"
            : "ยังไม่มีใบโอนที่ตรงกับเงื่อนไขนี้"}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((t) => (
            <li
              key={t.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <a
                    href={`/transfers/${t.id}`}
                    className="font-medium hover:underline"
                  >
                    {t.tfNumber}
                  </a>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t.fromBranch.name} → {t.toBranch.name} · {t.dispatchedAtLabel}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${STATUS_STYLE[t.status] ?? ""}`}
                >
                  {t.statusLabel}
                </span>
              </div>

              {/* The hint travels with every row on purpose: "กำลังส่ง" read on
                  its own says the stock has not moved, which is false. */}
              <p className="mt-2 text-xs text-muted-foreground">{t.statusHint}</p>

              <p className="mt-2 text-sm">
                {t.lineCount} รายการ · มูลค่า {t.totalCost} ฿
                {t.hasShortage && (
                  <span className="ml-2 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700">
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
