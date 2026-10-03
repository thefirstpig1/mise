// ============================================================
// Mise — sales reads (Sprint 4 Part 19 L3/L4, ADR 0019)
// ============================================================
// Everything the sales screens ask for, and one thing they must be told: which
// angles this shop's files cannot answer.
//
// Rule P11 is the reason `availability` exists. A daily-summary export carries
// no bill id and no time, so "average spend per bill" and "which hour is busy"
// have no data behind them — and a screen that renders 0 for those is lying. It
// has to say the file does not contain them.
//
// Weekday is computed from `business_date`, which is a plain DATE, so no
// timezone enters the arithmetic (rule P15). That is the whole reason the sales
// day is stored the way it is: a shop asking "which day of the week sells best"
// must not get a different answer depending on where the server is.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import {
  foldMenuId,
  foldRowsByMenu,
  loadMergeFold,
} from "@/server/menu-merge-fold";
import type { BranchReach } from "@/lib/permissions/service";

export interface GetSalesQuery {
  /**
   * WHOSE sales (rule A5). Required, with no default, so a new caller cannot
   * forget it: before 2026-09-28 "ทุกสาขา" on /sales summed every branch in
   * the shop, including ones the reader may not see.
   */
  reach: BranchReach;
  branchId?: string;
  from?: Date;
  to?: Date;
  menuCategoryId?: string;
  includeSuperseded: boolean;
}

export interface SalesTotals {
  net: Prisma.Decimal;
  gross: Prisma.Decimal;
  discount: Prisma.Decimal;
  serviceCharge: Prisma.Decimal;
  vat: Prisma.Decimal;
  qty: Prisma.Decimal;
  rows: number;
  days: number;
}

export interface SalesByDay {
  businessDate: Date;
  net: Prisma.Decimal;
  qty: Prisma.Decimal;
}

export interface SalesByWeekday {
  /** 0 = Sunday, matching `Date.getUTCDay()`. */
  weekday: number;
  net: Prisma.Decimal;
  qty: Prisma.Decimal;
  /** How many actual days went into the average — three Mondays is not one. */
  dayCount: number;
}

export interface SalesByCategory {
  menuCategoryId: string | null;
  name: string;
  net: Prisma.Decimal;
  qty: Prisma.Decimal;
}

export interface SalesByMenu {
  menuId: string;
  name: string;
  menuCategoryId: string | null;
  menuCategoryName: string | null;
  isPosStub: boolean;
  net: Prisma.Decimal;
  qty: Prisma.Decimal;
}

/**
 * What the imported files can and cannot answer (rule P11).
 *
 * Never guessed from the profile: it is read from the rows actually present, so
 * a shop that switched export kinds half-way through a month gets the truth for
 * the period it is looking at.
 */
export interface SalesAvailability {
  /** Bill-level views — count of bills, average spend per bill. */
  hasBillIds: boolean;
  /** Time-of-day views — the peak-hour question staffing depends on. */
  hasTimes: boolean;
  /** Whether any row carries a channel, i.e. whether a per-platform split works. */
  hasChannels: boolean;
}

export interface SalesSummary {
  totals: SalesTotals;
  byDay: SalesByDay[];
  byWeekday: SalesByWeekday[];
  byCategory: SalesByCategory[];
  topMenus: SalesByMenu[];
  availability: SalesAvailability;
  /** Menus still sitting in the "รอตรวจ" queue that earned money in this period. */
  unidentifiedMenuCount: number;
}

const ZERO = () => new Prisma.Decimal(0);
export const TOP_MENU_LIMIT = 25;

const UNCATEGORISED_LABEL = "ยังไม่ระบุหมวด";

/**
 * The branches a query may touch: the one asked for, or every branch — each
 * narrowed to the reader's reach. A branch outside the reach matches NOTHING
 * rather than being trusted, even if a caller forgot to assert it.
 */
