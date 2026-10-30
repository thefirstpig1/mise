// ============================================================
// คิดครัว — ระบบตัดตามสูตร เทียบกับที่ใช้ไปจริงตามการนับ (Kong 2026-10-31)
// ============================================================
// Mockup + decisions: https://claude.ai/artifact/1kq32GjKCr34PQan8g6nqg
// ("เอาตามที่แนะนำ"). Known elsewhere as Actual vs Theoretical: Restaurant365
// measures it from one count to the next, and so does this.
//
// Two numbers per product, between the product's previous count and this one:
//   deducted  what the system took off by RECIPE — sales, staff meals and
//             production inputs (rule AC2), reversals netted
//   used      deducted + what the count found short − what it found over,
//             i.e. deducted − (counted − expected)
// and gap % = (used − deducted) ÷ deducted (AC3).
//
// ── THE WINDOW IS THE LEDGER'S, NOT THE CALENDAR'S (AC1) ───────────────────
// A count line's `qty_expected` is the ledger balance at the moment the line was
// last saved (`updated_at`), whatever business date each movement carries. So
// the deduction that belongs with a line is the recipe movements WRITTEN
// between the previous line's snapshot and this one — `created_at`, not
// `occurred_at`. With that pairing `used = deducted − variance` is an identity,
// and the page can never disagree with the count it is built on.
//
// What the identity cannot fix is a count closed before the sales it stands
// on were posted: that count reads the unsold-yet-not-deducted stock as gone,
// and the next count finds it again as a gain. Each view names those days
// (`lateSalesDays`), and the combined view sums per product BEFORE dividing
// (AC6), which is what lets the pair cancel.
//
// ── THE BASELINE (PG4) ─────────────────────────────────────────────────────
// A product's first count is compared with everything recorded since the start
// only when something was recorded coming IN before it. Otherwise the ledger
// had no starting point — a shop that imported last month's sales and then did
// its opening count would read as having used hundreds of percent less than
// its recipes — and that count is simply where the product starts.
//
// Nothing is stored and nothing writes. Money is valued by the same FIFO replay
// /cost and ของหายไปไหน read: a shortfall by the count's own ADJUST_LOSS, a
// surplus by the current unit cost (≈), the deduction by what its outflows
// cost. Only a cost reader is handed baht; the percentages are not prices.
// ============================================================

import { Prisma } from "@prisma/client";
import type { MovementType, PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, bangkokDayStartUtc, computeBangkokToday } from "@/lib/bangkok-date";
import { replayPairsInTx, costKeyOf } from "./stock-cost";
import { explodeMenuSalesLogic, menuSalesForDay } from "./consumption";
import { periodSegments } from "./department-cost";
import { nameCore } from "./leak-overview";

/** AC3's fixed bands — not the shop's leak target, which is a share of SALES. */
export const ACCURACY_NEAR = 2;
export const ACCURACY_FAR = 5;
/** "รวม 3 เดือน" — counts dated within this many days of today. */
export const ACCURACY_COMBINED_DAYS = 92;

