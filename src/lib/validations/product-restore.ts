// ============================================================
// Mise — Product restore-on-recreate validation (Sprint 1 Part 8.5 L2)
// ============================================================
// Zod schemas for the restore flow (ADR 0010): the fuzzy-search typeahead
// endpoint, and the restore action (optional newSku on a live-sku conflict +
// an optional per-mapping price-review payload).
//
// Isolated in its own file (NOT folded into product.ts / supplier-product-
// mapping.ts) because those two schemas both end in `.superRefine`, making them
// ZodEffects — which expose no `.pick()`/`.shape`, so the few reused fields
// cannot be borrowed and are redefined here. Ranges match Sprint 1 EXCEPT two
// locked Part 8.5 decisions:
//   - newSku is REQUIRED + non-empty (Sprint 1 product.sku is nullable/blank→
//     auto-gen; newSku is only ever sent to resolve a conflict, Q5).
//   - currentUnitPrice is positive() > 0 (Sprint 1 mapping uses nonnegative ≥ 0;
//     a restore price-review UPDATE is an explicit price entry, so ฿0 is a
//     mistake — Q7 C-sub-2, overrides "same field rules").
//
// `tenantId` / `productId` ownership and the live-sku uniqueness check are DB
// concerns enforced in the *Logic layer (L3), not here.
// Error messages are Thai (shown to user); code is English.
// ============================================================

import { z } from "zod";

/**
 * Blank (undefined / null / ""/whitespace) → undefined, so an empty optional
 * field on the wire does not get parsed as a present-but-empty value. Mirrors
 * the blankToNull helper in product.ts but targets undefined (for `.optional()`).
 */
const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/**
 * newSku — the replacement code typed in the restore dialog when the candidate's
 * sku collides with a LIVE product (Q5). Required + non-empty when present;
 * same length cap as Sprint 1 sku, same lack of charset pattern (free-text).
 */
export const newSkuSchema = z
  .string()
  .trim()
  .min(1, "กรุณากรอกรหัสสินค้าใหม่")
  .max(64, "รหัสสินค้าต้องไม่เกิน 64 ตัวอักษร");

/** keep = leave the orphan mapping's price as-is; update = supersede/overwrite. */
export const MAPPING_UPDATE_ACTIONS = ["keep", "update"] as const;
export const mappingUpdateActionSchema = z.enum(MAPPING_UPDATE_ACTIONS, {
  errorMap: () => ({ message: "การดำเนินการกับรายการราคาไม่ถูกต้อง" }),
});

/**
 * The editable price/terms of a mapping in the restore price-review step
 * (Q7 C-sub-2). All three required when the row's action is "update". Ranges
 * mirror Sprint 1 mapping EXCEPT currentUnitPrice > 0 (Decision 2). Coerced from
 * FormData strings; an empty price coerces to 0 → rejected by positive().
 */
export const mappingUpdatesPayloadSchema = z.object({
  currentUnitPrice: z.coerce
    .number({ invalid_type_error: "ราคาไม่ถูกต้อง" })
    .positive("ราคาต้องมากกว่า 0"),
  minOrderQty: z.coerce
    .number({ invalid_type_error: "ปริมาณขั้นต่ำไม่ถูกต้อง" })
    .positive("ปริมาณขั้นต่ำต้องมากกว่า 0"),
  leadTimeDays: z.coerce
    .number({ invalid_type_error: "Lead time ไม่ถูกต้อง" })
    .int("Lead time ต้องเป็นจำนวนเต็ม")
    .nonnegative("Lead time ต้องไม่ติดลบ")
    .max(365, "Lead time ต้องไม่เกิน 365 วัน"),
});

/**
 * One orphan mapping's decision in the restore review. `updates` is required
 * when action === "update", and IGNORED (not an error) when action === "keep"
 * even if a stray well-formed payload tags along — the logic layer simply does
 * not act on it.
 */
export const mappingUpdateSchema = z
  .object({
    mappingId: z.string().uuid("รายการราคาไม่ถูกต้อง"),
    action: mappingUpdateActionSchema,
    updates: mappingUpdatesPayloadSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.action === "update" && !val.updates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "กรุณากรอกราคาใหม่",
        path: ["updates"],
      });
    }
    // action === "keep" + updates present → silent ignore (no issue raised).
  });

/**
 * Top-level restore action input. `newSku` is present only when resolving a
 * live-sku conflict (blank on the wire → undefined → omitted). `mappingUpdates`
 * is empty when the candidate has no orphan mappings (Q6/Q7).
 */
export const restoreProductInputSchema = z.object({
  productId: z.string().uuid("รหัสสินค้าไม่ถูกต้อง"),
  newSku: z.preprocess(blankToUndefined, newSkuSchema.optional()),
  mappingUpdates: z.array(mappingUpdateSchema).default([]),
});

/**
 * Fuzzy-search typeahead input (Q3): the typeahead fires at 3+ chars; the cap
 * matches the product name max (200). Trimmed before the length checks.
 */
export const fuzzySearchInputSchema = z.object({
  searchTerm: z
    .string()
    .trim()
    .min(3, "พิมพ์อย่างน้อย 3 ตัวอักษร")
    .max(200, "คำค้นต้องไม่เกิน 200 ตัวอักษร"),
});

export type MappingUpdateAction = (typeof MAPPING_UPDATE_ACTIONS)[number];
export type MappingUpdatesPayload = z.infer<typeof mappingUpdatesPayloadSchema>;
export type MappingUpdate = z.infer<typeof mappingUpdateSchema>;
export type RestoreProductInput = z.infer<typeof restoreProductInputSchema>;
export type FuzzySearchInput = z.infer<typeof fuzzySearchInputSchema>;
