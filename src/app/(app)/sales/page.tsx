// Sprint 4 Part 19 L5 — /sales: what was sold, and what the file cannot say.
//
// Server Component. Filters live in the URL (`?branch=&from=&to=&category=`) so
// the view is linkable and `revalidatePath("/sales")` from the L4 write path
// refreshes whatever the user is actually looking at.
//
// The page is organised around the angles the shop's previous spreadsheet
// actually used — total after discount, the category share, the per-menu table,
// discount as a percentage of the pre-discount total — plus the one it could
// never do: **by day of week**, which is the number staffing is planned from.
// That angle is the reason `business_date` is stored as a plain DATE.
//
// The availability notices are not filler. A daily-summary export carries no
// bill and no time, so rather than printing a 0 that reads as "none", the page
// says the file does not contain them (rule P11).
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getSalesDaysLogic, getSalesSummaryLogic } from "@/server/sales";
import { getMenuCategoriesLogic } from "@/server/menu";
import { getSalesQuerySchema } from "@/lib/validations/sales-import";
import {
  toSalesDayRowView,
  toSalesSummaryView,
} from "./_components/sales-view";
import { MenuTable, SalesDailyChart, WeekdayChart } from "./_components/SalesCharts";
import BarList from "@/components/charts/BarList";
import ActionLink from "@/components/ui/ActionLink";
import { recentMonths } from "@/app/(app)/dashboard/_components/dashboard-period";


import EmptyState from "@/components/ui/EmptyState";
const baht = (v: string) =>
  Number(v).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bahtShort = (v: string) => Number(v).toLocaleString("th-TH", { maximumFractionDigits: 0 });