export function branchWhere(reach: BranchReach, branchId?: string): Prisma.SalesLineWhereInput {
  if (reach.allBranches) return branchId ? { branchId } : {};
  const allowed = [...reach.allowedBranchIds];
  if (branchId) return { branchId: allowed.includes(branchId) ? branchId : { in: [] } };
  return { branchId: { in: allowed } };
}

function whereFor(tenantId: string, q: GetSalesQuery): Prisma.SalesLineWhereInput {
  return {
    tenantId,
    ...(q.includeSuperseded ? {} : { supersededAt: null }),
    ...branchWhere(q.reach, q.branchId),
    ...(q.from || q.to
      ? {
          businessDate: {
            ...(q.from ? { gte: q.from } : {}),
            ...(q.to ? { lte: q.to } : {}),
          },
        }
      : {}),
    ...(q.menuCategoryId ? { menu: { menuCategoryId: q.menuCategoryId } } : {}),
  };
}

export async function getSalesSummaryLogic(
  tenantId: string,
  query: GetSalesQuery,
  /** A one-day popup lists every menu of that day, not just the top ones. */
  opts: { menuLimit?: number } = {}
): Promise<SalesSummary> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const where = whereFor(tenantId, query);

      const [agg, byDayRows, byMenuRows, withBill, withTime, withChannel] = await Promise.all([
        tx.salesLine.aggregate({
          where,
          _sum: {
            netAmount: true,
            grossAmount: true,
            discountAmount: true,
            serviceChargeAmount: true,
            vatAmount: true,
            qty: true,
          },
          _count: { _all: true },
        }),
        tx.salesLine.groupBy({
          by: ["businessDate"],
          where,
          _sum: { netAmount: true, qty: true },
          orderBy: { businessDate: "asc" },
        }),
        tx.salesLine.groupBy({
          by: ["menuId"],
          where,
          _sum: { netAmount: true, qty: true },
        }),
        tx.salesLine.count({ where: { ...where, posBillId: { not: null } } }),
        tx.salesLine.count({ where: { ...where, soldAt: { not: null } } }),
        tx.salesLine.count({ where: { ...where, channel: { not: null } } }),
      ]);

      const byDay: SalesByDay[] = byDayRows.map((r) => ({
        businessDate: r.businessDate,
        net: r._sum.netAmount ?? ZERO(),
        qty: r._sum.qty ?? ZERO(),
      }));

      // --- weekday, from the stored DATE and nothing else (rule P15) ---
      const weekdayMap = new Map<number, SalesByWeekday>();
      for (const d of byDay) {
        const w = d.businessDate.getUTCDay();
        const acc = weekdayMap.get(w) ?? { weekday: w, net: ZERO(), qty: ZERO(), dayCount: 0 };
        acc.net = acc.net.plus(d.net);
        acc.qty = acc.qty.plus(d.qty);
        acc.dayCount += 1;
        weekdayMap.set(w, acc);
      }
      const byWeekday = [...weekdayMap.values()].sort((a, b) => a.weekday - b.weekday);

      // Q5: reporting folds retroactively and always, so a dish the POS spells
      // two ways is ONE row here — and its category comes from the canonical
      // menu, which is the only one anybody maintains after a merge.
      const fold = await loadMergeFold(tx, tenantId);
      const byMenu = foldRowsByMenu(
        fold,
        byMenuRows.map((r) => ({
          menuId: foldMenuId(fold, r.menuId),
          net: r._sum.netAmount ?? ZERO(),
          qty: r._sum.qty ?? ZERO(),
        })),
        (r) => r.menuId,
        (into, next) => ({
          menuId: into.menuId,
          net: into.net.plus(next.net),
          qty: into.qty.plus(next.qty),
        })
      );

      // --- category and menu need names, which is one more trip ---
      const menuIds = byMenu.map((r) => r.menuId);
      const menus =
        menuIds.length === 0
          ? []
          : await tx.menu.findMany({
              where: { id: { in: menuIds } },
              select: {
                id: true,
                name: true,
                isPosStub: true,
                menuCategoryId: true,
                menuCategory: { select: { name: true } },
              },
            });
      const menuById = new Map(menus.map((m) => [m.id, m]));

      const categoryAcc = new Map<string, SalesByCategory>();
      const topMenus: SalesByMenu[] = [];
      let unidentifiedMenuCount = 0;

      for (const row of byMenu) {
        const menu = menuById.get(row.menuId);
        const { net, qty } = row;

        topMenus.push({
          menuId: row.menuId,
          name: menu?.name ?? "(ไม่พบเมนู)",
          menuCategoryId: menu?.menuCategoryId ?? null,
          menuCategoryName: menu?.menuCategory?.name ?? null,
          isPosStub: menu?.isPosStub ?? false,
          net,
          qty,
        });
        if (menu?.isPosStub) unidentifiedMenuCount++;

        const catId = menu?.menuCategoryId ?? null;
        const catKey = catId ?? "";
        const acc =
          categoryAcc.get(catKey) ??
          ({
            menuCategoryId: catId,
            name: menu?.menuCategory?.name ?? UNCATEGORISED_LABEL,
            net: ZERO(),
            qty: ZERO(),
          } satisfies SalesByCategory);
        acc.net = acc.net.plus(net);
        acc.qty = acc.qty.plus(qty);
        categoryAcc.set(catKey, acc);
      }

      topMenus.sort((a, b) => b.net.comparedTo(a.net));
      const byCategory = [...categoryAcc.values()].sort((a, b) => b.net.comparedTo(a.net));

      return {
        totals: {
          net: agg._sum.netAmount ?? ZERO(),
          gross: agg._sum.grossAmount ?? ZERO(),
          discount: agg._sum.discountAmount ?? ZERO(),
          serviceCharge: agg._sum.serviceChargeAmount ?? ZERO(),
          vat: agg._sum.vatAmount ?? ZERO(),
          qty: agg._sum.qty ?? ZERO(),
          rows: agg._count._all,
          days: byDay.length,
        },
        byDay,
        byWeekday,
        byCategory,
        topMenus: topMenus.slice(0, opts.menuLimit ?? TOP_MENU_LIMIT),
        availability: {
          hasBillIds: withBill > 0,
          hasTimes: withTime > 0,
          hasChannels: withChannel > 0,
        },
        unidentifiedMenuCount,
      };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}

