// Sprint 3 Part 16 L5a — the list of bills, and what is still due.
//
// Server Component. Filters live in the URL so the view is linkable and the
// action layer's revalidatePath("/expenses") refreshes what the user is looking
// at — the rule /stock, /cost and /stock-counts already follow.
//
// `searchParams` is a PROMISE in Next 15: the plain-object signature type-checks
// under `pnpm tsc` and fails `pnpm build` (the Part 10 L5a discovery).
//
// Queue item 9 (Kong 2026-11-03, "เอาตามแนะนำ ดีไซน์ดีๆ") — the finance pass:
//  - the due box is one row per recurring item, the three that owe the most
//    months first, the rest behind "ดูอีก" — it used to fill the first screen;
//  - four number cards instead of two bars, each saying its own base under
//    the figure: รายจ่าย is BEFORE VAT, ยังไม่จ่าย / จ่ายแล้ว are what is
//    actually transferred (after withholding tax) — two bases that do not add
//    up, so the page must never invite the sum;
//  - filters apply as they are chosen (ExpenseFilters), no "กรอง" press;
//  - on a phone each bill is a card with its amount and status in view —
//    the seven-column table hid both past the right edge.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getSuppliersLogic } from "@/server/supplier";
import { getDueRecurringLogic, getExpensesLogic } from "@/server/expense";
import {
  getExpensesQuerySchema,
  EXPENSE_PAYMENT_STATUS_LABELS_TH,
  EXPENSE_PAYMENT_STATUS_VALUES,
  EXPENSE_SOURCE_LABELS_TH,
  EXPENSE_SOURCE_VALUES,
} from "@/lib/validations/expense";
import {
  expenseTitle,
  toDueRecurringView,
  toExpenseListRowView,
  type DueRecurringView,
  type ExpenseListRowView,
} from "./_components/expense-view";
import { monthLabelTh } from "@/lib/expense-labels";
import { periodLabelTh } from "@/lib/sales-insight";
import { formatMoney } from "@/app/(app)/cost/_components/cost-view";
import PaymentBadge from "./_components/PaymentBadge";
import ExpenseFilters from "./_components/ExpenseFilters";

import EmptyTable from "@/components/ui/EmptyTable";
import ActionLink from "@/components/ui/ActionLink";
import PageHeader from "@/components/ui/PageHeader";
import Stat, { StatGrid } from "@/components/ui/Stat";
import ShowMore from "@/components/ui/ShowMore";
import { computeBangkokToday } from "@/lib/bangkok-date";
import ExportButton from "@/components/ExportButton";
import { exportBranchScope } from "@/lib/validations/raw-export";
import { CalendarClock, CircleCheck, Clock, Receipt } from "lucide-react";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const bahtWhole = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;
const bahtExact = (n: number) => `฿${formatMoney(n.toFixed(2))}`;
const sumOf = (rows: ExpenseListRowView[], k: "subtotalExclVat" | "netPaymentAmount") => rows.reduce((s, r) => s + Number(r[k]), 0);

/** Rows of the due box shown before "ดูอีก". */
const DUE_SHOWN = 3;

