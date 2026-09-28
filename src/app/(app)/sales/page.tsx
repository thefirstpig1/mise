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
  groupSalesDaysByDate,
  toSalesDayRowView,
  toSalesSummaryView,
} from "./_components/sales-view";
import DayDetailModal from "./_components/DayDetailModal";
import { CategoryShare, type ToneMap } from "./_components/Breakdown";
import { solid, toneOf } from "@/components/charts/chart-theme";
import StickyFilters from "./_components/StickyFilters";
import Link from "next/link";
import { MenuTable, SalesDailyChart, WeekdayChart } from "./_components/SalesCharts";
import BarList from "@/components/charts/BarList";
import { RowChevron } from "@/components/ui/ActionLink";
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
  const { tenantId, reach, can } = await requireTenant("sales:view");
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
    // Every menu: the table lists them all and the category popup needs each one.
    getSalesSummaryLogic(tenantId, query, { menuLimit: Number.MAX_SAFE_INTEGER }),
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
          }),
          { menuLimit: Number.MAX_SAFE_INTEGER }
        )
      )
    : null;

  // Filters as pills — every one a plain link that keeps the others.
  const fromIso = one("from") ?? month.from;
  const toIso = one("to") ?? month.to;
  const link = (next: Record<string, string | undefined>) => {
    const cur: Record<string, string | undefined> = { branch: one("branch"), from: fromIso, to: toIso, category: one("category"), day: undefined };
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
  // What the one-line filter bar says once the full card has scrolled away.
  const monthPicked = months.find((m) => m.from === fromIso && m.to === toIso);
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
  const filterSummary = [
    monthPicked ? monthPicked.label : `${shortDate(fromIso)} – ${shortDate(toIso)}`,
    branches.find((b) => b.id === one("branch"))?.name ?? "ทุกสาขา",
    categories.find((c) => c.id === one("category"))?.name ?? "ทุกหมวด",
  ].join(" · ");

  // One colour per category for the whole page, in the period's order, so a
  // category looks the same in the share list, its popup and the day popup.
  const catKey = (id: string | null) => id ?? "none";
  const tones: ToneMap = Object.fromEntries(s.byCategory.map((c, i) => [catKey(c.menuCategoryId), toneOf(i)]));
  const toBreakdownMenus = (list: typeof s.topMenus) =>
    list.map((m) => ({
      id: m.menuId,
      name: m.name,
      categoryKey: catKey(m.menuCategoryId),
      net: Number(m.net),
      qty: Number(m.qty),
    }));

  // Every menu sold in the period sits in no category: the category views can
  // only say one thing, so say what would make them useful instead.
  const noMenuCategories = s.topMenus.length > 0 && s.topMenus.every((m) => !m.menuCategoryId);
  const dayGroups = groupSalesDaysByDate(daysRaw.map(toSalesDayRowView));
  // Several branches fold into one row only when more than one is in view.
  const multiBranch = !query.branchId && branches.length > 1;
  const dayHref = (day: string) => link({ day });

  // The popup's neighbours are the dates that HAVE data, newest first.
  const dayIndex = dayValid ? dayGroups.findIndex((g) => g.day === dayValid) : -1;
  const openGroup = dayIndex >= 0 ? dayGroups[dayIndex] : null;
  const olderDay = dayIndex >= 0 ? dayGroups[dayIndex + 1]?.day ?? null : null;
  const newerDay = dayIndex > 0 ? dayGroups[dayIndex - 1]?.day ?? null : null;
  const modalBranches = (query.branchId ? branches.filter((b) => b.id === query.branchId) : branches).map((b) => {
    const r = openGroup?.branches.find((x) => x.branchId === b.id);
    return {
      branchId: b.id,
      name: b.name,
      // No file = no figure. A pulse-only day is a day WAITING for its file, not ฿0.
      net: r?.fileName ? Number(r.net) : null,
      fileName: r?.fileName ?? null,
      importedAtLabel: r?.importedAtLabel ?? null,
      pulseAmount: r?.pulseAmount ? Number(r.pulseAmount) : null,
      pulseDifference: r?.pulseDifference ? Number(r.pulseDifference) : null,
      pulseIsMismatch: r?.pulseIsMismatch ?? false,
      pulseNote: r?.pulseNote ?? null,
    };
  });
  const empty = s.totals.rows === 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">ยอดขาย</h2>
        <ActionLink href="/sales/import">นำเข้ายอดขาย</ActionLink>
      </div>

      {/* ---------- filters (Part 35 C: pills, sticky, like Kong's sheet) ---------- */}
      <StickyFilters summary={filterSummary}>
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
      </StickyFilters>

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
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">กดที่แท่งเพื่อดูรายละเอียดของวันนั้น</p>
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

          {daySummary && dayValid ? (
            <DayDetailModal
              day={dayValid}
              title={`${new Date(`${dayValid}T00:00:00Z`).toLocaleDateString("th-TH", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}`}
              net={Number(daySummary.totals.net)}
              qty={Number(daySummary.totals.qty)}
              categories={daySummary.byCategory.map((c) => ({
                key: c.menuCategoryId ?? "none",
                label: c.name,
                net: Number(c.net),
                qty: Number(c.qty),
              }))}
              menus={toBreakdownMenus(daySummary.topMenus)}
              tones={tones}
              branches={modalBranches}
              canKeyPulse={can("sales:import")}
              closeHref={link({})}
              prevHref={olderDay ? dayHref(olderDay) : null}
              nextHref={newerDay ? dayHref(newerDay) : null}
            />
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold">วันไหนของสัปดาห์ขายดี</h3>
              <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
                เฉลี่ยต่อวัน หารด้วยจำนวนวันนั้นที่มีจริงในช่วง — วันที่ขายดีที่สุดเป็นแท่งสีส้มอิฐ · ใช้วางกะพนักงาน
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
              <p className="mb-4 mt-0.5 text-xs text-muted-foreground">กดหมวดเพื่อดูเมนูในหมวดนั้น</p>
              {noMenuCategories && <UncategorisedHint />}
              <CategoryShare
                total={totalNet}
                tones={tones}
                periodLabel={filterSummary.split(" · ")[0]}
                categories={s.byCategory.map((c) => ({
                  key: catKey(c.menuCategoryId),
                  label: c.name,
                  net: Number(c.net),
                  qty: Number(c.qty),
                }))}
                menus={toBreakdownMenus(s.topMenus)}
                filterHref={Object.fromEntries(
                  s.byCategory.filter((c) => c.menuCategoryId).map((c) => [c.menuCategoryId!, link({ category: c.menuCategoryId! })])
                )}
              />
            </section>
          </div>

          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">เมนูทำเงินสูงสุด</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              ทั้ง {s.topMenus.length} เมนูของช่วงนี้ · ค้นหาได้ · กดหัวคอลัมน์เพื่อเรียงลำดับ
            </p>
            {noMenuCategories && <UncategorisedHint />}
            <MenuTable
              total={totalNet}
              rows={s.topMenus.map((m) => ({
                id: m.menuId,
                name: m.name,
                category: m.menuCategoryName ?? "—",
                color: m.menuCategoryId ? solid(tones[catKey(m.menuCategoryId)] ?? "olive") : null,
                qty: Number(m.qty),
                net: Number(m.net),
                stub: m.isPosStub,
              }))}
            />
          </section>

          {/* ---------- the days themselves ---------- */}
          {/* Kong (2026-09-28): one row per DATE (branches fold together and come
              apart again in the popup), the whole row opens that day, and the
              file name stands alone — when it was imported is on hover. */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">รายวัน</h3>
            <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
              กดแถวเพื่อดูรายละเอียดของวันนั้น{multiBranch ? " แยกตามสาขา" : ""} ·
              ในวงเล็บคือ <strong>ยอดจากไฟล์ − ยอดที่คีย์ตอนปิดร้าน</strong> ติดลบแปลว่าไฟล์ได้น้อยกว่าที่เครื่องเก็บเงินบอก
              มักแปลว่า export มาไม่ครบทั้งวัน
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-2 py-2 text-left font-medium">วันที่</th>
                    <th className="px-2 py-2 text-right font-medium">ยอดขาย</th>
                    <th className="px-2 py-2 text-right font-medium">รายการ</th>
                    <th className="px-2 py-2 text-right font-medium">ยอดที่คีย์ตอนปิดร้าน</th>
                    <th className="px-2 py-2 text-left font-medium">ที่มา</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {dayGroups.map((g) => (
                    <tr
                      key={g.day}
                      className={`group relative border-b border-border/50 transition-colors hover:bg-muted/40 ${
                        g.day === dayValid ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-2 py-2">
                        <Link
                          href={dayHref(g.day) as never}
                          scroll={false}
                          className="after:absolute after:inset-0 after:content-[''] group-hover:text-primary"
                        >
                          {g.dayLabel} <span className="text-muted-foreground">({g.weekdayLabel})</span>
                        </Link>
                        {multiBranch && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {g.branches.length === 1 ? g.branches[0].branchName : `${g.branches.length} สาขา`}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-medium tabular-nums">
                        {g.fileNames.length === 0 ? <span className="text-muted-foreground">—</span> : `฿${bahtShort(g.net)}`}
                      </td>
                      <td className="px-2 py-2 text-right text-muted-foreground tabular-nums">{g.rows}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {g.pulseAmount !== null ? (
                          <>
                            <span>฿{bahtShort(g.pulseAmount)}</span>
                            {g.pulseDifference !== null && (
                              <span
                                className={`ml-1 text-xs ${g.pulseIsMismatch ? "font-medium text-bad" : "text-muted-foreground"}`}
                              >
                                ({Number(g.pulseDifference) >= 0 ? "+" : ""}
                                {bahtShort(g.pulseDifference)})
                              </span>
                            )}
                          </>
                        ) : g.pulseKeyedCount > 0 ? (
                          <span className={`text-xs ${g.pulseIsMismatch ? "font-medium text-bad" : "text-muted-foreground"}`}>
                            คีย์ {g.pulseKeyedCount}/{g.branches.length} สาขา
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">ไม่ได้คีย์</span>
                        )}
                      </td>
                      <td className="max-w-[16rem] truncate px-2 py-2 text-xs text-muted-foreground">
                        {g.fileNames.length === 0 ? (
                          "ยังไม่มีไฟล์"
                        ) : (
                          <span
                            title={g.branches
                              .filter((b) => b.fileName)
                              .map((b) => `${b.branchName}: ${b.fileName} · นำเข้า ${b.importedAtLabel}`)
                              .join(" / ")}
                          >
                            {g.fileNames.length === 1 ? g.fileNames[0] : `${g.fileNames.length} ไฟล์`}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <RowChevron />
                      </td>
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

function UncategorisedHint() {
  return (
    <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      เมนูยังไม่ได้จัดหมวด จึงแยกยอดตามหมวดไม่ได้ —{" "}
      <a href="/menus" className="font-medium text-primary underline">
        จัดหมวดที่หน้าเมนู
      </a>{" "}
      แล้วสัดส่วนหมวดกับตารางนี้จะแยกให้เอง
    </p>
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
