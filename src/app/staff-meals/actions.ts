"use server";

// ============================================================
// Mise — staff meal Server Actions (Sprint 5 Part 26 L4, ADR 0028)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// Three things specific to this slice:
//
//   * **`submit_key` is READ from the form, never minted here** (the rule
//     goods-receipts/, stock/ and waste/ already follow). A server-minted key is
//     a fresh key on every retry, which is exactly the double-POST it closes —
//     and here the key spreads across the ITEMS too, because they are the
//     ledger's sources.
//   * **Nothing here refuses on a policy.** Over the quota, over the price
//     ceiling, a day that already has zero-price sales — all reported, none
//     blocked. The food is already eaten; refusing the record would make the
//     stock wrong AND hide that anybody went over.
//   * **Every refusal that IS returned comes from an inability**, not a rule:
//     the dish's recipe cannot be exploded, so there is no set of movements to
//     write. Each one names the thing in the way and where to go and fix it.
//
// Per the 7a-8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  createStaffMealInputSchema,
  createStaffMemberInputSchema,
  updateStaffMemberInputSchema,
  voidStaffMealInputSchema,
} from "@/lib/validations/staff-meal";
import {
  StaffMealAlreadyVoidedError,
  StaffMealComponentNoRecipeError,
  StaffMealNoRecipeError,
  StaffMealNotFoundError,
  StaffMealPreppedIngredientError,
  StaffMealRecipeUnresolvableError,
  StaffMemberNotFoundError,
  createStaffMealLogic,
  createStaffMemberLogic,
  updateStaffMemberLogic,
  voidStaffMealLogic,
} from "@/server/staff-meal";
import {
  MovementSourceConflictError,
  QtyRoundsToZeroError,
  StockUnitMismatchError,
} from "@/server/stock-movement";
import { CrossTenantReferenceError } from "@/server/product";

// --- Thai messages (the user-facing error paths) ---
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
const CONFLICT_MESSAGE = "ระบบกำลังบันทึกรายการนี้อยู่ กรุณาลองอีกครั้ง";
const NOT_FOUND_MESSAGE = "ไม่พบรายการมื้อพนักงานนี้";
const ALREADY_VOIDED_MESSAGE = "รายการนี้ถูกยกเลิกไปแล้ว";
const MEMBER_NOT_FOUND_MESSAGE = "ไม่พบพนักงานคนนี้";

