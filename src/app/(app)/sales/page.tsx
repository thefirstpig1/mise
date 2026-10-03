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
import { getSalesDaysLogic, getSalesMenuDaysWithComparisonLogic, getSalesTotalsLogic } from "@/server/sales";
import { getMenuCostMapLogic } from "@/server/sales-insight-read";
import {
  METRIC_LABELS_TH,
  comparisonRange,
  enrich,
  periodLabelTh,
  periodStats,
  type CostMap,
  type Metric,
} from "@/lib/sales-insight";
import { getMenuCategoriesLogic } from "@/server/menu";
import { getSalesQuerySchema } from "@/lib/validations/sales-import";
import {
  groupSalesDaysByDate,
  toSalesDayRowView,
  toSalesTotalsView,
} from "./_components/sales-view";
import SalesAnalysis from "./_components/SalesAnalysis";
import { buildSalesView, tonesFor, type SalesView } from "./_components/sales-views";
import type { ToneMap } from "./_components/Breakdown";
import { toneOf } from "@/components/charts/chart-theme";
import StickyFilters from "./_components/StickyFilters";
import Link from "next/link";
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
  const { tenantId, reach, can, costAccess } = await requireTenant("sales:view");
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

  // The insight layer (Kong, 2026-09-28): one measure for the whole page, and
  // the previous period of equal length for "what moved" (rule SI3). Profit
  // is offered only to someone who may see cost (rule A8).
  const byParam = one("by");
  const by: Metric = byParam === "qty" ? "qty" : byParam === "profit" && costAccess !== null ? "profit" : "net";
  const isoFrom = (query.from ?? new Date(`${month.from}T00:00:00.000Z`)).toISOString().slice(0, 10);
  const isoTo = (query.to ?? new Date(`${month.to}T00:00:00.000Z`)).toISOString().slice(0, 10);
  // What the page compares against (Kong, 2026-10-03): `?vs=2026-07` for a
  // month, `?vsFrom=&vsTo=` for any range, nothing for the period just before.
  const vsMonth = one("vs");
  const vsPicked = vsMonth && /^\d{4}-\d{2}$/.test(vsMonth)
    ? (() => {
        const [y, m] = vsMonth.split("-").map(Number);
        return { from: `${vsMonth}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
      })()
    : { from: one("vsFrom"), to: one("vsTo") };
  const prevRange = comparisonRange(isoFrom, isoTo, vsPicked);
  const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  const [branches, categories, totalsRaw, daysRaw, menuDays] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    getMenuCategoriesLogic(tenantId),
    // Kong (2026-09-28): the page was slow. The full summary (~10 queries on the
    // critical path) is gone; everything by day, menu and category comes from
    // getSalesMenuDaysLogic, and this asks only for the tiles' totals.
    getSalesTotalsLogic(tenantId, { ...query, reach }),
    getSalesDaysLogic(tenantId, {
      reach,
      branchId: query.branchId,
      from: query.from,
      to: query.to,
    }),
    getSalesMenuDaysWithComparisonLogic(
      tenantId,
      { reach, branchId: query.branchId, menuCategoryId: query.menuCategoryId },
      { from: asDate(isoFrom), to: asDate(isoTo) },
      { from: asDate(prevRange.from), to: asDate(prevRange.to) }
    ),
  ]);


  // Part 35 C — a clicked day opens below the chart (Kong's "click a bar to
  // see that day"). Its own summary, the same function, one day wide.
  const dayParam = one("day");
  const dayValid = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;

  // Filters as pills — every one a plain link that keeps the others.
  const fromIso = one("from") ?? month.from;
  const toIso = one("to") ?? month.to;
  const link = (next: Record<string, string | undefined>) => {
    const periodChanges = "from" in next || "to" in next;
    const cur: Record<string, string | undefined> = {
      branch: one("branch"),
      from: fromIso,
      to: toIso,
      category: one("category"),
      by: by === "net" ? undefined : by,
      day: undefined,
      // A comparison belongs to the period it was picked for.
      vs: periodChanges ? undefined : one("vs"),
      vsFrom: periodChanges ? undefined : one("vsFrom"),
      vsTo: periodChanges ? undefined : one("vsTo"),
    };
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
  // What the one-line filter bar says once the full card has scrolled away.
  const monthPicked = months.find((m) => m.from === fromIso && m.to === toIso);
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
  const filterSummary = [
    monthPicked ? monthPicked.label : `${shortDate(fromIso)} – ${shortDate(toIso)}`,
    branches.find((b) => b.id === one("branch"))?.name ?? "ทุกสาขา",
    categories.find((c) => c.id === one("category"))?.name ?? "ทุกหมวด",
    METRIC_LABELS_TH[by],
  ].join(" · ");

  const catKey = (id: string | null) => id ?? "none";

  // ---------- one set of rows behind every view (src/lib/sales-insight.ts) ----------
  // Both cheap measures are built now so the browser switches between them
  // instantly; profit (the recipe cost walk) is built here only when the page
  // is OPENED on profit, otherwise in the background (sales-views.ts).
  const menuMeta = new Map(menuDays.menus.map((m) => [m.id, m]));
  const costs: CostMap =
    by === "profit"
      ? await getMenuCostMapLogic(tenantId, [...new Set(menuDays.rows.map((r) => r.branchId))], asDate(isoTo), costAccess)
      : new Map();
  const allRows = enrich(menuDays.rows, menuMeta, costs);
  const cur = allRows.filter((r) => r.day >= isoFrom && r.day <= isoTo);
  const before = allRows.filter((r) => r.day >= prevRange.from && r.day <= prevRange.to);
  const tones: ToneMap = tonesFor(cur, toneOf);
  const viewInput = { cur, before, menuMeta, costs, tones, day: dayValid };
  const views: Partial<Record<Metric, SalesView>> = {
    net: buildSalesView(viewInput, "net"),
    qty: buildSalesView(viewInput, "qty"),
    ...(by === "profit" ? { profit: buildSalesView(viewInput, "profit") } : {}),
  };
  const s = toSalesTotalsView(totalsRaw, new Set(cur.map((r) => r.day)).size);
  const unidentifiedMenuCount = new Set(cur.map((r) => r.menuId)).size
    ? [...new Set(cur.map((r) => r.menuId))].filter((id) => menuMeta.get(id)?.isPosStub).length
    : 0;
  const prevLabel = periodLabelTh(prevRange.from, prevRange.to);
  // The comparison picker's choices: the period just before (default) and the
  // last twelve months, except the one on screen.
  const previousRangeOf = comparisonRange(isoFrom, isoTo, null);
  const compareMonths = recentMonths(12)
    .map((m) => ({
      key: m.key,
      from: m.from.toISOString().slice(0, 10),
      to: m.to.toISOString().slice(0, 10),
      label: new Date(`${m.key}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" }),
    }))
    // Neither the period itself nor the default (already the first option) twice.
    .filter((m) => !(m.from === isoFrom && m.to === isoTo) && !(m.from === previousRangeOf.from && m.to === previousRangeOf.to))
    .reverse();
  const curLabel = periodLabelTh(isoFrom, isoTo);
  // Per day WITH DATA on both sides (rule SI1) — September's 26 days against August's 19.
  const nowStats = periodStats(cur, menuMeta, "net");
  const prevStats = periodStats(before, menuMeta, "net");
  const avgPrice = (st: typeof nowStats) => (st.perDay.qty > 0 ? st.perDay.net / st.perDay.qty : null);
  const kpis: KpiProps[] = [
    {
      label: "ยอดขาย",
      note: "ไม่รวม VAT และ SC",
      value: `฿${bahtShort(s.totals.net)}`,
      cur: nowStats.perDay.net,
      prev: prevStats.days ? prevStats.perDay.net : null,
      fmt: (n) => `฿${Math.round(n).toLocaleString("th-TH")}/วัน`,
      perDay: true,
    },
    {
      label: "จำนวนจาน",
      note: `${s.totals.days} วันที่มีข้อมูล`,
      value: Number(s.totals.qty).toLocaleString("th-TH"),
      cur: nowStats.perDay.qty,
      prev: prevStats.days ? prevStats.perDay.qty : null,
      fmt: (n) => `${Math.round(n).toLocaleString("th-TH")} จาน/วัน`,
      perDay: true,
    },
    {
      label: "ราคาเฉลี่ยต่อจาน",
      note: "ยอดขาย หาร จำนวนจาน",
      value: avgPrice(nowStats) === null ? "—" : `฿${Math.round(avgPrice(nowStats)!).toLocaleString("th-TH")}`,
      cur: avgPrice(nowStats),
      prev: prevStats.days ? avgPrice(prevStats) : null,
      fmt: (n) => `฿${Math.round(n).toLocaleString("th-TH")}`,
      perDay: false,
    },
  ];
  const zNet = Number(s.totals.net);
  const paidTotal = zNet + Number(s.totals.serviceCharge) + Number(s.totals.vat);
  const zLines = [
    { op: "", label: "ยอดขายก่อนส่วนลด", value: Number(s.totals.gross) },
    { op: "−", label: "ส่วนลด", value: Number(s.totals.discount) },
    { op: "", label: "ยอดขาย", value: zNet, rule: true },
    { op: "+", label: "Service charge", value: Number(s.totals.serviceCharge) },
    { op: "+", label: "VAT", value: Number(s.totals.vat) },
    { op: "", label: "ลูกค้าจ่ายรวม", value: paidTotal, rule: true, double: true },
  ];

  // Every menu sold in the period sits in no category: the category views can
  // only say one thing, so say what would make them useful instead.
  const noMenuCategories = cur.length > 0 && cur.every((r) => r.categoryKey === "none");
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

      {/* ---------- what the data on this page is (Kong, 2026-10-03) ----------
          A caveat about EVERYTHING below, so it sits at the top, not after the
          charts it qualifies. It also carries what the per-day table used to
          show at a glance — the days whose file disagrees with the total keyed
          at closing (ADR 0020: a file that covered only part of the day) —
          because that table is gone and the bars do not show it. */}
      {!empty && (() => {
        const mismatch = dayGroups.filter((g) => g.pulseIsMismatch);
        const keyed = dayGroups.filter((g) => g.pulseAmount !== null || g.pulseKeyedCount > 0).length;
        const notes = [s.availability.billNotice, s.availability.timeNotice].filter(Boolean);
        return (
          <div className="-mt-4 space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {notes.length > 0 && <p>ข้อมูลช่วงนี้: {notes.join(" · ")}</p>}
            {mismatch.length > 0 ? (
              <p className="font-medium text-bad">
                ยอดจากไฟล์ไม่ตรงกับยอดที่คีย์ตอนปิดร้าน {mismatch.length} วัน (อาจ export มาไม่ครบทั้งวัน):{" "}
                {mismatch.map((g, i) => (
                  <span key={g.day}>
                    {i > 0 && " · "}
                    <Link href={dayHref(g.day) as never} scroll={false} className="underline decoration-dotted underline-offset-2 hover:decoration-solid">
                      {g.dayLabel}
                    </Link>
                  </span>
                ))}
              </p>
            ) : (
              <p>
                ยอดปิดร้านที่คีย์ไว้ใช้ตรวจว่าไฟล์ครบทั้งวัน: คีย์แล้ว {keyed} จาก {dayGroups.length} วัน
                {keyed > 0 ? " · ทุกวันที่คีย์ตรงกับไฟล์" : " · กดแท่งในกราฟรายวันเพื่อคีย์"}
              </p>
            )}
          </div>
        );
      })()}

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
          <SalesAnalysis
            views={views}
            initialBy={by}
            canProfit={costAccess !== null}
            range={{ from: isoFrom, to: isoTo }}
            branchId={query.branchId}
            categoryId={query.menuCategoryId}
            tones={tones}
            months={months}
            periodShort={filterSummary.split(" · ")[0]}
            prevLabel={prevLabel}
            asOfLabel={shortDate(isoTo)}
            noMenuCategories={noMenuCategories}
            filterHref={Object.fromEntries(
              views.net!.categories.filter((c) => c.key !== "none").map((c) => [c.key, link({ category: c.key })])
            )}
            compare={{
              defaultLabel: periodLabelTh(previousRangeOf.from, previousRangeOf.to),
              months: compareMonths,
              selected: vsMonth && /^\d{4}-\d{2}$/.test(vsMonth) ? vsMonth : prevRange.custom ? "custom" : "",
              custom: prevRange.custom && !(vsMonth && /^\d{4}-\d{2}$/.test(vsMonth)) ? { from: prevRange.from, to: prevRange.to } : null,
              vsFrom: prevRange.custom ? prevRange.from : "",
              vsTo: prevRange.custom ? prevRange.to : "",
            }}
            between={
              <>
          {/* ---------- totals (Kong, 2026-10-03) ----------
              Two jobs, kept apart. The cards answer "better or worse": one big
              figure, a pill with the per-day change (rule SI1: per day with
              data, never totals), then the two periods on their own labelled
              rows so the lines do not read on into each other. The quiet line
              under them answers "does this match the POS": the Z-report
              order, folded until asked for, so it never outshouts the cards. */}
          <section className="grid gap-3 sm:grid-cols-3">
            {kpis.map((k) => (
              <Kpi key={k.label} {...k} curLabel={curLabel} prevLabel={prevLabel} />
            ))}
          </section>
          <details className="group -mt-5 text-xs text-muted-subtle">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-1 marker:hidden">
              <span>ตรวจกับใบสรุปปิดร้านของ POS</span>
              <span>
                ลูกค้าจ่ายรวม <b className="font-medium tabular-nums text-muted-foreground">฿{baht(String(paidTotal))}</b>
              </span>
              <span className="underline decoration-dotted underline-offset-2 group-open:hidden">ดูทีละบรรทัด ▾</span>
              <span className="hidden underline decoration-dotted underline-offset-2 group-open:inline">ซ่อน ▴</span>
            </summary>
            <table className="ml-1 mt-2 w-full max-w-md border-l-2 border-wash pl-3 text-xs tabular-nums text-muted-foreground">
              <tbody>
                {zLines.map((z) => (
                  <tr key={z.label} className={`${z.rule ? "border-t border-border-strong font-semibold" : ""} ${z.double ? "border-b-4 border-double border-border-strong" : ""} ${z.value === 0 ? "text-muted-subtle" : ""}`}>
                    <td className="w-5 py-1 pl-3 text-center text-muted-subtle">{z.op}</td>
                    <td className="py-1">{z.label}</td>
                    <td className="py-1 text-right">฿{baht(String(z.value))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>


          {unidentifiedMenuCount > 0 && (
            <section className="rounded-lg border border-warn/50 bg-warn/5 p-3 text-sm">
              มีเมนูที่ยังไม่ได้ตรวจ {unidentifiedMenuCount} รายการในช่วงนี้ —{" "}
              <a href="/menus?stubs=true" className="text-primary underline">
                ไปจัดการ
              </a>
            </section>
          )}

              </>
            }
            dayModal={
              dayValid
                ? {
                    day: dayValid,
                    title: new Date(`${dayValid}T00:00:00Z`).toLocaleDateString("th-TH", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    }),
                    net: cur.filter((r) => r.day === dayValid).reduce((t, r) => t + r.net, 0),
                    qty: cur.filter((r) => r.day === dayValid).reduce((t, r) => t + r.qty, 0),
                    branches: modalBranches,
                    canKeyPulse: can("sales:import"),
                    closeHref: link({}),
                    prevHref: olderDay ? dayHref(olderDay) : null,
                    nextHref: newerDay ? dayHref(newerDay) : null,
                  }
                : null
            }
          />

        </>
      )}
    </div>
  );
}

