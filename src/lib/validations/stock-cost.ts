// ============================================================
// Mise — cost zod schemas (Sprint 2 Part 14 L2, ADR 0014)
// ============================================================
// Two write shapes and two read shapes.
//
// WRITE — the cost declaration (Q6). A declaration is the only cost a human
// types anywhere in the system: everything else is derived from a document. It
// arrives from two places (the adjust form's optional field, and the cost page's
// correct-it-later button) and both parse through the SAME schema, because "the
// cost you type today" and "the cost you type in November" must not be allowed
// to drift apart.
//
// READ — the queries behind getProductCostLogic / getBranchCostSummaryLogic.
// They are schema-parsed for the same reason Part 10's are: they arrive from the
// client and reach the database.
//
// This file must not import from src/server/* — it is bundled into the browser,
// and a Prisma import there is the mistake Part 10 L2 already made once.
// ============================================================

import { z } from "zod";
// TYPE-only, like waste.ts and goods-receipt.ts do — erased at build, so it does
// not pull the Prisma runtime into the browser bundle.
import type { CostSource as PrismaCostSource } from "@prisma/client";

/** Blank → null. Same helper as every other validations file. */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/** Blank → undefined, for `.optional()` filters. */
const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/**
 * `input_unit_cost` / `unit_cost` are Decimal(15,4) — 11 integer digits, 4
 * decimal places. Same ceiling as the PO's `UNIT_PRICE_MAX`: a cost and a price
 * are the same kind of number and rejecting them at different thresholds would
 * be a bug waiting for the one product priced between the two.
 */
export const UNIT_COST_MAX = 99_999_999_999.9999;
const COST_DECIMAL_PLACES = 4;

/**
 * Round-trip through `toFixed`, never `Number.isInteger(n * 10000)` — the
 * multiply trick rejects legitimate values because of binary floating point
 * (Pitfall #30, and the live bug Part 10's review found in the qty guard).
 */
const hasAtMostFourDecimals = (n: number) =>
  Number(n.toFixed(COST_DECIMAL_PLACES)) === n;

// ------------------------------------------------------------
// 1. The declaration body — shared by both entry points
// ------------------------------------------------------------

/**
 * What a person declares: a cost, **in the unit they think in**, plus why.
 *
 * `unitCost` is deliberately NOT per base unit. An owner knows "กระสอบละ 4,500";
 * making them divide by 25 before typing would be asking them to do the
 * computer's job, and would lose the number they actually meant. The server
 * converts with the ProductUnit's `toBaseRatio` and stores both (ADR 0014 Q6).
 *
 * **Zero is allowed.** It is not a mistake to declare that something cost
 * nothing — a supplier's free sample, a gift from another branch — and the DB
 * CHECK admits it for the same reason (Q10's UNPRICED fallback is also zero).
 * Negative is not: stock cannot cost less than nothing.
 */
export const costDeclarationBodySchema = z.object({
  unitCost: z.coerce
    .number({ invalid_type_error: "ต้นทุนไม่ถูกต้อง" })
    .min(0, "ต้นทุนต้องไม่ติดลบ")
    .max(UNIT_COST_MAX, "ต้นทุนเกินค่าที่ระบบรองรับ")
    .refine(hasAtMostFourDecimals, "ต้นทุนต้องมีทศนิยมไม่เกิน 4 ตำแหน่ง"),
  unitId: z.string().uuid("หน่วยไม่ถูกต้อง"),
  note: z.preprocess(
    blankToNull,
    z.string().trim().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร").nullable()
  ),
});

export type CostDeclarationBody = z.infer<typeof costDeclarationBodySchema>;

/**
 * Declaring against an existing movement — the "I found the invoice in November"
 * path. `movementId` identifies WHICH arrival of stock is being priced; that the
 * movement must be an `ADJUST_GAIN` is checked in the server logic, because zod
 * cannot see the ledger (Q6).
 */
export const declareStockCostInputSchema = costDeclarationBodySchema.extend({
  movementId: z.string().uuid("รายการเคลื่อนไหวไม่ถูกต้อง"),
});

export type DeclareStockCostInput = z.infer<typeof declareStockCostInputSchema>;

/** Thai display labels per field (keyed by zod `issue.path[0]`). */
export const STOCK_COST_FIELD_LABELS_TH: Record<
  keyof DeclareStockCostInput,
  string
> = {
  movementId: "รายการเคลื่อนไหว",
  unitCost: "ต้นทุนต่อหน่วย",
  unitId: "หน่วย",
  note: "หมายเหตุ",
};

