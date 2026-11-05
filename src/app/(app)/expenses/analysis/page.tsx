import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getExpenseAnalysisLogic, type ExpenseAnalysisFilter, type Ranked } from "@/server/expense-analysis";
import ExpenseDrill from "./_components/ExpenseDrill";
import ActionLink from "@/components/ui/ActionLink";
import { DailyBarsChart } from "@/app/(app)/dashboard/_components/Charts";
import { recentMonths } from "@/app/(app)/dashboard/_components/dashboard-period";
import FilterLink from "@/components/ui/FilterLink";
import WaitingFor, { Outline } from "@/components/ui/WaitingFor";
import { DashRows } from "@/components/ui/DashBar";
import PageHeader from "@/components/ui/PageHeader";
import Stat, { StatGrid } from "@/components/ui/Stat";
import ShowMore from "@/components/ui/ShowMore";
import PillScroller from "@/components/ui/PillScroller";
import { FileText, Receipt, Store, Tags } from "lucide-react";

// ============================================================
// Mise — วิเคราะห์รายจ่าย (Part 35 B)
// ============================================================
// Kong's "Dashboard รายจ่าย", rebuilt on Mise's bills. Every filter is a
// plain link and lives in the URL, so a view survives a refresh and can be
// sent to the accountant. Drilling down is a click on a row, not a pop-up:
// the row's link adds one more filter, and "ล้าง" takes it off again.
// ============================================================

type SP = Promise<{ m?: string; branch?: string; account?: string; section?: string; group?: string; supplier?: string }>;

const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const n = (d: { toString(): string }) => Number(d.toString());
const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" });

