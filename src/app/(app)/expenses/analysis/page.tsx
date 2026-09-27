import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getExpenseAnalysisLogic, type ExpenseAnalysisFilter, type Ranked } from "@/server/expense-analysis";
import BarList from "@/components/charts/BarList";
import ActionLink from "@/components/ui/ActionLink";
import { DailyBarsChart } from "@/app/(app)/dashboard/_components/Charts";
import { recentMonths } from "@/app/(app)/dashboard/_components/dashboard-period";

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">วิเคราะห์รายจ่าย</h1>
          <p className="mt-1 text-sm text-muted-foreground">ตามวันที่บิล ไม่รวม VAT · กดแถวในกราฟเพื่อเจาะลงไปทีละชั้น</p>
        </div>
        <ActionLink href="/expenses">กลับไปรายการบิล</ActionLink>
      </div>

      {/* --- filters: one row per level, sticky while scrolling (Kong's sample) --- */}
      <section className="sticky top-0 z-20 space-y-3 rounded-xl border border-border bg-surface/95 p-4 shadow-sm backdrop-blur lg:top-2">
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
        <FilterRow label="ประเภท">
          <Pill href={toggle("account", "COGS", ["section", "group"])} active={account === "COGS"}>ต้นทุน (ซื้อเข้าครัว)</Pill>
          <Pill href={toggle("account", "OpEx", ["section", "group"])} active={account === "OpEx"}>ค่าใช้จ่ายดำเนินงาน</Pill>
        </FilterRow>
        {a.options.sections.length > 1 || filter.section ? (
          <FilterRow label="หมวด">
            {a.options.sections.map((s) => (
              <Pill key={s} href={toggle("section", s, ["group"])} active={s === filter.section}>{s}</Pill>
            ))}
          </FilterRow>
        ) : null}
        {filter.section ? (
          <FilterRow label="กลุ่ม">
            {a.options.groups.map((g) => (
              <Pill key={g} href={toggle("group", g)} active={g === filter.group}>{g}</Pill>
            ))}
          </FilterRow>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-sunk px-3 py-2 text-sm">
          <p>
            <span className="font-medium">กำลังดู:</span> {scope.join(" · ")}
            {narrowed ? <span className="text-muted-foreground"> — นับเฉพาะรายการในบิลที่ตรงเงื่อนไข ไม่ใช่ยอดทั้งบิล</span> : null}
          </p>
          {narrowed ? <ActionLink href={href({ account: undefined, section: undefined, group: undefined, supplier: undefined })}>ล้างตัวกรอง</ActionLink> : null}
        </div>
      </section>

      {/* --- headline --- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="รวมรายจ่าย" value={baht(total)} sub={`${a.lineCount.toLocaleString("th-TH")} รายการ`} />
        <Stat label="จำนวนบิล" value={a.billCount.toLocaleString("th-TH")} sub="บิลที่มีรายการตรงเงื่อนไข" />
        <Stat label="ผู้ขายที่จ่ายเยอะสุด" value={top(a.bySupplier)?.label ?? "—"} sub={top(a.bySupplier) ? baht(n(top(a.bySupplier)!.amount)) : undefined} small />
        <Stat
          label={filter.section ? "กลุ่มที่จ่ายเยอะสุด" : "หมวดที่จ่ายเยอะสุด"}
          value={top(filter.section ? a.byGroup : a.bySection)?.label ?? "—"}
          sub={top(filter.section ? a.byGroup : a.bySection) ? baht(n(top(filter.section ? a.byGroup : a.bySection)!.amount)) : undefined}
          small
        />
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-muted-foreground">
          ไม่มีรายจ่ายที่ตรงกับเงื่อนไขนี้ ·{" "}
          <ActionLink href={href({ account: undefined, section: undefined, group: undefined, supplier: undefined })} className="ml-1">ล้างตัวกรอง</ActionLink>
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card
              title={filter.section ? `กลุ่มใน “${filter.section}”` : account ? "แยกตามหมวด" : "แยกตามหมวด"}
              hint="% คือสัดส่วนของรายจ่ายที่กำลังดู · กดแถวเพื่อเจาะลงไป"
            >
              <BarList
                total={total}
                groups={[
                  {
                    rows: filter.section
                      ? rows(a.byGroup, (r) => toggle("group", r.key))
                      : rows(a.bySection, (r) => toggle("section", r.key, ["group"])),
                  },
                ]}
              />
            </Card>
            <Card title="ผู้ขายที่จ่ายเยอะสุด 10 อันดับ" hint="กดชื่อผู้ขายเพื่อดูเฉพาะบิลของผู้ขายนั้น">
              <BarList total={total} groups={[{ rows: rows(a.bySupplier.slice(0, 10), (r) => toggle("supplier", r.key)) }]} />
            </Card>
          </div>

          <Card title="รายจ่ายรายวัน" hint="รวมตามวันที่บิล">
            <DailyBarsChart label="รายจ่าย" rows={a.byDay.map((d) => ({ day: d.day, amount: n(d.amount) }))} />
          </Card>

          {a.products.length > 0 && (filter.group || filter.section || filter.supplier) ? (
            <Card title="รายวัตถุดิบ" hint="ซื้อเท่าไร ราคาเฉลี่ยต่อหน่วยเท่าไร — ราคาเฉลี่ยแสดงเมื่อทุกบิลซื้อด้วยหน่วยเดียวกัน">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunk text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">วัตถุดิบ</th>
                      <th className="px-3 py-2 text-right font-medium">จำนวนที่ซื้อ</th>
                      <th className="px-3 py-2 text-right font-medium">ราคาเฉลี่ย/หน่วย</th>
                      <th className="px-3 py-2 text-right font-medium">รวม</th>
                      <th className="px-3 py-2 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {a.products.map((p) => (
                      <tr key={p.productId}>
                        <td className="px-3 py-2">
                          <a href={`/products/${p.productId}`} className="font-medium text-primary hover:underline">{p.name}</a>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {p.unitName ? `${n(p.qty).toLocaleString("th-TH", { maximumFractionDigits: 2 })} ${p.unitName}` : "หลายหน่วย"}
                        </td>
                        <td className="px-3 py-2 text-right">{p.avgPrice ? baht(n(p.avgPrice)) : "—"}</td>
                        <td className="px-3 py-2 text-right font-medium">{baht(n(p.amount))}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{((n(p.amount) / total) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <Card title="บิลที่เกี่ยวข้อง" hint="กดที่บิลเพื่อดูรายการข้างใน · ยอดคือส่วนที่ตรงเงื่อนไขเท่านั้น">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {a.bills.slice(0, 100).map((b) => (
                <li key={b.expenseId}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted">
                      <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                        {b.billDate.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" })}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{b.supplierName ?? "ไม่มีผู้ขาย"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {b.billNo ?? "ไม่มีเลขบิล"} · {b.branchName} · {b.lines.length} รายการ
                        </span>
                      </span>
                      <span className="tabular-nums font-medium">{baht(n(b.amount))}</span>
                      <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                    </summary>
                    <div className="space-y-2 bg-surface-sunk px-3 py-3">
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
                </li>
              ))}
            </ul>
            {a.bills.length > 100 ? (
              <p className="mt-2 text-xs text-muted-foreground">แสดง 100 บิลแรกจาก {a.bills.length} บิล — กรองให้แคบลงเพื่อดูที่เหลือ</p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"
      }`}
    >
      {children}
    </a>
  );
}

function Stat({ label, value, sub, small }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 font-semibold ${small ? "truncate text-lg" : "tabular-nums text-2xl"}`} title={value}>{value}</p>
      {sub ? <p className="mt-0.5 tabular-nums text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="mb-4 mt-0.5 text-xs text-muted-foreground">{hint}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}