export interface SalesDayRow {
  businessDate: Date;
  /** A day is per BRANCH — two branches selling on one date are two rows. */
  branchId: string;
  branchName: string;
  net: Prisma.Decimal;
  rows: number;
  fileName: string | null;
  importedAt: Date | null;
  /** What the till said at close (Part 20). Null when nobody recorded it. */
  pulseAmount: Prisma.Decimal | null;
  pulseNote: string | null;
  /**
   * What the customer paid according to the imported detail: `net + vat +
   * service charge`. The pulse's comparable — comparing against `net` alone
   * would be wrong by up to ~17% (rule P27).
   */
  customerPaid: Prisma.Decimal;
}

/**
 * The days themselves, and which file currently owns each one.
 *
 * This is the answer to "where did this figure come from?", which rule P3 makes
 * a live question: any day can be replaced by a later import, and a shop looking
 * at a number is entitled to know which file put it there.
 */
export async function getSalesDaysLogic(
  tenantId: string,
  query: { reach: BranchReach; branchId?: string; from?: Date; to?: Date }
): Promise<SalesDayRow[]> {
  return withTenantContext(tenantId, async (tx) => {
    const days = await tx.salesDay.findMany({
      where: {
        tenantId,
        ...(branchWhere(query.reach, query.branchId) as Prisma.SalesDayWhereInput),
        ...(query.from || query.to
          ? {
              businessDate: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      include: {
        currentBatch: { select: { fileName: true, uploadedAt: true } },
        branch: { select: { name: true } },
      },
      orderBy: { businessDate: "desc" },
      take: 200,
    });
    if (days.length === 0) return [];

    const sums = await tx.salesLine.groupBy({
      by: ["salesDayId"],
      where: { salesDayId: { in: days.map((d) => d.id) }, supersededAt: null },
      _sum: { netAmount: true, vatAmount: true, serviceChargeAmount: true },
      _count: { _all: true },
    });
    const byDayId = new Map(sums.map((s) => [s.salesDayId, s]));

    return days.map((d) => {
      const s = byDayId.get(d.id);
      return {
        businessDate: d.businessDate,
        branchId: d.branchId,
        branchName: d.branch.name,
        net: s?._sum.netAmount ?? ZERO(),
        rows: s?._count._all ?? 0,
        fileName: d.currentBatch?.fileName ?? null,
        importedAt: d.currentBatch?.uploadedAt ?? null,
        pulseAmount: d.pulseAmount,
        pulseNote: d.pulseNote,
        customerPaid: (s?._sum.netAmount ?? ZERO())
          .plus(s?._sum.vatAmount ?? ZERO())
          .plus(s?._sum.serviceChargeAmount ?? ZERO()),
      };
    });
  });
}

// ------------------------------------------------------------
// Menu × branch × day — the one read behind the sales insights
// (Kong, 2026-09-28; src/lib/sales-insight.ts does the arithmetic)
// ------------------------------------------------------------

export interface SalesMenuDaysResult {
  rows: { day: string; branchId: string; menuId: string; net: number; qty: number }[];
  menus: { id: string; name: string; code: string | null; categoryKey: string; categoryName: string; isPosStub: boolean }[];
}

/**
 * The menu × day rows for a period AND the period it is compared with.
 * Adjacent periods (the default: the month before) are one query; a month
 * picked further back is a second query run beside the first, so the rows in
 * between are never fetched.
 */
export async function getSalesMenuDaysWithComparisonLogic(
  tenantId: string,
  query: { reach: BranchReach; branchId?: string; menuCategoryId?: string },
  cur: { from: Date; to: Date },
  cmp: { from: Date; to: Date }
): Promise<SalesMenuDaysResult> {
  const day = 864e5;
  const lo = Math.min(cur.from.getTime(), cmp.from.getTime());
  const hi = Math.max(cur.to.getTime(), cmp.to.getTime());
  const covered = cur.to.getTime() - cur.from.getTime() + cmp.to.getTime() - cmp.from.getTime() + 2 * day;
  if (hi - lo + day <= covered) {
    return getSalesMenuDaysLogic(tenantId, { ...query, from: new Date(lo), to: new Date(hi) });
  }
  const [a, b] = await Promise.all([
    getSalesMenuDaysLogic(tenantId, { ...query, ...cur }),
    getSalesMenuDaysLogic(tenantId, { ...query, ...cmp }),
  ]);
  const menus = new Map(a.menus.map((m) => [m.id, m]));
  for (const m of b.menus) if (!menus.has(m.id)) menus.set(m.id, m);
  return { ...a, rows: [...a.rows, ...b.rows], menus: [...menus.values()] };
}

/**
 * Every menu's sales per branch per day in a range, FOLDED like every other
 * report (ADR 0026 Q5: reporting folds retroactively and always), so a dish
 * the POS spells two ways is one dish here too, filed under the canonical
 * menu's category.
 *
 * Plain numbers on the way out: this feeds display analytics, never a stored
 * figure or a ledger. Money stays Decimal everywhere it is written.
 */
export async function getSalesMenuDaysLogic(
  tenantId: string,
  query: { reach: BranchReach; branchId?: string; from: Date; to: Date; menuCategoryId?: string }
): Promise<SalesMenuDaysResult> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const grouped = await tx.salesLine.groupBy({
        by: ["businessDate", "branchId", "menuId"],
        where: whereFor(tenantId, { ...query, includeSuperseded: false }),
        _sum: { netAmount: true, qty: true },
      });
      const fold = await loadMergeFold(tx, tenantId);

      const acc = new Map<string, SalesMenuDaysResult["rows"][number]>();
      for (const g of grouped) {
        const menuId = foldMenuId(fold, g.menuId);
        const day = g.businessDate.toISOString().slice(0, 10);
        const key = `${day}|${g.branchId}|${menuId}`;
        const row = acc.get(key) ?? { day, branchId: g.branchId, menuId, net: 0, qty: 0 };
        row.net += Number(g._sum.netAmount ?? 0);
        row.qty += Number(g._sum.qty ?? 0);
        acc.set(key, row);
      }

      const menuIds = [...new Set([...acc.values()].map((r) => r.menuId))];
      const menus =
        menuIds.length === 0
          ? []
          : await tx.menu.findMany({
              where: { id: { in: menuIds } },
              select: {
                id: true,
                name: true,
                posMenuId: true,
                isPosStub: true,
                menuCategoryId: true,
                menuCategory: { select: { name: true } },
              },
            });

      return {
        rows: [...acc.values()],
        menus: menus.map((m) => ({
          id: m.id,
          name: m.name,
          code: m.posMenuId,
          categoryKey: m.menuCategoryId ?? "none",
          categoryName: m.menuCategory?.name ?? UNCATEGORISED_LABEL,
          isPosStub: m.isPosStub,
        })),
      };
    },
    { timeout: 15_000 }
  );
}