export type StaffMealActionState =
  | {
      ok: true;
      staffMealId: string;
      itemCount: number;
      /** The frozen SELLING price per serving — never a cost. */
      unitPrice: string | null;
      priceSource: "SOLD" | "PLANNED" | "NONE";
      /** The same key was submitted before; nothing was deducted again. */
      replayed: boolean;
    }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type VoidStaffMealActionState =
  | { ok: true; staffMealId: string; reversedItems: number }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type StaffMemberActionState =
  | { ok: true; staffMemberId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/**
 * Map a user-facing typed error → Thai field/form error; rethrow the rest.
 *
 * The four recipe refusals each say WHERE TO GO. "บันทึกไม่ได้" alone leaves
 * someone staring at a form that will keep refusing, and every one of these has
 * a fix that lives on another screen.
 *
 * Deliberately NOT mapped: `MovementSignMismatchError` and
 * `MovementSourceNotFoundError`. This Part writes its own sources and applies
 * its own sign, so either firing is a bug — and a polite Thai form message would
 * bury it where nobody looks.
 */
function toFormError(e: unknown): {
  formError?: string;
  fieldErrors?: Record<string, string>;
} {
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "product"
        ? "productId"
        : e.kind === "branch"
          ? "branchId"
          : e.kind === "menu"
            ? "menuId"
            : null;
    return field
      ? { fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof StaffMealNoRecipeError) {
    return {
      fieldErrors: {
        menuId:
          "เมนูนี้ยังไม่มีสูตรของสาขานี้ในวันที่เลือก — สร้างสูตรที่หน้าสูตรอาหารก่อน หรือบันทึกเป็นวัตถุดิบแทน",
      },
    };
  }
  if (e instanceof StaffMealComponentNoRecipeError) {
    // The component is the thing to fix, and it is not the dish that was picked
    // — without naming it, the fix is a hunt through the set menu's tree.
    return {
      fieldErrors: {
        menuId:
          "เมนูนี้เป็นชุดที่มีเมนูย่อยยังไม่มีสูตร ตัดสต๊อกไม่ครบจึงไม่บันทึก — เติมสูตรของเมนูย่อยก่อน",
      },
    };
  }
  if (e instanceof StaffMealPreppedIngredientError) {
    return {
      fieldErrors: {
        menuId:
          "สูตรนี้มีของที่ร้านทำเอง ซึ่งระบบยังเพิ่มยอดคงเหลือให้ไม่ได้ ตัดออกไปจะติดลบถาวร — บันทึกเป็นวัตถุดิบแทน",
      },
    };
  }
  if (e instanceof StaffMealRecipeUnresolvableError) {
    return {
      fieldErrors: {
        menuId: "สูตรของเมนูนี้กางไม่ได้ (อาจวนกลับหาตัวเอง หรือซ้อนลึกเกินไป) — ตรวจที่หน้าสูตรอาหาร",
      },
    };
  }
  if (e instanceof StockUnitMismatchError) {
    return { fieldErrors: { items: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof QtyRoundsToZeroError) {
    return {
      fieldErrors: {
        items: `จำนวนน้อยเกินไป — ${e.inputQty.toString()} ${e.inputUnitName} ปัดเป็น 0${e.baseUnitName ? ` ${e.baseUnitName}` : ""}`,
      },
    };
  }
  if (e instanceof MovementSourceConflictError) {
    return { formError: CONFLICT_MESSAGE };
  }
  if (e instanceof StaffMealNotFoundError) {
    return { formError: NOT_FOUND_MESSAGE };
  }
  if (e instanceof StaffMealAlreadyVoidedError) {
    return { formError: ALREADY_VOIDED_MESSAGE };
  }
  if (e instanceof StaffMemberNotFoundError) {
    return { fieldErrors: { staffMemberId: MEMBER_NOT_FOUND_MESSAGE } };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Every surface a staff meal changes.
 *
 * `/cost` is here because the stock left the shelf — inventory value and the
 * นับสต๊อก gross profit both move. It is NOT here because cost of goods sold
 * moved: rule S5 keeps a staff meal out of that figure under สูตรอาหาร, and
 * ADR 0028 Consequence 3 says the other method cannot separate it at all.
 *
 * `/consumption` is deliberately absent. A staff meal writes no
 * `sales_consumption_run`, and nothing on that screen changes.
 */
function revalidateStaffMealViews(): void {
  revalidatePath("/staff-meals");
  revalidatePath("/stock");
  revalidatePath("/cost");
}

/** Record one meal. Explodes the recipe and posts to the ledger in one transaction. */
export async function createStaffMealAction(
  _prevState: StaffMealActionState,
  formData: FormData
): Promise<StaffMealActionState> {
  const { tenantId, membership } = await requireTenant("staffmeal:write");

  // Pot lines arrive as three parallel arrays, the shape every multi-line form
  // in this project uses. Zipped here rather than in zod so the schema stays a
  // statement about the DATA and not about how a browser serialises a table.
  const productIds = formData.getAll("item_product_id");
  const inputQtys = formData.getAll("item_input_qty");
  const inputUnitIds = formData.getAll("item_input_unit_id");
  const items = productIds
    .map((productId, i) => ({
      productId,
      inputQty: inputQtys[i],
      inputUnitId: inputUnitIds[i],
    }))
    // A blank row is a row the user left alone, not a row they got wrong.
    .filter((r) => typeof r.productId === "string" && r.productId !== "");

  const parsed = createStaffMealInputSchema.safeParse({
    submitKey: formData.get("submit_key"),
    branchId: formData.get("branch_id"),
    businessDate: formData.get("business_date"),
    staffMemberId: formData.get("staff_member_id"),
    menuId: formData.get("menu_id"),
    servings: formData.get("servings") ?? 1,
    items,
    recordedByName: formData.get("recorded_by_name"),
    notes: formData.get("notes"),
    acknowledgeDuplicateRisk: formData.get("acknowledge_duplicate_risk"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const res = await createStaffMealLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateStaffMealViews();
    return {
      ok: true,
      staffMealId: res.id,
      itemCount: res.itemCount,
      // Decimal cannot cross to a Client Component (Pitfall #20).
      unitPrice: res.unitPrice === null ? null : res.unitPrice.toString(),
      priceSource: res.priceSource,
      replayed: res.replayed,
    };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Correct a meal: append reversal items and give the stock back at what it left
 * with. The original document stands — "this was keyed wrong" is itself worth
 * being able to see.
 */
export async function voidStaffMealAction(
  _prevState: VoidStaffMealActionState,
  formData: FormData
): Promise<VoidStaffMealActionState> {
  const { tenantId, membership } = await requireTenant("staffmeal:write");

  const parsed = voidStaffMealInputSchema.safeParse({
    id: formData.get("id"),
    voidReason: formData.get("void_reason"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const voided = await voidStaffMealLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateStaffMealViews();
    return { ok: true, staffMealId: voided.id, reversedItems: voided.reversedItems };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

// ------------------------------------------------------------
// The roster
// ------------------------------------------------------------

export async function createStaffMemberAction(
  _prevState: StaffMemberActionState,
  formData: FormData
): Promise<StaffMemberActionState> {
  const { tenantId } = await requireTenant("staffmeal:write");

  const parsed = createStaffMemberInputSchema.safeParse({
    name: formData.get("name"),
    branchId: formData.get("branch_id"),
    dailyQuotaAmount: formData.get("daily_quota_amount"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const member = await createStaffMemberLogic(tenantId, parsed.data);
    revalidatePath("/staff-meals");
    revalidatePath("/staff-meals/people");
    return { ok: true, staffMemberId: member.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Edit a person, including whether they still work here.
 *
 * Switching `isActive` off does NOT remove them from any past month — it is a
 * claim about the future, and every read that reports the past labels them
 * instead (rule S7). There is no delete: a name that has meals against it is
 * part of the record.
 */
export async function updateStaffMemberAction(
  _prevState: StaffMemberActionState,
  formData: FormData
): Promise<StaffMemberActionState> {
  const { tenantId } = await requireTenant("staffmeal:write");

  const parsed = updateStaffMemberInputSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    branchId: formData.get("branch_id"),
    dailyQuotaAmount: formData.get("daily_quota_amount"),
    isActive: formData.get("is_active"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const member = await updateStaffMemberLogic(tenantId, parsed.data);
    revalidatePath("/staff-meals");
    revalidatePath("/staff-meals/people");
    return { ok: true, staffMemberId: member.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}
