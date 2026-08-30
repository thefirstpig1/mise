// Sprint 3 Part 16 L5b — one bill, read as a document.
//
// The money is shown the way it was ARRIVED AT, not just as a total: subtotal,
// VAT (with the direction it was typed in), withholding on the pre-VAT base, and
// what actually left the bank. A reader who cannot see those steps has no way to
// check the figure against the paper in their hand.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getExpenseByIdLogic } from "@/server/expense";
import { formatMoney } from "@/app/cost/_components/cost-view";
import { EXPENSE_SOURCE_LABELS_TH } from "@/lib/validations/expense";
import { toExpenseDetailView } from "../_components/expense-view";
import PaymentBadge from "../_components/PaymentBadge";
import PaymentToggle from "../_components/PaymentToggle";
import DeleteExpenseButton from "../_components/DeleteExpenseButton";
import { deleteExpenseAction, setExpensePaymentAction } from "../actions";

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { dateStyle: "medium" });

const Row = ({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) => (
  <div
    className={`flex justify-between py-1 ${strong ? "font-medium" : ""} ${
      muted ? "text-muted-foreground" : ""
    }`}
  >
    <span>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId } = await requireTenant("expense:view");
  const { id } = await params;

  const row = await getExpenseByIdLogic(tenantId, id);
  if (!row) notFound();
  const expense = toExpenseDetailView(row);

  return (
    <div className="space-y-6">
      <div>
        <a
          href="/expenses"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับรายการค่าใช้จ่าย
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold">
            {expense.supplierName ?? expense.billNo ?? "ค่าใช้จ่าย"}
          </h2>
          <PaymentBadge status={expense.paymentStatus} />
          <span className="text-xs text-muted-foreground">
            {EXPENSE_SOURCE_LABELS_TH[expense.source]}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {dateLabel(expense.billDate)} · {expense.branchName}
          {expense.billNo && ` · บิลเลขที่ ${expense.billNo}`}
          {expense.vatInvoiceNo && ` · ใบกำกับภาษี ${expense.vatInvoiceNo}`}
        </p>
      </div>

      {/* The link Q7 asks for: a system-created document has to be reachable
          from the document that created it, and vice versa. */}
      {expense.sourceGrId && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
          บิลนี้สร้างอัตโนมัติจากใบรับของ{" "}
          <a
            href={`/goods-receipts/${expense.sourceGrId}`}
            className="font-medium underline"
          >
            {expense.sourceGrNumber}
          </a>
        </div>
      )}
      {expense.recurringExpenseId && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          บันทึกจากรายการประจำ{" "}
          <a href="/expenses/recurring" className="font-medium underline">
            {expense.recurringDescription}
          </a>{" "}
          งวด {expense.period}
        </div>
      )}

      <section className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[34rem]">
          <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">รายละเอียด</th>
              <th className="px-3 py-2 font-medium">หมวดบัญชี</th>
              <th className="px-3 py-2 text-right font-medium">จำนวน</th>
              <th className="px-3 py-2 text-right font-medium">ก่อน VAT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {expense.items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 text-sm text-muted-foreground">
                  {item.lineNo}
                </td>
                <td className="px-3 py-2 text-sm">
                  {item.description}
                  {item.productName && (
                    <div className="text-xs text-muted-foreground">
                      {item.productName}
                      {item.productDeleted && " (ถูกลบแล้ว)"}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {item.categoryLabel}
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums">
                  {item.qty ? `${item.qty} ${item.unitName ?? ""}` : "—"}
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums">
                  {formatMoney(item.totalPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="max-w-sm rounded-lg border border-border p-4 text-sm">
        <Row label="ยอดก่อน VAT" value={formatMoney(expense.subtotalExclVat)} />
        <Row
          label={
            expense.vatRatePercent
              ? `VAT ${expense.vatRatePercent}% ${
                  expense.isPriceVatInclusive ? "(ราคารวม VAT)" : "(บวกเพิ่ม)"
                }`
              : "VAT (ไม่มี)"
          }
          value={formatMoney(expense.vatAmount)}
        />
        <div className="my-1 border-t border-border" />
        <Row label="ยอดรวม" value={formatMoney(expense.totalAmount)} strong />
        {expense.subjectToWht && (
          <Row
            label={`หัก ณ ที่จ่าย ${expense.whtRatePercent}% (จากยอดก่อน VAT)`}
            value={`−${formatMoney(expense.whtAmount ?? "0")}`}
            muted
          />
        )}
        <Row
          label="จ่ายจริง"
          value={formatMoney(expense.netPaymentAmount)}
          strong
        />
        {expense.whtCertificateNo && (
          <p className="mt-2 text-xs text-muted-foreground">
            หนังสือรับรอง 50 ทวิ เลขที่ {expense.whtCertificateNo}
          </p>
        )}
        {expense.paidAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            จ่ายเมื่อ {dateLabel(expense.paidAt)}
            {expense.paymentMethod && ` · ${expense.paymentMethod}`}
          </p>
        )}
      </section>

      {expense.notes && (
        <p className="whitespace-pre-line rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {expense.notes}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
        <PaymentToggle
          action={setExpensePaymentAction}
          expenseId={expense.id}
          paymentStatus={expense.paymentStatus}
          paymentMethod={expense.paymentMethod}
        />
        <a
          href={`/expenses/${expense.id}/edit`}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          แก้ไข
        </a>
        <DeleteExpenseButton
          action={deleteExpenseAction}
          expenseId={expense.id}
          fromGoodsReceipt={expense.source === "FROM_GOODS_RECEIPT"}
          sourceGrId={expense.sourceGrId}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        บันทึกเมื่อ {dateLabel(expense.createdAt)}
        {expense.createdByName && ` โดย ${expense.createdByName}`}
      </p>
    </div>
  );
}
