// Sprint 3 Part 18 L5a — /transfers/[id]: one document, both ends of it.
//
// Server Component. Three things live here that no other document page has:
//
//  1. **The status sentence, always.** `SENT` on its own reads as "the stock has
//     not moved", which is false — both ledger legs posted at dispatch (Q1).
//  2. **Three people**, because a shortfall is otherwise an argument between two
//     branches that no record can settle (Q3).
//  3. **The receive form and the void control side by side**, with the void
//     spelling out that it is not a transfer back (Q6).
//
// `params` is a PROMISE in Next 15, the same as `searchParams`.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getTransferByIdLogic } from "@/server/transfer";
import { receiveTransferAction, voidTransferAction } from "../actions";
import { toTransferView } from "../_components/transfer-view";
import ReceiveTransferForm from "../_components/ReceiveTransferForm";
import VoidTransferButton from "../_components/VoidTransferButton";

const STATUS_STYLE: Record<string, string> = {
  SENT: "border-warn-border bg-warn-bg text-warn",
  RECEIVED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  VOIDED: "border-border bg-muted/40 text-muted-foreground",
};

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, costAccess} = await requireTenant("any:member");
  const { id } = await params;

  const found = await getTransferByIdLogic(tenantId, id);
  if (!found) notFound();
  const t = toTransferView(found, costAccess);

  const liveLines = t.lines.filter((l) => !l.isReversal);
  const reversalLines = t.lines.filter((l) => l.isReversal);

  return (
    <div className="space-y-6">
      <a href="/transfers" className="text-sm text-muted-foreground hover:underline">
        ← กลับรายการใบโอน
      </a>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t.tfNumber}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.fromBranch.name} → {t.toBranch.name} · ส่ง {t.dispatchedAtLabel}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-sm ${STATUS_STYLE[t.status] ?? ""}`}
        >
          {t.statusLabel}
        </span>
      </div>

      <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        {t.statusHint}
      </p>

      {/* The three people (Q3). Shown even when empty, because a blank "คนขับ"
          is itself the fact worth seeing when a crate goes missing. */}
      <dl className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">ผู้ส่ง</dt>
          <dd className="mt-0.5">
            {t.dispatchedByName ?? t.dispatchedByAccount ?? "—"}
            {t.dispatchedByName && t.dispatchedByAccount && (
              <span className="block text-xs text-muted-foreground">
                บันทึกโดย {t.dispatchedByAccount}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">คนขับ</dt>
          <dd className="mt-0.5">
            {t.driverName ?? "— ไม่ได้ระบุ"}
            {t.driverConfirmedAtLabel && (
              <span className="block text-xs text-emerald-700">
                นับและรับไปแล้ว {t.driverConfirmedAtLabel}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">ผู้รับ</dt>
          <dd className="mt-0.5">
            {t.receivedByName ?? t.receivedByAccount ?? "— ยังไม่มีใครกดรับ"}
            {t.receivedAtLabel && (
              <span className="block text-xs text-muted-foreground">
                {t.receivedAtLabel}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">วัตถุดิบ</th>
              <th className="px-3 py-2 text-right font-medium">ส่ง</th>
              <th className="px-3 py-2 text-right font-medium">รับจริง</th>
              <th className="px-3 py-2 text-right font-medium">หาย</th>
              <th className="px-3 py-2 text-right font-medium">มูลค่า (฿)</th>
            </tr>
          </thead>
          <tbody>
            {liveLines.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-3 py-2">
                  {l.product.name}
                  <span className="block text-xs text-muted-foreground">
                    {l.product.sku}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {l.qtySent} {l.inputUnitName}
                </td>
                <td className="px-3 py-2 text-right">
                  {/* NULL and 0 must stay distinguishable all the way here: one
                      means nobody counted, the other means nothing arrived. */}
                  {l.qtyReceived === null ? (
                    <span className="text-muted-foreground">ยังไม่ได้นับ</span>
                  ) : (
                    `${l.qtyReceived} ${l.inputUnitName}`
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {l.qtyMissing === null || Number(l.qtyMissing) === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="text-bad">
                      {l.qtyMissing} {l.inputUnitName}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {/* Blank would read as free, and ฿0 as free too — both are
                      claims about the goods. This is about the reader. */}
                  {l.costTotal === null ? (
                    <span className="text-muted-foreground">ไม่มีสิทธิ์ดู</span>
                  ) : (
                    l.costTotal
                  )}
                  {/* 0.00 is not always "free" — it can mean the sending branch
                      never knew what these goods cost (ADR 0014 Q10). */}
                  {l.costTotal !== null && l.costSource === "UNPRICED" && (
                    <span className="block text-xs text-warn">
                      {l.costSourceLabel}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/20">
            <tr>
              <td className="px-3 py-2 font-medium" colSpan={4}>
                รวม {t.lineCount} รายการ
              </td>
              <td className="px-3 py-2 text-right font-medium">
                {t.costHidden ? (
                  <span className="font-normal text-muted-foreground">
                    ไม่มีสิทธิ์ดู
                  </span>
                ) : (
                  t.totalCost
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {reversalLines.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
          <p className="font-medium">รายการกลับรายการ (จากการยกเลิก)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            ใบเดิมไม่ถูกลบ — ระบบต่อท้ายรายการที่หักล้างกันไว้ให้เห็นทั้งคู่
            {t.voidReason && <> · เหตุผล: {t.voidReason}</>}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {reversalLines.map((l) => (
              <li key={l.id}>
                {l.product.name}: {l.qtySent} {l.inputUnitName}
                {l.costTotal !== null && ` · ${l.costTotal} ฿`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {t.notes && (
        <p className="text-sm text-muted-foreground">หมายเหตุ: {t.notes}</p>
      )}

      {t.status === "SENT" && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 font-medium">รับของที่ {t.toBranch.name}</h3>
          <ReceiveTransferForm
            action={receiveTransferAction}
            transferId={t.id}
            lines={liveLines}
          />
        </section>
      )}

      {t.status !== "VOIDED" && (
        <VoidTransferButton
          action={voidTransferAction}
          transferId={t.id}
          tfNumber={t.tfNumber}
          fromBranchName={t.fromBranch.name}
          toBranchName={t.toBranch.name}
          reverseHref={`/transfers/new?from=${t.toBranch.id}`}
        />
      )}
    </div>
  );
}