/** AC2: every way the system takes stock off BY RECIPE. */
const RECIPE_MOVES: MovementType[] = ["CONSUMPTION", "CONSUMPTION_REVERSAL", "PRODUCTION_OUT", "PRODUCTION_OUT_REVERSAL"];
const RECIPE_FORWARD = new Set<MovementType>(["CONSUMPTION", "PRODUCTION_OUT"]);
/** What gives a never-counted product a starting point (the baseline rule). */
const STOCK_IN: MovementType[] = ["PO_RECEIVE", "TRANSFER_IN", "PRODUCTION_IN"];

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dayTh = (d: Date, year = false) => `${d.getUTCDate()} ${MONTHS_TH[d.getUTCMonth()]}${year ? ` ${String((d.getUTCFullYear() + 543) % 100).padStart(2, "0")}` : ""}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type AccuracyBand = 1 | 2 | 3;
export const bandOf = (gapPct: number): AccuracyBand => (Math.abs(gapPct) <= ACCURACY_NEAR ? 1 : Math.abs(gapPct) <= ACCURACY_FAR ? 2 : 3);

export type AccuracyLine = {
  productId: string;
  name: string;
  unit: string;
  /** Base units the system took off by recipe in the window. */
  deducted: number;
  /** deducted − (counted − expected). */
  used: number;
  /** (used − deducted) ÷ deducted × 100. Positive = the shop used MORE than the recipes say. */
  gapPct: number;
  band: AccuracyBand;
  /** Baht, cost readers only. */
  deductedValue: number | null;
  /** Baht, always positive; cost readers only. */
  gapValue: number | null;
  bySource: { sales: number; staff: number; production: number };
  /** Counted by the piece AND every live recipe using it holds it alone — a bottle of beer. */
  soldAsIs: boolean;
  /** Never counted before: compared with everything recorded since the start. */
  firstCompare: boolean;
  /** The count lines behind this row — one, or several in the combined view. */
  lineIds: string[];
};

export type AccuracySummary = {
  counted: number;
  measured: number;
  near: number;
  mid: number;
  far: number;
  /** Σ|gap value| ÷ Σ deducted value × 100 (AC4); null when nothing measured carries a cost. */
  gapPct: number | null;
  moreCount: number;
  lessCount: number;
  /** Baht, cost readers only. */
  deductedValue: number | null;
  moreValue: number | null;
  lessValue: number | null;
  /** The far-band products' share of the whole gap — "ส่วนต่าง 82% มาจาก 2 รายการ". */
  farShare: { names: string[]; share: number; value: number | null; restValue: number | null } | null;
};

export type AccuracyView = {
  /** The count id, or "combined". */
  key: string;
  scNumber: string | null;
  date: string;
  dateLabel: string;
  label: string;
  lines: AccuracyLine[];
  /** Sales days before the count date that had not been deducted when the count closed. */
  lateSalesDays: string[];
  /** Share of the window's revenue whose menus had a recipe (rule N3); null with no posted day. */
  coverage: number | null;
  summary: AccuracySummary;
};

export type AccuracyOverview = {
  branchId: string;
  withMoney: boolean;
  counts: AccuracyView[];
  combined: AccuracyView | null;
};

type Line = { id: string; productId: string; qtyCounted: Prisma.Decimal; qtyExpected: Prisma.Decimal; updatedAt: Date };
type Count = { id: string; scNumber: string; countDate: Date; closedAt: Date | null; items: Line[] };
type Move = { id: string; productId: string; qty: Prisma.Decimal; type: MovementType; sourceType: string; createdAt: Date };
/** One product in one view, before rounding and before money is withheld. */
type Raw = {
  productId: string;
  deducted: number;
  gap: number; // used − deducted
  deductedValue: number | null;
  gapValueSigned: number | null; // + when used more
  bySource: { sales: number; staff: number; production: number };
  firstCompare: boolean;
  lineIds: string[];
};

export async function getDeductionAccuracyLogic(
  tenantId: string,
  params: { branchId: string; withMoney: boolean }
): Promise<AccuracyOverview> {
  const { branchId, withMoney } = params;
  return withTenantContext(
    tenantId,
    async (raw) => {
      const tx = raw as unknown as PrismaClient;
      const counts: Count[] = await tx.stockCount.findMany({
        where: { tenantId, branchId, status: "CLOSED", deletedAt: null },
        select: {
          id: true,
          scNumber: true,
          countDate: true,
          closedAt: true,
          items: { where: { reversalOfItemId: null }, select: { id: true, productId: true, qtyCounted: true, qtyExpected: true, updatedAt: true } },
        },
        orderBy: [{ countDate: "asc" }, { closedAt: "asc" }],
      });
      const empty: AccuracyOverview = { branchId, withMoney, counts: [], combined: null };
      if (counts.length === 0) return empty;

      const productIds = [...new Set(counts.flatMap((c) => c.items.map((i) => i.productId)))];
      const lastSnap = new Date(Math.max(...counts.flatMap((c) => c.items.map((i) => i.updatedAt.getTime()))));
      const lastCountDate = counts.at(-1)!.countDate;

      const [moves, firstIn, products, recipes, salesDays, runs] = await Promise.all([
        tx.stockMovement.findMany({
          where: { tenantId, branchId, productId: { in: productIds }, type: { in: RECIPE_MOVES }, createdAt: { lte: lastSnap } },
          select: { id: true, productId: true, qty: true, type: true, sourceType: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        }),
        tx.stockMovement.groupBy({
          by: ["productId"],
          where: { tenantId, branchId, productId: { in: productIds }, type: { in: STOCK_IN } },
          _min: { createdAt: true },
        }),
        tx.product.findMany({
          where: { tenantId, id: { in: productIds } },
          select: { id: true, name: true, primaryDimension: true, productUnits: { where: { isBase: true }, select: { unitName: true } } },
        }),
        tx.recipe.findMany({
          where: { tenantId, deletedAt: null, isDraft: false, supersededAt: null, ingredients: { some: { productId: { in: productIds } } } },
          select: { ingredients: { select: { productId: true } } },
        }),
        tx.salesLine.groupBy({
          by: ["businessDate"],
          where: { tenantId, branchId, supersededAt: null, businessDate: { lt: lastCountDate } },
        }),
        // Every run, voided ones included: a day posted before the count and
        // re-posted after it WAS deducted when the count closed.
        tx.salesConsumptionRun.findMany({
          where: { tenantId, branchId },
          select: { businessDate: true, postedAt: true, voidedAt: true, coveredNetAmount: true, totalNetAmount: true },
        }),
      ]);

      const firstInAt = new Map(firstIn.map((r) => [r.productId, r._min.createdAt]));
      const nameOf = new Map(products.map((p) => [p.id, p.name]));
      const unitOf = new Map(products.map((p) => [p.id, p.productUnits[0]?.unitName ?? ""]));
      const byPiece = new Map(products.map((p) => [p.id, p.primaryDimension === "COUNT"]));
      const alone = new Map<string, boolean>();
      for (const r of recipes) {
        for (const id of new Set(r.ingredients.map((i) => i.productId).filter((x): x is string => !!x))) {
          alone.set(id, (alone.get(id) ?? true) && r.ingredients.length === 1);
        }
      }
      const soldAsIs = (id: string) => (byPiece.get(id) ?? false) && (alone.get(id) ?? false);

      const movesOf = new Map<string, Move[]>();
      for (const m of moves) {
        const list = movesOf.get(m.productId) ?? [];
        list.push(m);
        movesOf.set(m.productId, list);
      }

      // ── money (one replay; values are internal until the end) ─────────────
      const replayed = await replayPairsInTx(tx, tenantId, productIds, [branchId]);
      const outflowValue = new Map<string, { qty: number; value: number }>();
      const countLoss = new Map<string, number>();
      for (const state of replayed.values()) {
        for (const o of state.outflows) {
          if (RECIPE_FORWARD.has(o.type)) outflowValue.set(o.movementId, { qty: num(o.qty), value: num(o.value) });
          else if (o.type === "ADJUST_LOSS" && o.sourceType === "STOCK_COUNT") countLoss.set(o.sourceId, (countLoss.get(o.sourceId) ?? 0) + num(o.value));
        }
      }
      const unitCost = (productId: string) => {
        const s = replayed.get(costKeyOf(productId, branchId));
        const c = s ? num(s.lastKnownUnitCost ?? s.costPerBaseUnit) : 0;
        return c > 0 ? c : null;
      };

      // ── each count line against the same product's previous one ──────────
      const linesOf = new Map<string, { line: Line; countIdx: number }[]>();
      counts.forEach((c, countIdx) => {
        for (const line of c.items) {
          const list = linesOf.get(line.productId) ?? [];
          list.push({ line, countIdx });
          linesOf.set(line.productId, list);
        }
      });
      const perCount: Raw[][] = counts.map(() => []);
      for (const [productId, list] of linesOf) {
        list.sort((a, b) => a.line.updatedAt.getTime() - b.line.updatedAt.getTime());
        const pm = movesOf.get(productId) ?? [];
        list.forEach(({ line, countIdx }, i) => {
          const prev = i > 0 ? list[i - 1].line : null;
          const lo = prev ? prev.updatedAt.getTime() : -Infinity;
          const hi = line.updatedAt.getTime();
          // The baseline rule: nothing recorded coming in before a first count.
          if (!prev) {
            const firstInbound = firstInAt.get(productId);
            if (!firstInbound || firstInbound.getTime() >= hi) return;
          }
          let deducted = 0;
          let fwdQty = 0;
          let fwdValue = 0;
          const bySource = { sales: 0, staff: 0, production: 0 };
          for (const m of pm) {
            const t = m.createdAt.getTime();
            if (t <= lo || t > hi) continue;
            const q = -num(m.qty);
            deducted += q;
            if (m.sourceType === "STAFF_MEAL") bySource.staff += q;
            else if (m.sourceType === "PRODUCTION") bySource.production += q;
            else bySource.sales += q;
            const v = outflowValue.get(m.id);
            if (v) {
              fwdQty += v.qty;
              fwdValue += v.value;
            }
          }
          if (deducted <= 0) return; // AC5 — nothing taken by recipe, nothing to compare
          const variance = num(line.qtyCounted) - num(line.qtyExpected);
          const gap = -variance;
          const deductedValue = fwdQty > 0 && fwdValue > 0 ? (deducted * fwdValue) / fwdQty : null;
          let gapValueSigned: number | null;
          if (variance < 0) {
            const loss = countLoss.get(line.id);
            gapValueSigned = loss !== undefined ? loss : deductedValue !== null ? (gap * deductedValue) / deducted : null;
          } else {
            const c = unitCost(productId);
            gapValueSigned = c !== null ? -variance * c : null;
          }
          perCount[countIdx].push({ productId, deducted, gap, deductedValue, gapValueSigned, bySource, firstCompare: !prev, lineIds: [line.id] });
        });
      }

      // ── days the count stood on that were not deducted when it closed ─────
      const firstPosted = new Map<string, number>();
      for (const r of runs) {
        const k = iso(r.businessDate);
        const t = r.postedAt.getTime();
        if (!firstPosted.has(k) || t < firstPosted.get(k)!) firstPosted.set(k, t);
      }
      const saleDays = salesDays.map((s) => s.businessDate).sort((a, b) => a.getTime() - b.getTime());
      const lateFor = (ci: number) => {
        // A branch that has never deducted by recipe has nothing to be late with.
        if (runs.length === 0) return [];
        const c = counts[ci];
        const lo = ci > 0 ? counts[ci - 1].countDate.getTime() : -Infinity;
        const closed = (c.closedAt ?? new Date()).getTime();
        return saleDays
          .filter((d) => d.getTime() > lo && d.getTime() < c.countDate.getTime())
          .map(iso)
          .filter((k) => !(firstPosted.has(k) && firstPosted.get(k)! <= closed));
      };

      /** Rule N3 over the standing runs of business days in (lo, hi]. */
      const coverageFor = (lo: number, hi: number) => {
        let covered = 0;
        let total = 0;
        for (const r of runs) {
          const t = r.businessDate.getTime();
          if (r.voidedAt !== null || t <= lo || t > hi) continue;
          covered += num(r.coveredNetAmount);
          total += num(r.totalNetAmount);
        }
        return total > 0 ? Math.round((covered / total) * 100) : null;
      };

      const view = (key: string, rows: Raw[], meta: Omit<AccuracyView, "key" | "lines" | "summary">, counted: number): AccuracyView => {
        const lines: AccuracyLine[] = rows.map((r) => {
          const gapPct = (r.gap / r.deducted) * 100;
          return {
            productId: r.productId,
            name: nameOf.get(r.productId) ?? r.productId,
            unit: unitOf.get(r.productId) ?? "",
            deducted: r3(r.deducted),
            used: r3(r.deducted + r.gap),
            gapPct: Math.round(gapPct * 10) / 10,
            band: bandOf(gapPct),
            deductedValue: withMoney && r.deductedValue !== null ? r2(r.deductedValue) : null,
            gapValue: withMoney && r.gapValueSigned !== null ? r2(Math.abs(r.gapValueSigned)) : null,
            bySource: { sales: r3(r.bySource.sales), staff: r3(r.bySource.staff), production: r3(r.bySource.production) },
            soldAsIs: soldAsIs(r.productId),
            firstCompare: r.firstCompare,
            lineIds: r.lineIds,
          };
        });
        const valued = rows.filter((r) => r.deductedValue !== null && r.gapValueSigned !== null);
        const absOf = (r: Raw) => Math.abs(r.gapValueSigned ?? 0);
        const totalGap = valued.reduce((s, r) => s + absOf(r), 0);
        const totalDeducted = valued.reduce((s, r) => s + (r.deductedValue ?? 0), 0);
        const more = rows.filter((r) => r.gap > 0);
        const less = rows.filter((r) => r.gap < 0);
        const far = valued.filter((r) => bandOf((r.gap / r.deducted) * 100) === 3).sort((a, b) => absOf(b) - absOf(a));
        const farValue = far.reduce((s, r) => s + absOf(r), 0);
        const order = (a: Raw, b: Raw) =>
          withMoney ? absOf(b) - absOf(a) || Math.abs(b.gap / b.deducted) - Math.abs(a.gap / a.deducted) : Math.abs(b.gap / b.deducted) - Math.abs(a.gap / a.deducted);
        const sortedLines = [...rows].sort(order).map((r) => lines[rows.indexOf(r)]);
        return {
          key,
          ...meta,
          lines: sortedLines,
          summary: {
            counted,
            measured: lines.length,
            near: lines.filter((l) => l.band === 1).length,
            mid: lines.filter((l) => l.band === 2).length,
            far: lines.filter((l) => l.band === 3).length,
            gapPct: totalDeducted > 0 ? Math.round((totalGap / totalDeducted) * 1000) / 10 : null,
            moreCount: more.length,
            lessCount: less.length,
            deductedValue: withMoney && totalDeducted > 0 ? r2(totalDeducted) : null,
            moreValue: withMoney ? r2(more.reduce((s, r) => s + Math.abs(r.gapValueSigned ?? 0), 0)) : null,
            lessValue: withMoney ? r2(less.reduce((s, r) => s + Math.abs(r.gapValueSigned ?? 0), 0)) : null,
            farShare:
              far.length > 0 && totalGap > 0
                ? {
                    names: far.map((r) => nameOf.get(r.productId) ?? ""),
                    share: Math.round((farValue / totalGap) * 100),
                    value: withMoney ? r2(farValue) : null,
                    restValue: withMoney ? r2(totalGap - farValue) : null,
                  }
                : null,
          },
        };
      };

      const views = counts.map((c, ci) =>
        view(
          c.id,
          perCount[ci],
          {
            scNumber: c.scNumber,
            date: iso(c.countDate),
            dateLabel: dayTh(c.countDate),
            label: `ใบนับ ${dayTh(c.countDate, true)}`,
            lateSalesDays: lateFor(ci),
            coverage: coverageFor(ci > 0 ? counts[ci - 1].countDate.getTime() : -Infinity, c.countDate.getTime()),
          },
          new Set(c.items.map((i) => i.productId)).size
        )
      );

      // ── combined (AC6): sum per product across the recent counts, then divide
      const since = addDays(computeBangkokToday(), -ACCURACY_COMBINED_DAYS).getTime();
      const recent = counts.map((c, ci) => ({ c, ci })).filter(({ c, ci }) => c.countDate.getTime() >= since && perCount[ci].length > 0);
      let combined: AccuracyView | null = null;
      if (recent.length >= 2) {
        const sum = new Map<string, Raw>();
        for (const { ci } of recent) {
          for (const r of perCount[ci]) {
            const cur = sum.get(r.productId);
            if (!cur) {
              sum.set(r.productId, { ...r, bySource: { ...r.bySource }, lineIds: [...r.lineIds] });
              continue;
            }
            cur.deducted += r.deducted;
            cur.gap += r.gap;
            cur.deductedValue = cur.deductedValue !== null && r.deductedValue !== null ? cur.deductedValue + r.deductedValue : null;
            cur.gapValueSigned = cur.gapValueSigned !== null && r.gapValueSigned !== null ? cur.gapValueSigned + r.gapValueSigned : null;
            cur.bySource.sales += r.bySource.sales;
            cur.bySource.staff += r.bySource.staff;
            cur.bySource.production += r.bySource.production;
            cur.firstCompare = cur.firstCompare || r.firstCompare;
            cur.lineIds.push(...r.lineIds);
          }
        }
        const first = recent[0].c.countDate;
        const last = recent.at(-1)!.c.countDate;
        combined = view(
          "combined",
          [...sum.values()],
          {
            scNumber: null,
            date: iso(last),
            dateLabel: dayTh(last),
            label: `รวม ${recent.length} ใบนับ · ${dayTh(first)} – ${dayTh(last, true)}`,
            lateSalesDays: [...new Set(recent.flatMap(({ ci }) => views[ci].lateSalesDays))].sort(),
            coverage: coverageFor(recent[0].ci > 0 ? counts[recent[0].ci - 1].countDate.getTime() : -Infinity, last.getTime()),
          },
          new Set(recent.flatMap(({ c }) => c.items.map((i) => i.productId))).size
        );
      }

      return { branchId, withMoney, counts: views, combined };
    },
    { timeout: 30_000 }
  );
}

// ============================================================
// One product, opened from the table
// ============================================================

export type AccuracyDetail = {
  unit: string;
  /** Which menus the sales part came from, recipes as of each day. */
  menus: { name: string; plates: number; perPlate: number; qty: number }[];
  sales: number;
  staff: number;
  production: number;
  /** Sales deduction the menu walk does not reproduce (prepped stock, a re-post). */
  residual: number;
  wastes: { count: number; qty: number };
  /** Received on the count day, when one count is open. */
  sameDay: { qty: number; grNumber: string } | null;
  /** Sold in the window with no recipe, whose name holds this product's. */
  noRecipeMenus: { name: string; plates: number }[];
};

export async function getDeductionAccuracyDetailLogic(
  tenantId: string,
  params: { branchId: string; productId: string; lineIds: string[] }
): Promise<AccuracyDetail | null> {
  const { branchId, productId } = params;
  return withTenantContext(
    tenantId,
    async (raw) => {
      const tx = raw as unknown as PrismaClient;
      // Never trust the ids: each must be this product's line on a closed count
      // of this branch.
      const lines = await tx.stockCountItem.findMany({
        where: { tenantId, id: { in: params.lineIds }, productId, reversalOfItemId: null, stockCount: { branchId, status: "CLOSED", deletedAt: null } },
        select: { id: true, updatedAt: true, stockCount: { select: { countDate: true } } },
      });
      if (lines.length === 0) return null;
      const priors = await tx.stockCountItem.findMany({
        where: { tenantId, productId, reversalOfItemId: null, stockCount: { branchId, status: "CLOSED", deletedAt: null } },
        select: { updatedAt: true },
      });
      const windows = lines.map((l) => {
        const before = priors.map((p) => p.updatedAt.getTime()).filter((t) => t < l.updatedAt.getTime());
        return { lo: before.length ? Math.max(...before) : -Infinity, hi: l.updatedAt.getTime(), countDate: l.stockCount.countDate };
      });
      const inWindow = (d: Date) => windows.some((w) => d.getTime() > w.lo && d.getTime() <= w.hi);
      const hiMax = new Date(Math.max(...windows.map((w) => w.hi)));

      const [product, moves, wasteMoves, wasteLogs, runs, tenant] = await Promise.all([
        tx.product.findFirst({
          where: { tenantId, id: productId },
          select: { name: true, productUnits: { where: { isBase: true }, select: { unitName: true } } },
        }),
        tx.stockMovement.findMany({
          where: { tenantId, branchId, productId, type: { in: RECIPE_MOVES }, createdAt: { lte: hiMax } },
          select: { qty: true, sourceType: true, createdAt: true },
        }),
        tx.stockMovement.findMany({
          where: { tenantId, branchId, productId, sourceType: "WASTE_LOG", createdAt: { lte: hiMax } },
          select: { qty: true, createdAt: true },
        }),
        tx.wasteLog.findMany({
          where: { tenantId, branchId, productId, voidedAt: null, reversalOfId: null, createdAt: { lte: hiMax } },
          select: { createdAt: true },
        }),
        tx.salesConsumptionRun.findMany({
          where: { tenantId, branchId, voidedAt: null, postedAt: { lte: hiMax } },
          select: { businessDate: true, postedAt: true },
        }),
        tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { cancelledSalePolicy: true } }),
      ]);
      if (!product) return null;

      let sales = 0;
      let staff = 0;
      let production = 0;
      for (const m of moves) {
        if (!inWindow(m.createdAt)) continue;
        const q = -num(m.qty);
        if (m.sourceType === "STAFF_MEAL") staff += q;
        else if (m.sourceType === "PRODUCTION") production += q;
        else sales += q;
      }
      const wasteQty = -wasteMoves.filter((m) => inWindow(m.createdAt)).reduce((s, m) => s + num(m.qty), 0);

      // The days whose deduction landed in the window — the ones the menu walk reads.
      const dates = [...new Map(runs.filter((r) => inWindow(r.postedAt)).map((r) => [r.businessDate.getTime(), r.businessDate])).values()].sort(
        (a, b) => a.getTime() - b.getTime()
      );

      const menuQty = new Map<string, { qty: number; plates: number }>();
      const noRecipe = new Map<string, number>();
      if (dates.length > 0) {
        const segments = await periodSegments(tx, tenantId, dates[0], dates.at(-1)!);
        for (const seg of segments) {
          const segDates = dates.filter((d) => d.getTime() >= seg.start.getTime() && d.getTime() <= seg.end.getTime());
          if (segDates.length === 0) continue;
          const sold = (await menuSalesForDay(tx, tenantId, branchId, { in: segDates }, tenant.cancelledSalePolicy)).filter((s) => !s.qty.isZero());
          if (sold.length === 0) continue;
          const named = await tx.menu.findMany({ where: { tenantId, id: { in: sold.map((s) => s.menuId) } }, select: { id: true, name: true } });
          const names = new Map(named.map((m) => [m.id, m.name]));
          const exploded = await explodeMenuSalesLogic(tx, tenantId, { sales: sold, branchId, resolutionDate: seg.start, names });
          const plates = new Map(sold.map((s) => [s.menuId, num(s.qty)]));
          for (const m of [...exploded.byMenu, ...exploded.preppedByMenu]) {
            const q = m.lines.filter((l) => l.productId === productId).reduce((s, l) => s + Math.abs(num(l.qty)), 0);
            if (q <= 0) continue;
            const name = names.get(m.menuId) ?? m.menuId;
            const cur = menuQty.get(name) ?? { qty: 0, plates: 0 };
            cur.qty += q;
            cur.plates += plates.get(m.menuId) ?? 0;
            menuQty.set(name, cur);
          }
          const core = nameCore(product.name);
          if (core.length >= 2) {
            for (const s of exploded.skipped) {
              if (s.reason !== "NO_RECIPE") continue;
              const name = names.get(s.menuId) ?? "";
              if (name.includes(core)) noRecipe.set(name, (noRecipe.get(name) ?? 0) + (plates.get(s.menuId) ?? 0));
            }
          }
        }
      }
      const menus = [...menuQty.entries()]
        .map(([name, v]) => ({ name, plates: r3(v.plates), perPlate: v.plates > 0 ? r3(v.qty / v.plates) : 0, qty: r3(v.qty) }))
        .sort((a, b) => b.qty - a.qty);
      const walked = menus.reduce((s, m) => s + m.qty, 0);

      let sameDay: AccuracyDetail["sameDay"] = null;
      if (windows.length === 1) {
        const start = bangkokDayStartUtc(windows[0].countDate);
        const got = await tx.goodsReceiptItem.findMany({
          where: {
            tenantId,
            productId,
            reversalOfItemId: null,
            goodsReceipt: { tenantId, branchId, status: "CONFIRMED", deletedAt: null, receivedAt: { gte: start, lt: addDays(start, 1) } },
          },
          select: { qtyReceivedActual: true, toBaseRatio: true, goodsReceipt: { select: { grNumber: true } } },
        });
        if (got.length > 0)
          sameDay = { qty: r3(got.reduce((s, g) => s + num(g.qtyReceivedActual) * num(g.toBaseRatio), 0)), grNumber: got[0].goodsReceipt.grNumber };
      }

      return {
        unit: product.productUnits[0]?.unitName ?? "",
        menus,
        sales: r3(sales),
        staff: r3(staff),
        production: r3(production),
        residual: r3(sales - walked),
        wastes: { count: wasteLogs.filter((w) => inWindow(w.createdAt)).length, qty: r3(wasteQty) },
        sameDay,
        noRecipeMenus: [...noRecipe.entries()].map(([name, plates]) => ({ name, plates: r3(plates) })).sort((a, b) => b.plates - a.plates),
      };
    },
    { timeout: 30_000 }
  );
}

// ============================================================
// Before a count closes — have the sales it stands on been deducted?
// ============================================================

export type CountSalesReadiness = {
  /** The shop deducts by recipe at all; a shop that never does has nothing to warn about. */
  usesDeduction: boolean;
  countDate: string;
  /** The latest business day with sales imported, on or before the count date. */
  lastSalesDate: string | null;
  /** Days before the count date imported but not deducted. */
  unposted: string[];
};

export async function getCountSalesReadinessLogic(tenantId: string, countId: string): Promise<CountSalesReadiness | null> {
  return withTenantContext(tenantId, async (raw) => {
    const tx = raw as unknown as PrismaClient;
    const count = await tx.stockCount.findFirst({ where: { tenantId, id: countId, deletedAt: null }, select: { branchId: true, countDate: true } });
    if (!count) return null;
    const [anyRun, last, days, runs] = await Promise.all([
      // The SHOP deducts by recipe — a branch that has not yet posted a day is
      // exactly the one whose unposted days a count would read as missing.
      tx.salesConsumptionRun.findFirst({ where: { tenantId }, select: { id: true } }),
      tx.salesLine.findFirst({
        where: { tenantId, branchId: count.branchId, supersededAt: null, businessDate: { lte: count.countDate } },
        orderBy: { businessDate: "desc" },
        select: { businessDate: true },
      }),
      tx.salesLine.groupBy({
        by: ["businessDate"],
        where: { tenantId, branchId: count.branchId, supersededAt: null, businessDate: { gte: addDays(count.countDate, -31), lt: count.countDate } },
      }),
      tx.salesConsumptionRun.findMany({
        where: { tenantId, branchId: count.branchId, voidedAt: null, businessDate: { gte: addDays(count.countDate, -31), lt: count.countDate } },
        select: { businessDate: true },
      }),
    ]);
    const posted = new Set(runs.map((r) => iso(r.businessDate)));
    return {
      usesDeduction: anyRun !== null,
      countDate: iso(count.countDate),
      lastSalesDate: last ? iso(last.businessDate) : null,
      unposted: days.map((d) => iso(d.businessDate)).filter((d) => !posted.has(d)).sort(),
    };
  });
}

// ============================================================
// The platform's one number per shop (Kong 2026-10-31, question 2)
// ============================================================

export type ShopAccuracy = { branchName: string; date: string; gapPct: number | null; near: number; measured: number };

export async function getShopAccuracySnapshotLogic(tenantId: string): Promise<ShopAccuracy | null> {
  // The branches with a closed count — the whole shop, not a reader's reach:
  // this is the platform's figure, and nobody is reading a branch list.
  const counted = await withTenantContext(tenantId, (tx) =>
    tx.stockCount.findMany({
      where: { tenantId, status: "CLOSED", deletedAt: null, branch: { deletedAt: null } },
      select: { branchId: true, branch: { select: { name: true } } },
      distinct: ["branchId"],
    })
  );
  let best: ShopAccuracy | null = null;
  for (const c of counted) {
    const b = { id: c.branchId, name: c.branch.name };
    const o = await getDeductionAccuracyLogic(tenantId, { branchId: b.id, withMoney: false });
    const latest = [...o.counts].reverse().find((v) => v.summary.measured > 0);
    if (latest && (!best || latest.date > best.date))
      best = { branchName: b.name, date: latest.date, gapPct: latest.summary.gapPct, near: latest.summary.near, measured: latest.summary.measured };
  }
  return best;
}