export default async function ExpenseListPage({
  searchParams,
}: {
  searchParams: Promise<{
    branch?: string;
    supplier?: string;
    source?: string;
    status?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { tenantId, reach } = await requireTenant("expense:view");
  const sp = await searchParams;

  // A malformed filter falls back to the unfiltered list rather than erroring:
  // a query string is navigation, not a form being filled in (Part 10 L5c).
  const parsed = getExpensesQuerySchema.safeParse({
    branchId: sp.branch,
    supplierId: sp.supplier,
    source: sp.source,
    paymentStatus: sp.status,
    from: sp.from,
    to: sp.to,
  });
  const query = parsed.success ? parsed.data : {};

  // The period. No dates = every month (the list's default since Part 16, and
  // what a supplier page's "ค้างจ่าย" link expects).
  const today = computeBangkokToday();
  const monthAt = (back: number) => {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const key = iso(first).slice(0, 7);
    return { key, label: monthLabelTh(key), from: iso(first), to: iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))) };
  };
  const months = Array.from({ length: 12 }, (_, i) => monthAt(i));
  const thisMonth = months[0];
  const fromIso = query.from ? iso(query.from) : "";
  const toIso = query.to ? iso(query.to) : "";
  const scoped = Boolean(fromIso || toIso);
  const scopeLabel = !scoped
    ? "ทุกเดือน"
    : fromIso && toIso
      ? periodLabelTh(fromIso, toIso)
      : fromIso
        ? `ตั้งแต่ ${shortDate(fromIso)}`
        : `ถึง ${shortDate(toIso)}`;
  // รายจ่าย and จ่ายแล้ว are a period's figures: the chosen one, or this month
  // when the list shows every month (an all-time total answers nothing).
  const cardPeriod = scoped
    ? { from: fromIso || "0000-01-01", to: toIso || "9999-12-31", label: scopeLabel }
    : { from: thisMonth.from, to: thisMonth.to, label: thisMonth.label };

  // The payment status narrows the LIST only, in memory, so the cards still
  // count both sides of it (one read instead of two).
  const [branches, suppliers, all, due] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getExpensesLogic(tenantId, { ...query, paymentStatus: undefined }, reach).then((list) => list.map(toExpenseListRowView)),
    getDueRecurringLogic(tenantId, { branchId: query.branchId }, reach).then((list) =>
      list.map(toDueRecurringView)
    ),
  ]);
  const rows = query.paymentStatus ? all.filter((r) => r.paymentStatus === query.paymentStatus) : all;
  const multiBranch = branches.length > 1;

  const inPeriod = all.filter((r) => r.billDate >= cardPeriod.from && r.billDate <= cardPeriod.to);
  const unpaid = all.filter((r) => r.paymentStatus === "UNPAID");
  const paid = inPeriod.filter((r) => r.paymentStatus === "PAID");
  const dueCount = due.reduce((n, d) => n + d.duePeriods.length, 0);
  // The items owing the most months lead; ties keep the server's order.
  const dueSorted = [...due].sort((a, b) => b.duePeriods.length - a.duePeriods.length);

  const supplierItems = suppliers.map((s) => ({
    id: s.id,
    name: s.nameShort ?? s.nameFull,
    sku: "",
    imageUrl: null,
    section: "ผู้ขาย",
    group: null,
    baseUnitName: null,
    detail: s.nameShort && s.nameShort !== s.nameFull ? s.nameFull : null,
  }));

  /** A link that sets some filters and keeps the rest. */
  const linkFor = (next: Partial<Record<"branch" | "supplier" | "source" | "status" | "from" | "to", string>>) => {
    const v = { branch: query.branchId ?? "", supplier: query.supplierId ?? "", source: query.source ?? "", status: query.paymentStatus ?? "", from: fromIso, to: toIso, ...next };
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(v)) if (val) q.set(k, val);
    const qs = q.toString();
    return qs ? `/expenses?${qs}` : "/expenses";
  };
  const wholeMonth = months.find((m) => m.from === fromIso && m.to === toIso);
  // The analysis page offers the last six months; a month it has opens there.
  const analysisQs = new URLSearchParams({
    ...(wholeMonth && wholeMonth.key >= months[5].key ? { m: wholeMonth.key } : {}),
    ...(query.branchId ? { branch: query.branchId } : {}),
  }).toString();
  const analysisHref = `/expenses/analysis${analysisQs ? `?${analysisQs}` : ""}`;
  const filtered = Boolean(scoped || query.branchId || query.supplierId || query.source || query.paymentStatus);
  const exportBranch = exportBranchScope(branches, query.branchId);

  return (
    <div className="space-y-5">
      <PageHeader
        help="expenses"
        title="ค่าใช้จ่าย"
        description="ทุกบาทที่ออกจากร้าน — ทั้งค่าของและค่าใช้จ่ายอื่น รวมอยู่ที่เดียว"
        actions={
          <>
            <a href="/expenses/recurring" className="btn-secondary">
              รายการประจำ
            </a>
            <a href="/expenses/new" className="btn">
              บันทึกค่าใช้จ่าย
            </a>
          </>
        }
      />

      {/*
        "ถึงกำหนด" — computed, never generated (ADR 0016 Q5). Nothing runs in the
        background in this stack, so a reminder means visible when someone opens
        the page; saying so is better than implying a notification that will
        never arrive. Still yellow: it is something somebody must do.
      */}
      {due.length > 0 && (
        <section data-help="expenses-due" className="rounded-[18px] border border-warn-border bg-warn-bg px-4 pb-2 pt-3.5">
          <h2 className="font-display text-[15px] font-semibold text-foreground">
            ถึงกำหนดบันทึก {dueCount} งวด · รายการประจำ {due.length} รายการ
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">ระบบไม่บันทึกให้เอง เพราะยอดจริงแต่ละเดือนไม่เท่ากัน · กดงวดเพื่อบันทึก</p>
          <ShowMore
            className="mt-1.5 divide-y divide-warn-border/80"
            head={dueSorted.slice(0, DUE_SHOWN).map((d) => <DueRow key={d.template.id} d={d} />)}
            tail={dueSorted.slice(DUE_SHOWN).map((d) => <DueRow key={d.template.id} d={d} />)}
            more={due.length > DUE_SHOWN ? `ดูอีก ${due.length - DUE_SHOWN} รายการ` : ""}
          />
        </section>
      )}

      <div data-help="expenses-kpis" className="space-y-2">
        <StatGrid>
          {/* Never ฿0 for "nothing recorded yet" (mise-ui-review §3). */}
          <Stat
            label={`รายจ่าย ${cardPeriod.label}`}
            icon={Receipt}
            value={inPeriod.length ? bahtWhole(sumOf(inPeriod, "subtotalExclVat")) : "—"}
            sub={inPeriod.length ? `${inPeriod.length.toLocaleString("th-TH")} บิล · ก่อน VAT` : "ยังไม่มีบิลในช่วงนี้"}
          />
          <Stat
            label="ยังไม่จ่าย"
            icon={Clock}
            href={linkFor({ status: "UNPAID" })}
            value={all.length === 0 ? "—" : bahtExact(sumOf(unpaid, "netPaymentAmount"))}
            sub={
              all.length === 0
                ? "ยังไม่มีบิล"
                : unpaid.length
                  ? `${unpaid.length.toLocaleString("th-TH")} บิล · ${scoped ? scopeLabel : "รวมทุกเดือน"} · ยอดจ่ายจริง`
                  : `จ่ายครบทุกบิล · ${scoped ? scopeLabel : "รวมทุกเดือน"}`
            }
          />
          <Stat
            label={`จ่ายแล้ว ${cardPeriod.label}`}
            icon={CircleCheck}
            href={scoped ? linkFor({ status: "PAID" }) : linkFor({ status: "PAID", from: thisMonth.from, to: thisMonth.to })}
            value={inPeriod.length === 0 ? "—" : bahtExact(sumOf(paid, "netPaymentAmount"))}
            sub={inPeriod.length === 0 ? "ยังไม่มีบิลในช่วงนี้" : paid.length ? `${paid.length.toLocaleString("th-TH")} บิล · ยอดจ่ายจริง` : "ยังไม่ได้จ่ายบิลในช่วงนี้"}
          />
          <Stat
            label="ประจำรอบันทึก"
            icon={CalendarClock}
            href="/expenses/recurring"
            tone={dueCount ? "warn" : undefined}
            value={dueCount ? `${dueCount} งวด` : "ครบแล้ว"}
            sub={dueCount ? `${due.length} รายการประจำ` : "ไม่มีงวดค้างบันทึก"}
          />
        </StatGrid>
        <p className="text-xs text-muted-foreground">
          รายจ่ายคิดก่อน VAT ตามวันที่บิล · ยอดจ่ายจริงคือยอดที่โอนให้ผู้ขาย (รวม VAT และหักภาษี ณ ที่จ่ายแล้ว) — สองยอดนี้คิดคนละฐาน จึงบวกลบกันไม่ได้
        </p>
      </div>

      <ExpenseFilters
        value={{
          branch: query.branchId ?? "",
          supplier: query.supplierId ?? "",
          source: query.source ?? "",
          status: query.paymentStatus ?? "",
          from: fromIso,
          to: toIso,
        }}
        branches={multiBranch ? branches.map((b) => ({ value: b.id, label: b.name })) : null}
        suppliers={supplierItems}
        sources={EXPENSE_SOURCE_VALUES.map((v) => ({ value: v, label: EXPENSE_SOURCE_LABELS_TH[v] }))}
        statuses={EXPENSE_PAYMENT_STATUS_VALUES.map((v) => ({ value: v, label: EXPENSE_PAYMENT_STATUS_LABELS_TH[v] }))}
        months={months}
        thisMonth={{ from: thisMonth.from, to: thisMonth.to }}
        actions={
          <>
            <ActionLink href={analysisHref}>ดูแยกหมวดและผู้ขาย</ActionLink>
            <ExportButton
              size="sm"
              dataset="expenses"
              params={{ branch: query.branchId, supplier: query.supplierId, source: query.source, status: query.paymentStatus }}
              period={fromIso && toIso ? { from: fromIso, to: toIso } : undefined}
              scope={[
                exportBranch.line,
                ...(query.supplierId ? [`ผู้ขาย: ${suppliers.find((x) => x.id === query.supplierId)?.nameFull ?? "—"}`] : []),
                ...(query.source ? [`ที่มา: ${EXPENSE_SOURCE_LABELS_TH[query.source]}`] : []),
                ...(query.paymentStatus ? [`การจ่ายเงิน: ${EXPENSE_PAYMENT_STATUS_LABELS_TH[query.paymentStatus]}`] : []),
              ]}
              branchName={exportBranch.name}
              today={iso(today)}
            />
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyTable help="expenses-list"
          label="รายการบิลค่าใช้จ่าย"
          columns={[
            { label: "วันที่บิล" },
            { label: "รายละเอียด" },
            ...(multiBranch ? [{ label: "สาขา", hide: "md" as const }] : []),
            { label: "ที่มา", hide: "sm" },
            { label: "ยอดรวม", right: true, hide: "sm" },
            { label: "จ่ายจริง", right: true },
            { label: "สถานะ", hide: "sm" },
          ]}
        >
          {filtered ? (
            <>
              ไม่มีบิลตามเงื่อนไขนี้{" "}
              <a href="/expenses" className="link">
                ดูทุกบิล
              </a>
            </>
          ) : (
            <>
              ยังไม่มีรายการค่าใช้จ่าย — กด &ldquo;บันทึกค่าใช้จ่าย&rdquo;
              เพื่อบันทึกบิลแรก (บิลค่าของจะถูกสร้างให้เองเมื่อยืนยันใบรับสินค้า)
            </>
          )}
        </EmptyTable>
      ) : (
        <div data-help="expenses-list">
          {/* A phone: one card per bill, the whole card opening it (the receipt
              list's pattern). The amount is what is actually paid. */}
          <ul className="space-y-2 sm:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <a
                  href={`/expenses/${r.id}`}
                  className="block rounded-[18px] border border-border/70 bg-surface p-3.5 shadow-card active:bg-surface-sunk"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-semibold">{expenseTitle(r)}</span>
                    <span className="shrink-0 font-display font-semibold tabular-nums">฿{formatMoney(r.netPaymentAmount)}</span>
                  </span>
                  <span className="mt-1 flex items-end justify-between gap-3">
                    <span className="min-w-0 text-xs text-muted-foreground">
                      {[
                        shortDate(r.billDate),
                        r.billNo,
                        multiBranch ? r.branchName : null,
                        EXPENSE_SOURCE_LABELS_TH[r.source],
                        r.period ? `งวด ${monthLabelTh(r.period)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <PaymentBadge status={r.paymentStatus} />
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <div className="data-table hidden sm:block">
            <table className="w-full min-w-[46rem]">
              <thead>
                <tr>
                  <th>วันที่บิล</th>
                  <th>รายละเอียด</th>
                  {multiBranch && <th>สาขา</th>}
                  <th>ที่มา</th>
                  <th className="text-right">ยอดรวม</th>
                  <th className="text-right">จ่ายจริง</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="group relative transition-colors hover:bg-surface-sunk">
                    <td className="whitespace-nowrap text-sm text-muted-foreground">{shortDate(r.billDate)}</td>
                    <td>
                      <a
                        href={`/expenses/${r.id}`}
                        className="whitespace-nowrap font-semibold text-foreground after:absolute after:inset-0 after:content-['']"
                      >
                        {expenseTitle(r)}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        {r.itemCount} รายการ
                        {r.billNo && ` · ${r.billNo}`}
                        {r.period && ` · งวด ${monthLabelTh(r.period)}`}
                      </div>
                    </td>
                    {multiBranch && <td className="text-sm">{r.branchName}</td>}
                    <td className="text-xs text-muted-foreground">{EXPENSE_SOURCE_LABELS_TH[r.source]}</td>
                    <td className="text-right text-sm tabular-nums">{formatMoney(r.totalAmount)}</td>
                    <td className="text-right text-sm font-medium tabular-nums">{formatMoney(r.netPaymentAmount)}</td>
                    <td>
                      <PaymentBadge status={r.paymentStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** One recurring item in the due box: what it is, then a pill per month owed. */
function DueRow({ d }: { d: DueRecurringView }) {
  const shown = d.duePeriods.slice(0, DUE_SHOWN);
  const rest = d.duePeriods.length - shown.length;
  return (
    <div className="grid gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-display text-sm font-semibold">{d.template.description}</p>
        <p className="text-xs text-muted-foreground">
          {d.template.branchName} · ทุกวันที่ {d.template.dayOfMonth} · ตั้งต้น ฿{formatMoney(d.template.defaultAmount)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        {shown.map((p) => (
          <a
            key={p}
            href={`/expenses/new?recurring=${d.template.id}&period=${p}`}
            aria-label={`บันทึก${d.template.description} งวด ${monthLabelTh(p)}`}
            className="btn-secondary btn-sm border-warn-border text-warn hover:border-warn hover:bg-warn-bg"
          >
            {monthLabelTh(p)}
          </a>
        ))}
        {rest > 0 && (
          <a href="/expenses/recurring" className="link text-xs">
            อีก {rest} งวด
          </a>
        )}
      </div>
    </div>
  );
}