export default async function ExpenseAnalysisPage({ searchParams }: { searchParams: SP }) {
  const { tenantId, reach } = await requireTenant("expense:view");
  const sp = await searchParams;

  const months = recentMonths(6);
  const month = months.find((m) => m.key === sp.m) ?? months[months.length - 1];
  const branches = await getBranchesLogic(tenantId, reach);
  const branchId = branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const account = sp.account === "COGS" || sp.account === "OpEx" ? sp.account : undefined;

  // B4 (Kong 2026-10-24): month and branch are the only filters; drilling by
  // หมวด/กลุ่ม/ผู้ขาย happens in ExpenseDrill's popups. Old links that still
  // carry ?section=… are read so they keep working.
  const filter: ExpenseAnalysisFilter = {
    from: month.from,
    to: month.to,
    branchId,
    account,
    section: sp.section || undefined,
    group: sp.group || undefined,
    supplier: sp.supplier || undefined,
  };
  const a = await getExpenseAnalysisLogic(tenantId, filter, reach);

  // A link that sets one filter and keeps the rest. Changing a level clears
  // the levels beneath it — a group from another section is not a choice.
  const current = { m: month.key, branch: branchId, account, section: filter.section, group: filter.group, supplier: filter.supplier };
  const href = (next: Partial<typeof current>) => {
    const merged = { ...current, ...next };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/expenses/analysis?${q.toString()}`;
  };
  const toggle = (key: keyof typeof current, value: string, clears: (keyof typeof current)[] = []) => {
    const off = current[key] === value;
    const next: Partial<typeof current> = { [key]: off ? undefined : value };
    for (const c of clears) next[c] = undefined;
    return href(next);
  };

  const total = n(a.total);
  const scope = [
    `เดือน ${monthLabel(month.key)}`,
    branchId ? branches.find((b) => b.id === branchId)?.name : "ทุกสาขา",
    account ? (account === "COGS" ? "ต้นทุน" : "ค่าใช้จ่ายดำเนินงาน") : null,
    filter.section ? `หมวด “${filter.section}”` : null,
    filter.group ? `กลุ่ม “${filter.group}”` : null,
    filter.supplier ? `ผู้ขาย “${a.options.suppliers.find((s) => s.key === filter.supplier)?.label ?? "—"}”` : null,
  ].filter(Boolean);
  const narrowed = Boolean(account || filter.section || filter.group || filter.supplier);

  const rows = (list: Ranked[], mk: (r: Ranked) => string) =>
    list.map((r) => ({ key: r.key, label: r.label, value: n(r.amount), href: mk(r) }));
  const top = (list: Ranked[]) => list[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        help="expenses-analysis"
        title="วิเคราะห์รายจ่าย"
        description="ตามวันที่บิล ไม่รวม VAT · กดชิ้นในวงกลมหรือแถวเพื่อเจาะลงไปทีละชั้น"
        actions={<ActionLink href="/expenses" size="md">กลับไปรายการบิล</ActionLink>}
      />

      {/* --- filters: one row per level, sticky while scrolling (Kong's sample).
          Queue item 9: on a phone each row is ONE line that scrolls sideways,
          instead of six month pills breaking into two rows. --- */}
      <section className="sticky top-0 z-20 space-y-2.5 rounded-[18px] border border-border/70 bg-surface/95 px-4 py-3 shadow-card backdrop-blur lg:top-2">
        <FilterRow label="เดือน">
          {months.map((m) => (
            <Pill key={m.key} href={href({ m: m.key })} active={m.key === month.key}>
              {monthLabel(m.key)}
            </Pill>
          ))}
        </FilterRow>
        {branches.length > 1 ? (
          <FilterRow label="สาขา">
            <Pill href={href({ branch: undefined })} active={!branchId}>ทุกสาขา</Pill>
            {branches.map((b) => (
              <Pill key={b.id} href={toggle("branch", b.id)} active={b.id === branchId}>{b.name}</Pill>
            ))}
          </FilterRow>
        ) : null}
      </section>

      {/* --- headline --- */}
      {/* Queue item 9: the kit's number cards — an icon each, two by two on a phone. */}
      <StatGrid>
        {/* No bill recorded is "not known yet", not ฿0 spent (Kong's rule: never ฿0 for no data). */}
        <Stat
          label="รวมรายจ่าย"
          icon={Receipt}
          value={a.billCount === 0 ? "—" : baht(total)}
          sub={a.billCount === 0 ? "ยังไม่มีบิลที่ตรงเงื่อนไข" : `${a.lineCount.toLocaleString("th-TH")} รายการ`}
        />
        <Stat label="จำนวนบิล" icon={FileText} value={a.billCount === 0 ? "—" : a.billCount.toLocaleString("th-TH")} sub="บิลที่มีรายการตรงเงื่อนไข" />
        <Stat label="ผู้ขายที่จ่ายเยอะสุด" icon={Store} value={<Name text={top(a.bySupplier)?.label ?? "—"} />} sub={top(a.bySupplier) ? baht(n(top(a.bySupplier)!.amount)) : a.billCount === 0 ? "ยังไม่มีบิล" : "บิลที่ตรงเงื่อนไขไม่ได้ระบุผู้ขาย"} />
        <Stat
          label={filter.section ? "กลุ่มที่จ่ายเยอะสุด" : "หมวดที่จ่ายเยอะสุด"}
          icon={Tags}
          value={<Name text={top(filter.section ? a.byGroup : a.bySection)?.label ?? "—"} />}
          sub={top(filter.section ? a.byGroup : a.bySection) ? baht(n(top(filter.section ? a.byGroup : a.bySection)!.amount)) : a.billCount === 0 ? "ยังไม่มีบิล" : undefined}
        />
      </StatGrid>

      {total === 0 && !(filter.account || filter.section || filter.group || filter.supplier) ? (
        // Queue item 10: nothing recorded in the period is not a filter to clear.
        // Kong 2026-11-05: and the page's other two cards, dashed, so the
        // reader sees everything this page will show.
        <>
          <div className="rounded-[18px] border border-border/70 bg-surface p-5 shadow-card">
            <WaitingFor figure="expenseAnalysis" needs={["expense"]} reason="ยังไม่มีบิลค่าใช้จ่ายในช่วงนี้" />
          </div>
          <Card title="รายจ่ายรายวัน" hint={`${monthLabel(month.key)} · ตามวันที่บิล ไม่รวม VAT`}>
            <Outline shape="bars" sample="month" />
          </Card>
          <Card title="บิลที่เกี่ยวข้อง" hint="กดที่บิลเพื่อดูรายการข้างใน">
            <DashRows widths={[0.6, 0.45, 0.55]} bar={false} label="บิลที่เกี่ยวข้อง ยังไม่มีรายการ" />
          </Card>
        </>
      ) : total === 0 ? (
        <div className="rounded-[18px] border border-border/70 bg-surface shadow-card p-10 text-center text-sm text-muted-foreground">
          ไม่มีรายจ่ายที่ตรงกับเงื่อนไขนี้ ·{" "}
          <ActionLink href={href({ account: undefined, section: undefined, group: undefined, supplier: undefined })} className="ml-1">ล้างตัวกรอง</ActionLink>
        </div>
      ) : (
        <>
          <ExpenseDrill
            month={month.key}
            branch={branchId}
            total={total}
            sections={a.bySection.map((r) => ({ key: r.key, label: r.label, amount: n(r.amount) }))}
            suppliers={a.bySupplier.map((r) => ({ key: r.key, label: r.label, amount: n(r.amount) }))}
          />

          <Card title="รายจ่ายรายวัน" hint={`${monthLabel(month.key)} · ตามวันที่บิล ไม่รวม VAT`}>
            <DailyBarsChart label="รายจ่าย" month={month.key} rows={a.byDay.map((d) => ({ day: d.day, amount: n(d.amount) }))} />
          </Card>

          {/* Queue item 9 (Kong 2026-11-03, "เอาตามแนะนำ"): the first ten bills,
              the rest behind one press — the chart above is what the page is
              about, so nobody scrolls past 46 rows to leave it. No › on a row
              (mise-ui-review §1); the whole row opens its lines. */}
          <Card title="บิลที่เกี่ยวข้อง" hint={`${a.bills.length.toLocaleString("th-TH")} บิล · กดที่บิลเพื่อดูรายการข้างใน · ยอดคือส่วนที่ตรงเงื่อนไขเท่านั้น`}>
            <ShowMore
              className="divide-y divide-border overflow-hidden rounded-xl border border-border"
              head={a.bills.slice(0, BILLS_SHOWN).map((b) => <BillRow key={b.expenseId} b={b} />)}
              tail={a.bills.slice(BILLS_SHOWN, 100).map((b) => <BillRow key={b.expenseId} b={b} />)}
              more={a.bills.length > BILLS_SHOWN ? `ดูอีก ${(Math.min(a.bills.length, 100) - BILLS_SHOWN).toLocaleString("th-TH")} บิล` : ""}
            />
            {a.bills.length > 100 ? (
              <p className="mt-2 text-xs text-muted-foreground">แสดง 100 บิลแรกจาก {a.bills.length} บิล — กรองให้แคบลงเพื่อดูที่เหลือ</p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}

const BILLS_SHOWN = 10;

type Bill = Awaited<ReturnType<typeof getExpenseAnalysisLogic>>["bills"][number];

function BillRow({ b }: { b: Bill }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-surface-sunk group-open:bg-surface-sunk [&::-webkit-details-marker]:hidden">
        <span className="w-14 shrink-0 tabular-nums text-muted-foreground sm:w-16">
          {b.billDate.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" })}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-medium">{b.supplierName ?? "ไม่มีผู้ขาย"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {b.billNo ?? "ไม่มีเลขบิล"} · {b.branchName} · {b.lines.length} รายการ
          </span>
        </span>
        <span className="font-display font-medium tabular-nums">{baht(n(b.amount))}</span>
      </summary>
      <div className="space-y-2 bg-surface-sunk px-3 pb-3 pt-1">
        <table className="w-full text-xs">
          <tbody className="divide-y divide-border tabular-nums">
            {b.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5 pr-2">{l.productName ?? l.description}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{l.section} / {l.group}</td>
                <td className="py-1.5 pr-2 text-right">
                  {l.qty ? `${n(l.qty).toLocaleString("th-TH", { maximumFractionDigits: 3 })} ${l.unitName ?? ""}` : ""}
                </td>
                <td className="py-1.5 text-right font-medium">{baht(n(l.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionLink href={`/expenses/${b.expenseId}`}>เปิดบิลนี้</ActionLink>
      </div>
    </details>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground sm:w-12">{label}</span>
      <PillScroller className="-my-1 min-w-0 flex-1 py-1">{children}</PillScroller>
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <FilterLink href={href} aria-current={active ? "true" : undefined} className={`pill shrink-0 ${active ? "is-on" : ""}`}>
      {children}
    </FilterLink>
  );
}

/** A name in a number card: smaller than a figure, one line, the full name on hover. */
function Name({ text }: { text: string }) {
  return (
    <span className="block truncate text-[17px]" title={text}>
      {text}
    </span>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-border/70 bg-surface shadow-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="mb-4 mt-0.5 text-xs text-muted-foreground">{hint}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}
