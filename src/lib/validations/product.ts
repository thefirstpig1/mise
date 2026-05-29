// ============================================================
// Mise — Product input validation (Sprint 1 Part 7a)
// ============================================================
// Single zod schema for create + update of a RAW product, mirroring the
// supplier/category slices. 7a scope (RAW only): identity + classification +
// a single base unit. PREPPED (parentProductId, yieldPercent), multi-unit and
// liquid density are Part 7b — not here. See ADR 0005.
//
// `primaryDimension` is a fixed 3-value set (WEIGHT/VOLUME/COUNT). It drives
// which units are valid for the base unit. PRIMARY_DIMENSION_VALUES is the
// SINGLE SOURCE OF TRUTH: the zod enum AND the form <select> both read it.
//
// `sku` is OPTIONAL here: blank → the logic layer auto-generates one (P-0001…)
// (Q3). When provided it is used as-is. Uniqueness of (tenantId, sku) is a
// Prisma @@unique (full unique, counts soft-deleted — Pitfall #22); the logic
// layer maps P2002 → ProductSkuConflictError → Thai.
//
// `baseUnitName` is required free-text here (non-empty); the logic layer
// validates it against unit_template for the chosen dimension (the valid set is
// DB data, so it cannot live in zod).
//
// Error messages are Thai (shown to user); code is English.
// ============================================================

import { z } from "zod";

/** The three primary measurement dimensions — single source for zod + the form. */
export const PRIMARY_DIMENSION_VALUES = ["WEIGHT", "VOLUME", "COUNT"] as const;
export type PrimaryDimension = (typeof PRIMARY_DIMENSION_VALUES)[number];

/** Thai gloss per dimension (Thai-first) — used by the form <select> options. */
export const PRIMARY_DIMENSION_LABELS_TH: Record<PrimaryDimension, string> = {
  WEIGHT: "น้ำหนัก",
  VOLUME: "ปริมาตร",
  COUNT: "จำนวนนับ",
};

/** Product type — RAW (bought as-is) or PREPPED (produced from a parent + yield). */
export const PRODUCT_TYPE_VALUES = ["RAW", "PREPPED"] as const;
export type ProductType = (typeof PRODUCT_TYPE_VALUES)[number];

/** Thai gloss per type — used by the form <select> options. */
export const PRODUCT_TYPE_LABELS_TH: Record<ProductType, string> = {
  RAW: "วัตถุดิบ",
  PREPPED: "ของแปรรูป",
};

/**
 * A missing/blank field means "not provided" → null.
 * Covers undefined, null, and "" / whitespace-only strings.
 */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/** Optional trimmed free-text: blank → null, otherwise the trimmed string. */
const optionalText = z.preprocess(blankToNull, z.string().trim().nullable());

