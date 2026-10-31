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
// Document-page review (Kong 2026-10-27, mockup 58mU74dLaAMwH6nF3AC6zw): the
// shared header with "รับของที่ …" as its next step, and the receiver counts
// in any unit — the received column shows how they counted it.
//
// `params` is a PROMISE in Next 15, the same as `searchParams`.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { canAccessBranch } from "@/lib/permissions/service";
import { getTransferByIdLogic } from "@/server/transfer";
import { receiveTransferAction, voidTransferAction } from "../actions";
import { toTransferView } from "../_components/transfer-view";
import ReceiveTransferForm from "../_components/ReceiveTransferForm";
import VoidTransferButton from "../_components/VoidTransferButton";
import { DocHeader, HeaderChip, RelatedDocs } from "@/components/ui/DocHeader";

const STATUS_STYLE: Record<string, string> = {
  SENT: "border-warn-border bg-warn-bg text-warn",
  RECEIVED: "border-good-border bg-good-bg text-good",
  VOIDED: "border-border bg-muted/40 text-muted-foreground",
};

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, costAccess, assertBranch, reach } = await requireTenant("any:member");
  const { id } = await params;

  const found = await getTransferByIdLogic(tenantId, id);
  if (!found) notFound();
  // Rule A5: reachable by URL, so the document's branch is checked here too.
  if (!canAccessBranch(reach, found.fromBranchId)) assertBranch(found.toBranchId); // either end may read it
  const t = toTransferView(found, costAccess);

  const liveLines = t.lines.filter((l) => !l.isReversal);
  const reversalLines = t.lines.filter((l) => l.isReversal);

  return (
    <div className="space-y-6">
      <DocHeader
        trail={{ href: "/transfers", label: "โอนของระหว่างสาขา" }}
        number={t.tfNumber}
        badges={
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[t.status] ?? ""}`}>
            {t.statusLabel}
          </span>
        }
        meta={`${t.fromBranch.name} → ${t.toBranch.name} · ส่ง ${t.dispatchedAtLabel}${
          t.dispatchedByName ?? t.dispatchedByAccount ? ` โดย ${t.dispatchedByName ?? t.dispatchedByAccount}` : ""
        }`}
        actions={
          t.status === "SENT" ? (
            <a href="#receive" className="btn">
              รับของที่{t.toBranch.name}
            </a>
          ) : t.hasShortage ? (
            <HeaderChip tone="warn">มีของหายระหว่างทาง</HeaderChip>
          ) : undefined
        }
      />
      <RelatedDocs items={[{ label: "ค่าใช้จ่าย", note: "การโอนไม่สร้างค่าใช้จ่าย" }]} />

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
              <span className="block text-xs text-good">
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

      <div className="data-table">
        <table>
          <thead className="bg-muted/40 text-left">
            <tr>
              <th>วัตถุดิบ</th>
              <th className="text-right">ส่ง</th>
              <th className="text-right">รับจริง</th>
              <th className="text-right">หาย</th>
              <th className="text-right">มูลค่า (฿)</th>
            </tr>
          </thead>
          <tbody>
            {liveLines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.product.name}
                  <span className="block text-xs text-muted-foreground">
                    {l.product.sku}
                  </span>
                </td>
                <td className="text-right">
                  {l.qtySent} {l.inputUnitName}
                </td>
                <td className="text-right">
                  {/* NULL and 0 must stay distinguishable all the way here: one
                      means nobody counted, the other means nothing arrived. */}
                  {l.qtyReceived === null ? (
                    <span className="text-muted-foreground">ยังไม่ได้นับ</span>
                  ) : l.qtyReceivedBase !== null ? (
                    <>
                      {Number(l.qtyReceivedBase)} {l.product.baseUnitName}
                      {l.receivedDetail && (
                        <span className="block text-xs text-muted-foreground">นับเป็น {l.receivedDetail}</span>
                      )}
                    </>
                  ) : (
                    `${l.qtyReceived} ${l.inputUnitName}`
                  )}
                </td>
                <td className="text-right">
                  {l.qtyMissingBase !== null ? (
                    Number(l.qtyMissingBase) === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="text-bad">
                        {Number(l.qtyMissingBase)} {l.product.baseUnitName}
                      </span>
                    )
                  ) : l.qtyMissing === null || Number(l.qtyMissing) === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="text-bad">
                      {l.qtyMissing} {l.inputUnitName}
                    </span>
                  )}
                </td>
                <td className="text-right">
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
              <td colSpan={4}>
                รวม {t.lineCount} รายการ
              </td>
              <td className="text-right">
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
        <section id="receive" className="scroll-mt-20 rounded-[18px] border border-border/70 bg-surface shadow-card p-4">
          <h3 className="mb-3 text-lg font-semibold">รับของที่{t.toBranch.name}</h3>
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