type KpiProps = {
  label: string;
  note: string;
  value: string;
  cur: number | null;
  prev: number | null;
  fmt: (n: number) => string;
  perDay: boolean;
};

function Kpi({ label, note, value, cur, prev, fmt, perDay, curLabel, prevLabel }: KpiProps & { curLabel: string; prevLabel: string }) {
  const change = cur !== null && prev ? (cur - prev) / prev : null;
  const tone = change === null || Math.abs(change) < 0.005 ? "bg-muted text-muted-foreground" : change > 0 ? "bg-good-bg text-good" : "bg-bad-bg text-bad";
  return (
    <div className="grid content-start gap-2 rounded-xl border border-border bg-surface p-4">
      <p className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        <span className="text-[11px] text-muted-subtle">{note}</span>
      </p>
      <p className="font-display text-2xl font-semibold tabular-nums leading-tight">{value}</p>
      {change === null ? (
        <span className="text-xs text-muted-subtle">ไม่มีตัวเลข {prevLabel} ให้เทียบ</span>
      ) : (
        <span className={`w-max rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(1)}%
          <span className="font-normal opacity-80">{perDay ? " ต่อวัน" : ""}</span>
        </span>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 border-t border-border pt-2 text-xs tabular-nums">
        <dt className="text-muted-subtle">{curLabel}</dt>
        <dd className="text-right">{cur === null ? "—" : fmt(cur)}</dd>
        <dt className="text-muted-subtle">{prevLabel}</dt>
        <dd className="text-right">{prev === null ? "—" : fmt(prev)}</dd>
      </dl>
    </div>
  );
}
