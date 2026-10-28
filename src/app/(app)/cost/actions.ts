"use server";

// ============================================================
// Mise — cost Server Actions (Sprint 2 Part 14 L4, ADR 0014)
// ============================================================
// Thin glue, per the repo convention: requireTenant → zod → *Logic → Thai error
// → view. The FIFO arithmetic is in fifo-replay.ts, the queries in stock-cost.ts,
// the declaration rules in cost-declaration.ts; nothing decides anything here.
//
// Only the errors this action can actually PRODUCE are mapped to Thai. Anything
// else rethrows to the error boundary rather than being buried in a form message
// the user cannot act on (the Part 10 L4 rule).
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import {
  declareStockCostInputSchema,
  STOCK_COST_FIELD_LABELS_TH,
} from "@/lib/validations/stock-cost";
import {
  CostDeclarationTargetError,
  CostUnitMismatchError,
  declareStockCostLogic,
} from "@/server/cost-declaration";

/** The movement being priced is gone, foreign, or is not a stock GAIN. */
const NOT_A_GAIN_MESSAGE =
  "ระบุต้นทุนได้เฉพาะของที่นับเจอเพิ่มเท่านั้น — ต้นทุนของใบรับของแก้ที่เอกสารนั้น";
const TARGET_NOT_FOUND_MESSAGE = "ไม่พบรายการเคลื่อนไหวที่ต้องการระบุต้นทุน";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";

export type CostActionState =
  | { ok: true; declarationId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    const label =
      STOCK_COST_FIELD_LABELS_TH[key as keyof typeof STOCK_COST_FIELD_LABELS_TH];
    fieldErrors[key] = issue.message || `${label ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/** Map the form's snake_case names onto the schema's camelCase shape. */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  return {
    movementId: formData.get("movement_id"),
    unitCost: formData.get("unit_cost"),
    unitId: formData.get("unit_id"),
    note: formData.get("note"),
  };
}

/**
 * Declare — or correct — the cost of stock that arrived without a document.
 *
 * Entry point two of two (entry point one is the optional field on the adjust
 * form, which writes inside the adjustment's own transaction). A correction
 * never overwrites: the previous statement is closed and both stay visible.
 */
export async function declareCostAction(
  _prevState: CostActionState,
  formData: FormData
): Promise<CostActionState> {
  const { tenantId, membership } = await requireTenant("cost:view");

  const parsed = declareStockCostInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const declaration = await declareStockCostLogic(
      tenantId,
      parsed.data,
      membership.userId
    );

    // Cost is derived from the ledger on every read, so a declaration changes
    // every surface that shows a cost — not just the page it was typed on.
    revalidatePath("/cost");
    revalidatePath("/stock");
    // The stock card is where a price is now declared (2026-10-27).
    revalidatePath("/stock/history");

    return { ok: true, declarationId: declaration.id };
  } catch (e) {
    if (e instanceof CostDeclarationTargetError) {
      return {
        ok: false,
        formError:
          e.reason === "NOT_A_GAIN" ? NOT_A_GAIN_MESSAGE : TARGET_NOT_FOUND_MESSAGE,
      };
    }
    if (e instanceof CostUnitMismatchError) {
      return { ok: false, fieldErrors: { unitId: UNIT_MISMATCH_MESSAGE } };
    }
    throw e;
  }
}

// ── /cost targets (Kong 2026-10-23) ──────────────────────────────────────────
// The shop's own targets and the two thresholds the overview reads against.
// The same columns are edited in ตั้งค่าร้าน; this is the shortcut on the page
// that uses them. Out-of-range values are refused, not clamped: a target the
// owner did not type must never quietly become the one the page judges by.
export type CostTargetsInput = { food: number; prime: number; variance: number; coverageMin: number; slowDays: number };

export async function saveCostTargetsAction(
  input: CostTargetsInput
): Promise<{ ok: true } | { ok: false; formError: string }> {
  const { tenantId } = await requireTenant("settings:write");
  const { food, prime, variance, coverageMin, slowDays } = input;
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!inRange(food, 5, 90) || !inRange(prime, 10, 99) || !inRange(variance, 0, 20)) {
    return { ok: false, formError: "เป้าต้องเป็นตัวเลข: ต้นทุนอาหาร 5–90% · prime cost 10–99% · ไม่ตรงกับระบบ 0–20%" };
  }
  if (!Number.isInteger(coverageMin) || !inRange(coverageMin, 50, 100) || !Number.isInteger(slowDays) || !inRange(slowDays, 7, 365)) {
    return { ok: false, formError: "เกณฑ์ตัดสต๊อกครบต้องเป็น 50–100% และของค้างนานต้องเป็น 7–365 วัน (จำนวนเต็ม)" };
  }
  await withTenantContext(tenantId, (tx) =>
    tx.tenant.update({
      where: { id: tenantId },
      data: {
        foodCostTargetPct: Math.round(food * 10) / 10,
        primeCostTargetPct: Math.round(prime * 10) / 10,
        countVarianceTargetPct: Math.round(variance * 10) / 10,
        costCoverageMinPct: coverageMin,
        slowStockDays: slowDays,
      },
    })
  );
  revalidatePath("/settings");
  return { ok: true };
}

// ── per-menu food-cost target (Kong 2026-10-24, rule PV-ALLOW) ───────────────
// null = follow the shop's target. 5–95%, refused (not clamped) outside it.
export async function saveMenuCostTargetAction(
  menuId: string,
  pct: number | null
): Promise<{ ok: true } | { ok: false; formError: string }> {
  const { tenantId } = await requireTenant("master:write");
  if (pct !== null && !(Number.isFinite(pct) && pct >= 5 && pct <= 95)) {
    return { ok: false, formError: "เป้าต้นทุนต้องอยู่ระหว่าง 5–95% ของราคาขาย" };
  }
  const n = await withTenantContext(tenantId, (tx) =>
    tx.menu.updateMany({
      where: { id: menuId, tenantId, deletedAt: null },
      data: { foodCostTargetPct: pct === null ? null : Math.round(pct * 10) / 10 },
    })
  );
  if (n.count !== 1) return { ok: false, formError: "ไม่พบเมนูนี้ อาจถูกลบไปแล้ว" };
  return { ok: true };
}