// ------------------------------------------------------------
// 2. Read queries
// ------------------------------------------------------------

/**
 * The cost of one product at one branch.
 *
 * **`branchId` is required and has no default** (Q9): two branches are two
 * physical piles, and a silent fallback would answer a question nobody asked.
 * The single-branch tenant pays nothing for this — the page fills it in.
 *
 * `asOf` costs nothing to support: the replay simply stops walking early. Unlike
 * the adjustment's `occurredAt` it is NOT bounded to the 90-day backdate window
 * — asking what stock cost last year is a reasonable question, and the same
 * exemption Part 10 gave `asOf` on the balance query (Q8).
 */
export const getProductCostQuerySchema = z.object({
  productId: z.string().uuid(),
  branchId: z.string().uuid(),
  asOf: z.preprocess(blankToUndefined, z.coerce.date().optional()),
});

export type GetProductCostQuery = z.infer<typeof getProductCostQuerySchema>;

/** The batch form — the ONLY shape the grid and the branch summary may call. */
export const getProductCostsQuerySchema = z.object({
  productIds: z.array(z.string().uuid()).max(1000),
  branchId: z.string().uuid(),
  asOf: z.preprocess(blankToUndefined, z.coerce.date().optional()),
});

export type GetProductCostsQuery = z.infer<typeof getProductCostsQuerySchema>;

/**
 * The business-wide roll-up behind the branch-comparison page (Q9b).
 *
 * A period is required rather than defaulted: "spend" and "waste" mean nothing
 * without one, and a page that silently picks a window is a page whose numbers
 * cannot be reconciled against anything.
 */
export const getBranchCostSummaryQuerySchema = z
  .object({
    from: z.coerce.date({ required_error: "ต้องระบุวันที่เริ่มต้น" }),
    to: z.coerce.date({ required_error: "ต้องระบุวันที่สิ้นสุด" }),
  })
  .refine((q) => q.to.getTime() >= q.from.getTime(), {
    message: "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น",
    path: ["to"],
  });

export type GetBranchCostSummaryQuery = z.infer<
  typeof getBranchCostSummaryQuerySchema
>;

// ------------------------------------------------------------
// 3. Cost source — the provenance every read carries
// ------------------------------------------------------------

/**
 * Where a cost figure came from, and therefore how far to trust it (Q10).
 *
 * Returned by every cost read. Sprint 5's **Cost confidence HIGH/MEDIUM/LOW**
 * (CONTEXT.md) is computed from this — which is the reason it is returned now
 * rather than being left for Sprint 5 to reopen this Part for.
 */
export const COST_SOURCE_VALUES = [
  "FRONT_LAYER",
  "DECLARED",
  "LAST_KNOWN",
  "UNPRICED",
] as const;

export type CostSource = (typeof COST_SOURCE_VALUES)[number];

// Part 18 made this vocabulary STORABLE: `stock_transfer_item.cost_source` freezes
// it alongside the money, so a receiving branch can tell "the sender never knew"
// from "these goods were free" (ADR 0018 Q5). That means there are now two copies
// of the list — this one and the Prisma enum — and this guard is what stops them
// drifting. It must be ASSIGNED, not merely declared: a type alias resolving to
// `never` is not an error on its own, which is the hole that let Part 13's enum
// drift stay green.
type _AssertCostSource = PrismaCostSource extends CostSource
  ? CostSource extends PrismaCostSource
    ? true
    : never
  : never;
const _costSourceDriftGuard: _AssertCostSource = true;
void _costSourceDriftGuard;

export const COST_SOURCE_LABELS_TH: Record<CostSource, string> = {
  FRONT_LAYER: "จากของที่มีอยู่จริง",
  DECLARED: "ระบุโดยผู้ใช้",
  LAST_KNOWN: "จากราคาซื้อล่าสุด",
  UNPRICED: "ยังไม่ทราบต้นทุน",
};

/** Longer gloss for the tooltip / caveat line — why this number is what it is. */
export const COST_SOURCE_HINTS_TH: Record<CostSource, string> = {
  FRONT_LAYER: "ราคาของล็อตที่จะถูกใช้เป็นลำดับถัดไป",
  DECLARED: "มีผู้ระบุต้นทุนของล็อตนี้ไว้เอง",
  LAST_KNOWN: "ของหมดหรือติดลบ จึงใช้ราคาซื้อครั้งล่าสุดแทน",
  UNPRICED: "ยังไม่เคยซื้อสินค้านี้เข้าระบบ ต้นทุนที่แสดงเป็น 0",
};