// ------------------------------------------------------------
// Just the totals — what /sales still needs besides menu × day rows
// ------------------------------------------------------------

export interface SalesTotals2 {
  net: Prisma.Decimal;
  gross: Prisma.Decimal;
  discount: Prisma.Decimal;
  serviceCharge: Prisma.Decimal;
  vat: Prisma.Decimal;
  qty: Prisma.Decimal;
  rows: number;
  hasBillIds: boolean;
  hasTimes: boolean;
}

/**
 * The money the menu × day rows do not carry (gross, discount, VAT, service
 * charge) and whether the files hold bills and times (rule P11).
 *
 * Why it exists (Kong, 2026-09-28: "โหลดแต่ละหน้าช้า"): /sales used the full
 * getSalesSummaryLogic for four tiles — ~10 queries in one transaction, each a
 * 32 ms round trip from Thailand to Neon, on the page's critical path. Its
 * by-day, by-menu and by-category work now comes from getSalesMenuDaysLogic,
 * so this asks only for the rest: three queries.
 */
export async function getSalesTotalsLogic(tenantId: string, query: GetSalesQuery): Promise<SalesTotals2> {
  return withTenantContext(tenantId, async (tx) => {
    const where = whereFor(tenantId, query);
    const agg = await tx.salesLine.aggregate({
      where,
      _sum: {
        netAmount: true,
        grossAmount: true,
        discountAmount: true,
        serviceChargeAmount: true,
        vatAmount: true,
        qty: true,
      },
      _count: { _all: true },
    });
    const withBill = await tx.salesLine.findFirst({ where: { ...where, posBillId: { not: null } }, select: { id: true } });
    const withTime = await tx.salesLine.findFirst({ where: { ...where, soldAt: { not: null } }, select: { id: true } });
    return {
      net: agg._sum.netAmount ?? ZERO(),
      gross: agg._sum.grossAmount ?? ZERO(),
      discount: agg._sum.discountAmount ?? ZERO(),
      serviceCharge: agg._sum.serviceChargeAmount ?? ZERO(),
      vat: agg._sum.vatAmount ?? ZERO(),
      qty: agg._sum.qty ?? ZERO(),
      rows: agg._count._all,
      hasBillIds: withBill !== null,
      hasTimes: withTime !== null,
    };
  });
}