/** Defaults to THIS MONTH, the period a shop actually reviews (the /waste rule). */
function currentMonthBangkok(): { from: string; to: string } {
  const today = computeBangkokToday();
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: first.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId, reach} = await requireTenant("sales:view");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const month = currentMonthBangkok();
  const parsed = getSalesQuerySchema.safeParse({
    branchId: one("branch"),
    from: one("from") ?? month.from,
    to: one("to") ?? month.to,
    menuCategoryId: one("category"),
    includeSuperseded: "false",
  });
  const query = parsed.success
    ? parsed.data
    : {
        branchId: undefined,
        from: new Date(`${month.from}T00:00:00.000Z`),
        to: new Date(`${month.to}T00:00:00.000Z`),
        menuCategoryId: undefined,
        includeSuperseded: false,
      };

  const [branches, categories, summaryRaw, daysRaw] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    getMenuCategoriesLogic(tenantId),
    getSalesSummaryLogic(tenantId, query),
    getSalesDaysLogic(tenantId, {
      branchId: query.branchId,
      from: query.from,
      to: query.to,
    }),
  ]);

  const s = toSalesSummaryView(summaryRaw);

  // Part 35 C — a clicked day opens below the chart (Kong's "click a bar to
  // see that day"). Its own summary, the same function, one day wide.
  const dayParam = one("day");
  const dayValid = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;
  const daySummary = dayValid
    ? toSalesSummaryView(
        await getSalesSummaryLogic(
          tenantId,
          getSalesQuerySchema.parse({
            branchId: query.branchId,
            from: dayValid,
            to: dayValid,
            menuCategoryId: query.menuCategoryId,
            includeSuperseded: "false",
          })
        )
      )
    : null;

  // Filters as pills — every one a plain link that keeps the others.
  const fromIso = one("from") ?? month.from;
  const toIso = one("to") ?? month.to;
  const link = (next: Record<string, string | undefined>) => {
    const cur: Record<string, string | undefined> = { branch: one("branch"), from: fromIso, to: toIso, category: one("category") };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...cur, ...next })) if (v) q.set(k, v);
    return `/sales?${q.toString()}`;
  };
  const months = recentMonths(6).map((m) => ({
    key: m.key,
    from: m.from.toISOString().slice(0, 10),
    to: m.to.toISOString().slice(0, 10),
    label: new Date(`${m.key}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" }),
  }));
  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`;
  const totalNet = Number(s.totals.net);
  const days = daysRaw.map(toSalesDayRowView);
  const empty = s.totals.rows === 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">ยอดขาย</h2>
        <ActionLink href="/sales/import">นำเข้ายอดขาย</ActionLink>
      </div>

      {/* ---------- filters (Part 35 C: pills, sticky, like Kong's sheet) ---------- */}
      <section className="sticky top-0 z-20 space-y-3 rounded-xl border border-border bg-surface/95 p-4 shadow-sm backdrop-blur lg:top-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">เดือน</span>
          {months.map((m) => (
            <a key={m.key} href={link({ from: m.from, to: m.to })} className={pill(fromIso === m.from && toIso === m.to)}>
              {m.label}
            </a>
          ))}
        </div>
        {branches.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">สาขา</span>
            <a href={link({ branch: undefined })} className={pill(!one("branch"))}>ทุกสาขา</a>
            {branches.map((b) => (
              <a key={b.id} href={link({ branch: one("branch") === b.id ? undefined : b.id })} className={pill(one("branch") === b.id)}>
                {b.name}
              </a>
            ))}
          </div>
        ) : null}
        {categories.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">หมวดเมนู</span>
            <a href={link({ category: undefined })} className={pill(!one("category"))}>ทุกหมวด</a>
            {categories.map((c) => (
              <a key={c.id} href={link({ category: one("category") === c.id ? undefined : c.id })} className={pill(one("category") === c.id)}>
                {c.name}
              </a>
            ))}
          </div>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-xs font-medium text-primary">กำหนดช่วงวันที่เอง</summary>
          <form className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          สาขา
          <select name="branch" defaultValue={one("branch") ?? ""} className={"input mt-1 block"}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          ตั้งแต่
          <input type="date" name="from" defaultValue={one("from") ?? month.from} className={"input mt-1 block"} />
        </label>
        <label className="text-sm">
          ถึง
          <input type="date" name="to" defaultValue={one("to") ?? month.to} className={"input mt-1 block"} />
        </label>
        <label className="text-sm">
          หมวดเมนู
          <select name="category" defaultValue={one("category") ?? ""} className={"input mt-1 block"}>
            <option value="">ทุกหมวด</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm">
          ดู
        </button>
      </form>
        </details>
      </section>

      {empty ? (
        <EmptyState art="none">
          <p className="font-medium">ยังไม่มียอดขายในช่วงนี้</p>
          <p className="mt-2 text-muted-foreground">
            ยอดขายเข้าระบบด้วยการนำเข้าไฟล์จาก POS — ไฟล์เดียวครอบได้หลายวัน
          </p>
          <a
            href="/sales/import"
            className="btn mt-4 inline-block"
          >
            นำเข้ายอดขาย
          </a>
        </EmptyState>
      ) : (
        <>
          {/* ---------- totals ---------- */}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="ยอดขาย (หลังหักส่วนลด)" value={`฿${baht(s.totals.net)}`} note="ไม่รวม VAT และ Service charge" />
            <Tile label="จำนวนที่ขายได้" value={Number(s.totals.qty).toLocaleString("th-TH")} note={`${s.totals.days} วันที่มีข้อมูล`} />
            <Tile label="ส่วนลดรวม" value={`฿${baht(s.totals.discount)}`} note={`${s.totals.discountPercent}% ของยอดก่อนหัก`} />
            <Tile label="VAT ขาย" value={`฿${baht(s.totals.vat)}`} note={`Service charge ฿${bahtShort(s.totals.serviceCharge)}`} />
          </section>

          {(s.availability.billNotice || s.availability.timeNotice) && (
            <section className="rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
              {s.availability.billNotice && <p>{s.availability.billNotice}</p>}
              {s.availability.timeNotice && <p className="mt-1">{s.availability.timeNotice}</p>}
            </section>
          )}

          {s.unidentifiedMenuCount > 0 && (
            <section className="rounded-lg border border-warn/50 bg-warn/5 p-3 text-sm">
              มีเมนูที่ยังไม่ได้ตรวจ {s.unidentifiedMenuCount} รายการในช่วงนี้ —{" "}
              <a href="/menus?stubs=true" className="text-primary underline">
                ไปจัดการ
              </a>
            </section>
          )}

          {/* ---------- Part 35 C: the charts Kong's sheet had ---------- */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">ยอดขายรายวัน</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">กดที่แท่งเพื่อดูรายละเอียดของวันนั้น · กดซ้ำเพื่อปิด</p>
            <SalesDailyChart
              activeDay={dayValid}
              rows={s.byDay.map((d) => ({
                day: d.businessDate.slice(0, 10),
                label: d.dayLabel,
                weekday: d.weekdayLabel,
                net: Number(d.net),
                qty: Number(d.qty),
              }))}
            />
          </section>

          {daySummary ? (
            <section id="day" className="rounded-xl border-2 border-primary-line bg-surface p-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">
                    วันที่{" "}
                    {new Date(`${dayValid}T00:00:00Z`).toLocaleDateString("th-TH", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    ยอดขาย ฿{bahtShort(daySummary.totals.net)} · {Number(daySummary.totals.qty).toLocaleString("th-TH")} จาน
                  </p>
                </div>
                <ActionLink href={link({})}>ปิดวันนี้</ActionLink>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium">แยกตามหมวดเมนู</p>
                  <BarList
                    total={Number(daySummary.totals.net)}
                    groups={[
                      {
                        rows: daySummary.byCategory.map((c) => ({
                          key: c.menuCategoryId ?? "none",
                          label: c.name,
                          value: Number(c.net),
                        })),
                      },
                    ]}
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">เมนูของวันนี้</p>
                  <BarList
                    total={Number(daySummary.totals.net)}
                    groups={[
                      {
                        rows: daySummary.topMenus.slice(0, 12).map((m) => ({
                          key: m.menuId,
                          label: m.name,
                          detail: `${Number(m.qty).toLocaleString("th-TH")} จาน`,
                          value: Number(m.net),
                        })),
                      },
                    ]}
                  />
                </div>
              </div>
            </section>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold">วันไหนของสัปดาห์ขายดี</h3>
              <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
                เฉลี่ยต่อวัน หารด้วยจำนวนวันนั้นที่มีจริงในช่วง — วันที่ขายดีที่สุดเป็นแท่งเข้ม · ใช้วางกะพนักงาน
              </p>
              <WeekdayChart
                rows={[1, 2, 3, 4, 5, 6, 0]
                  .map((wd) => s.byWeekday.find((w) => w.weekday === wd))
                  .filter((w): w is NonNullable<typeof w> => Boolean(w))
                  .map((w) => ({ label: w.weekdayLabel, average: Number(w.averageNet), days: w.dayCount }))}
              />
            </section>
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold">สัดส่วนหมวดเมนู</h3>
              <p className="mb-4 mt-0.5 text-xs text-muted-foreground">กดหมวดเพื่อดูเฉพาะเมนูในหมวดนั้นทั้งหน้า</p>
              <BarList
                total={totalNet}
                groups={[
                  {
                    rows: s.byCategory.map((c) => ({
                      key: c.menuCategoryId ?? "none",
                      label: c.name,
                      detail: `${Number(c.qty).toLocaleString("th-TH")} จาน`,
                      value: Number(c.net),
                      href: c.menuCategoryId ? link({ category: c.menuCategoryId }) : undefined,
                    })),
                  },
                ]}
              />
            </section>
          </div>

          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">เมนูทำเงินสูงสุด</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              {s.topMenus.length} อันดับแรกของช่วงนี้ · ค้นหาได้ · กดหัวคอลัมน์เพื่อเรียงลำดับ
            </p>
            <MenuTable
              total={totalNet}
              rows={s.topMenus.map((m) => ({
                id: m.menuId,
                name: m.name,
                category: m.menuCategoryName ?? "—",
                qty: Number(m.qty),
                net: Number(m.net),
                stub: m.isPosStub,
              }))}
            />
          </section>

          {/* ---------- the days themselves ---------- */}
          <section>
            <h3 className="text-sm font-medium">รายวัน</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              แต่ละวันมาจากไฟล์ไหน — อัปไฟล์ทับวันเดิมได้ ระบบจะแทนที่ทั้งวัน ·
              ตัวเลขในวงเล็บคือ <strong>ยอดจากไฟล์ − ยอดที่คีย์ตอนปิดร้าน</strong> (เทียบยอดที่ลูกค้าจ่ายทั้งคู่)
              ติดลบแปลว่าไฟล์ได้น้อยกว่าที่เครื่องเก็บเงินบอก มักแปลว่า export มาไม่ครบทั้งวัน
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-2 py-1 text-left">วันที่</th>
                    <th className="px-2 py-1 text-right">ยอดขาย</th>
                    <th className="px-2 py-1 text-right">รายการ</th>
                    <th className="px-2 py-1 text-right">ยอดที่คีย์ตอนปิดร้าน</th>
                    <th className="px-2 py-1 text-left">ที่มา</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.businessDate} className="border-b border-border/50">
                      <td className="px-2 py-1">
                        {d.dayLabel} <span className="text-muted-foreground">({d.weekdayLabel})</span>
                      </td>
                      <td className="px-2 py-1 text-right font-medium">฿{bahtShort(d.net)}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{d.rows}</td>
                      <td className="px-2 py-1 text-right">
                        {d.pulseAmount === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span>฿{bahtShort(d.pulseAmount)}</span>
                            {d.pulseDifference !== null && (
                              <span
                                className={`ml-1 text-xs ${d.pulseIsMismatch ? "font-medium text-bad" : "text-muted-foreground"}`}
                              >
                                ({Number(d.pulseDifference) >= 0 ? "+" : ""}
                                {bahtShort(d.pulseDifference)})
                              </span>
                            )}
                          </>
                        )}
                        {d.pulseNote && (
                          <span className="block text-[10px] text-muted-foreground">
                            “{d.pulseNote}”
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{d.sourceLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