export const productInputSchema = z.object({
  // Blank → null → logic auto-generates (Q3). When present, used as-is.
  sku: z.preprocess(
    blankToNull,
    z.string().trim().max(64, "รหัสสินค้าต้องไม่เกิน 64 ตัวอักษร").nullable()
  ),
  name: z.preprocess(
    (v) => v ?? "",
    z
      .string()
      .trim()
      .min(1, "กรุณากรอกชื่อสินค้า")
      .max(200, "ชื่อต้องไม่เกิน 200 ตัวอักษร")
  ),
  nameEn: optionalText,
  primaryDimension: z.enum(PRIMARY_DIMENSION_VALUES, {
    errorMap: () => ({
      message: "กรุณาเลือกหน่วยวัดหลัก (น้ำหนัก/ปริมาตร/จำนวนนับ)",
    }),
  }),
  // Required; logic validates it exists in unit_template for the dimension.
  baseUnitName: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "กรุณาเลือกหน่วยพื้นฐาน")
  ),
  categoryId: z.preprocess(
    blankToNull,
    z.string().uuid("หมวดหมู่ไม่ถูกต้อง").nullable()
  ),
  isActive: z.boolean().default(true),
  // 7b multi-unit: extra units beyond the base. Each shares the product's
  // dimension (set server-side) and converts to the base via toBaseRatio.
  // Names may be custom (กระสอบ/ลัง); coerced from FormData strings.
  additionalUnits: z
    .array(
      z.object({
        unitName: z.preprocess(
          (v) => (typeof v === "string" ? v.trim() : v),
          z.string().min(1, "กรุณากรอกชื่อหน่วย")
        ),
        toBaseRatio: z.coerce
          .number()
          .positive("อัตราส่วนต้องมากกว่า 0"),
      })
    )
    .default([]),
  // Which unit is ordered by default. null → the logic treats it as the base.
  defaultBuyUnitName: z.preprocess(blankToNull, z.string().trim().nullable()),
  // 7c: PREPPED parent + yield. Default RAW so existing 7a/7b call sites keep
  // parsing unchanged. PREPPED requires both fields; RAW requires both null.
  // Cycle/depth checks live in src/server/product.ts (ADR 0007).
  //
  // SAFETY: actions (L3) + ProductForm (L4) MUST send `type` explicitly on
  // every request — DO NOT rely on this default. If `type` falls off the wire
  // (e.g. a missing form field), zod silently fills RAW → superRefine then
  // forces parent/yield to null, and a PREPPED edit would lose its data
  // without an error. The default exists ONLY so internal/test callers that
  // care only about RAW (7a/7b) keep working unchanged.
  type: z
    .enum(PRODUCT_TYPE_VALUES, {
      errorMap: () => ({ message: "ประเภทสินค้าไม่ถูกต้อง (วัตถุดิบ/ของแปรรูป)" }),
    })
    .default("RAW"),
  parentProductId: z.preprocess(
    blankToNull,
    z.string().uuid("รหัสสินค้าแม่ไม่ถูกต้อง").nullable()
  ),
  // 0.01–999.99 hard cap = Decimal(5,2); >100 ALLOWED (cooked rice, soaked beans).
  yieldPercent: z.preprocess(
    blankToNull,
    z.coerce
      .number()
      .min(0.01, "yield ต้องอย่างน้อย 0.01%")
      .max(999.99, "yield ต้องไม่เกิน 999.99%")
      .nullable()
  ),
  // 7d liquid density (g/ml). XOR with the override (Q2), gated to non-COUNT
  // (Q3) — both enforced in superRefine. FK to a global reference template;
  // ownership is NOT tenant-checked (reference data) — see src/server/product.ts.
  liquidDensityTemplateId: z.preprocess(
    blankToNull,
    z.string().uuid("เทมเพลตความหนาแน่นไม่ถูกต้อง").nullable()
  ),
  // Hard cap (0, 2.5] (Q4): positive() rejects 0/negative; max 2.5 catches the
  // "1030 forgot the decimal" typo. The soft [0.5, 2.0] hint is UI-only (L5).
  densityGPerMlOverride: z.preprocess(
    blankToNull,
    z.coerce
      .number()
      .positive("ความหนาแน่นต้องมากกว่า 0")
      .max(2.5, "ความหนาแน่นเกินช่วงที่เป็นไปได้ของอาหาร")
      .nullable()
  ),
}).superRefine((val, ctx) => {
  // Unit names (base + additional) must be unique within the product. Checked
  // here so the user gets a clean field error before the DB @@unique fires
  // (the P2002 backstop is narrowed in src/server/product.ts — Pitfall #24).
  const names = [val.baseUnitName, ...val.additionalUnits.map((u) => u.unitName)];
  const seen = new Set<string>();
  names.forEach((n, i) => {
    if (seen.has(n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ชื่อหน่วยซ้ำกัน",
        path: i === 0 ? ["baseUnitName"] : ["additionalUnits", i - 1, "unitName"],
      });
    }
    seen.add(n);
  });
  // The default buy unit must be one of the product's units.
  if (val.defaultBuyUnitName && !names.includes(val.defaultBuyUnitName)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "หน่วยซื้อหลักไม่อยู่ในรายการหน่วย",
      path: ["defaultBuyUnitName"],
    });
  }
  // 7c invariant: PREPPED ↔ {parentProductId, yieldPercent} both non-null;
  // RAW ↔ both null. ADR 0007.
  if (val.type === "PREPPED") {
    if (!val.parentProductId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ของแปรรูปต้องระบุสินค้าแม่",
        path: ["parentProductId"],
      });
    }
    if (val.yieldPercent === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ของแปรรูปต้องระบุเปอร์เซ็นต์ผลผลิต",
        path: ["yieldPercent"],
      });
    }
  } else {
    if (val.parentProductId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "วัตถุดิบต้องไม่มีสินค้าแม่",
        path: ["parentProductId"],
      });
    }
    if (val.yieldPercent !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "วัตถุดิบต้องไม่มีเปอร์เซ็นต์ผลผลิต",
        path: ["yieldPercent"],
      });
    }
  }
  // 7d density rules.
  const hasTemplate = val.liquidDensityTemplateId !== null;
  const hasOverride = val.densityGPerMlOverride !== null;
  // Q3 COUNT gate: a count-based product cannot carry density. Issue lands on
  // whichever density field was set (server cleanses COUNT → both null BEFORE
  // zod in L3, so a user who never touched density never sees this).
  if (val.primaryDimension === "COUNT") {
    if (hasTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "สินค้าประเภทนับชิ้นไม่ใช้ความหนาแน่น",
        path: ["liquidDensityTemplateId"],
      });
    }
    if (hasOverride) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "สินค้าประเภทนับชิ้นไม่ใช้ความหนาแน่น",
        path: ["densityGPerMlOverride"],
      });
    }
  } else if (hasTemplate && hasOverride) {
    // Q2 XOR: template OR override, never both. Issue lands on the override —
    // the field the user layered on top of the chosen template.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "เลือกค่ามาตรฐานหรือใส่ค่าเองอย่างเดียว",
      path: ["densityGPerMlOverride"],
    });
  }
});

export type ProductInput = z.infer<typeof productInputSchema>;

/** Thai display labels per schema field (keyed by zod issue.path[0]). */
export const PRODUCT_FIELD_LABELS_TH: Record<keyof ProductInput, string> = {
  sku: "รหัสสินค้า",
  name: "ชื่อสินค้า",
  nameEn: "ชื่อ (อังกฤษ)",
  primaryDimension: "หน่วยวัดหลัก",
  baseUnitName: "หน่วยพื้นฐาน",
  categoryId: "หมวดหมู่",
  isActive: "สถานะใช้งาน",
  additionalUnits: "หน่วยเพิ่มเติม",
  defaultBuyUnitName: "หน่วยซื้อหลัก",
  type: "ประเภทสินค้า",
  parentProductId: "สินค้าแม่",
  yieldPercent: "เปอร์เซ็นต์ผลผลิต",
  liquidDensityTemplateId: "ความหนาแน่น (ค่ามาตรฐาน)",
  densityGPerMlOverride: "ความหนาแน่น (g/ml)",
};
