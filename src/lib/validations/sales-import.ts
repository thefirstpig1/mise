// ============================================================
// Mise — POS sales import zod schemas (Sprint 4 Part 19 L2, ADR 0019)
// ============================================================
// Five write shapes and two read queries: define a POS, define a PROFILE (how to
// read one shape of file), UPLOAD, COMMIT what was previewed, and RESOLVE a menu
// a file named but Mise did not recognise.
//
// What is NOT here, deliberately:
//   - **Any sales figure.** Nothing about a sale is typed by a human; every
//     number comes out of the file through `src/lib/sales-file.ts`, which is
//     also where the blank-versus-zero rule lives. There is nothing on this
//     boundary for a person to get wrong, and nothing for them to fake.
//   - **The branch.** It comes from the profile's integration, never from the
//     payload and never from the file (rule P12) — the previous system let a
//     human type it beside the filename, and a typo moved a whole day of sales
//     to the wrong shop in silence.
//   - **Which days will be replaced.** That is a database question about
//     `sales_day`, answered in L3c and shown in the preview.
//   - `tenantId` / `uploadedBy` / `confirmedBy` — from requireTenant + session.
//   - Whether the integration, menu and department belong to the tenant — DB
//     lookups, so they live in L3.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import type {
  FileEncoding as PrismaFileEncoding,
  MenuSource as PrismaMenuSource,
  PosType as PrismaPosType,
  SalesChannel as PrismaSalesChannel,
  SalesFileKind as PrismaSalesFileKind,
  SalesImportBatchStatus as PrismaSalesImportBatchStatus,
} from "@prisma/client";
import { SALES_DATE_FORMATS } from "@/lib/sales-file";

// ------------------------------------------------------------
// 0. Small shared preprocessors (same helpers as every other validations file)
// ------------------------------------------------------------

const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/** Only "true" / true / "on" are truthy — `z.coerce.boolean` reads the non-empty
 *  string "false" as `true`, so `?includeSuperseded=false` would do the opposite
 *  of what it says. Same helper, same reason, as waste.ts and transfer.ts. */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

/**
 * A checkbox whose value MUST be stated, with no default that could quietly be
 * wrong.
 *
 * `amountsIncludeVat` and `amountsIncludeServiceCharge` are properties of the
 * REPORT, not of the data (ADR 0019 Q11). Defaulting either one is a silent 7%
 * or 10% error on every row of every file that profile ever reads — the exact
 * class of failure this Part exists to refuse — so an unticked box and an
 * unanswered question must not look the same. HTML omits unchecked boxes
 * entirely, so the form posts an explicit "true"/"false" and this rejects
 * anything else.
 */
const explicitBoolean = (label: string) =>
  z.preprocess(
    (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : undefined),
    z.boolean({ required_error: label, invalid_type_error: label })
  );

// ------------------------------------------------------------
// 1. Enum vocabularies — local const arrays (the Sprint 1 pattern)
// ------------------------------------------------------------
// Each list is duplicated in the Prisma enum, and each drift guard is what stops
// the two copies parting company. The guard must be ASSIGNED, not merely
// declared: a type alias resolving to `never` is not an error on its own, which
// is the hole that let Part 13's enum drift stay green.

export const POS_TYPE_VALUES = [
  "FOODSTORY",
  "WONGNAI",
  "OCHA",
  "STOREHUB",
  "LOYVERSE",
  "CUSTOM",
] as const;
export type PosTypeValue = (typeof POS_TYPE_VALUES)[number];
type _AssertPosType = PrismaPosType extends PosTypeValue
  ? PosTypeValue extends PrismaPosType
    ? true
    : never
  : never;
const _posTypeDriftGuard: _AssertPosType = true;
void _posTypeDriftGuard;

export const SALES_FILE_KIND_VALUES = ["BILL_DETAIL", "DAILY_SUMMARY"] as const;
export type SalesFileKindValue = (typeof SALES_FILE_KIND_VALUES)[number];
type _AssertFileKind = PrismaSalesFileKind extends SalesFileKindValue
  ? SalesFileKindValue extends PrismaSalesFileKind
    ? true
    : never
  : never;
const _fileKindDriftGuard: _AssertFileKind = true;
void _fileKindDriftGuard;

export const FILE_ENCODING_VALUES = ["UTF8", "TIS620"] as const;
export type FileEncodingValue = (typeof FILE_ENCODING_VALUES)[number];
type _AssertEncoding = PrismaFileEncoding extends FileEncodingValue
  ? FileEncodingValue extends PrismaFileEncoding
    ? true
    : never
  : never;
const _encodingDriftGuard: _AssertEncoding = true;
void _encodingDriftGuard;

export const SALES_CHANNEL_VALUES = [
  "DINE_IN",
  "TAKEAWAY",
  "DELIVERY_GRAB",
  "DELIVERY_LINEMAN",
  "DELIVERY_FOODPANDA",
  "DELIVERY_ROBINHOOD",
  "DELIVERY_SHOPEEFOOD",
  "ONLINE_ORDER",
  "OTHER",
] as const;
export type SalesChannelValue = (typeof SALES_CHANNEL_VALUES)[number];
type _AssertChannel = PrismaSalesChannel extends SalesChannelValue
  ? SalesChannelValue extends PrismaSalesChannel
    ? true
    : never
  : never;
const _channelDriftGuard: _AssertChannel = true;
void _channelDriftGuard;

export const MENU_SOURCE_VALUES = ["POS", "MISE"] as const;
export type MenuSourceValue = (typeof MENU_SOURCE_VALUES)[number];
type _AssertMenuSource = PrismaMenuSource extends MenuSourceValue
  ? MenuSourceValue extends PrismaMenuSource
    ? true
    : never
  : never;
const _menuSourceDriftGuard: _AssertMenuSource = true;
void _menuSourceDriftGuard;

export const SALES_IMPORT_BATCH_STATUS_VALUES = [
  "PENDING",
  "PREVIEW",
  "COMMITTED",
  "FAILED",
  "CANCELLED",
] as const;
export type SalesImportBatchStatusValue =
  (typeof SALES_IMPORT_BATCH_STATUS_VALUES)[number];
type _AssertBatchStatus = PrismaSalesImportBatchStatus extends SalesImportBatchStatusValue
  ? SalesImportBatchStatusValue extends PrismaSalesImportBatchStatus
    ? true
    : never
  : never;
const _batchStatusDriftGuard: _AssertBatchStatus = true;
void _batchStatusDriftGuard;

// ------------------------------------------------------------
// 2. Thai labels
// ------------------------------------------------------------

export const SALES_FILE_KIND_LABELS_TH: Record<SalesFileKindValue, string> = {
  BILL_DETAIL: "รายบิล (มีเลขบิล/เวลา)",
  DAILY_SUMMARY: "สรุปรายวัน (เมนูละแถวต่อวัน)",
};

export const SALES_CHANNEL_LABELS_TH: Record<SalesChannelValue, string> = {
  DINE_IN: "ทานที่ร้าน",
  TAKEAWAY: "ซื้อกลับบ้าน",
  DELIVERY_GRAB: "Grab",
  DELIVERY_LINEMAN: "LINE MAN",
  DELIVERY_FOODPANDA: "foodpanda",
  DELIVERY_ROBINHOOD: "Robinhood",
  DELIVERY_SHOPEEFOOD: "ShopeeFood",
  ONLINE_ORDER: "สั่งออนไลน์เอง",
  OTHER: "อื่น ๆ",
};

export const FILE_ENCODING_LABELS_TH: Record<FileEncodingValue, string> = {
  UTF8: "UTF-8 (ทั่วไป)",
  TIS620: "TIS-620 (ไฟล์ไทยจาก Excel)",
};

// ------------------------------------------------------------
// 3. The column map
// ------------------------------------------------------------

/**
 * Which column holds what. Every field is a zero-based column index.
 *
 * This is DATA, not code — that is the whole point (ADR 0019 Q11). The previous
 * system hard-coded `csvRow[15]`, `csvRow[17]`, `csvRow[24]`, so a POS update
 * that inserted one column would have shifted every figure while they all still
 * looked plausible. A vendor "adapter" here is simply a seeded row.
 */
export const COLUMN_MAP_FIELDS = [
  "businessDate",
  "soldAt",
  "menuName",
  "menuCode",
  "categoryName",
  "qty",
  "grossAmount",
  "discountAmount",
  "netAmount",
  "serviceChargeAmount",
  "vatAmount",
  "channel",
  "billId",
] as const;
export type ColumnMapField = (typeof COLUMN_MAP_FIELDS)[number];

export const MAX_COLUMN_INDEX = 512;

const columnIndex = z
  .number({ invalid_type_error: "ตำแหน่งคอลัมน์ไม่ถูกต้อง" })
  .int("ตำแหน่งคอลัมน์ต้องเป็นจำนวนเต็ม")
  .min(0, "ตำแหน่งคอลัมน์ต้องไม่ติดลบ")
  .max(MAX_COLUMN_INDEX, "ตำแหน่งคอลัมน์เกินค่าที่ระบบรองรับ");

const columnMapSchema = z
  .object(
    Object.fromEntries(
      COLUMN_MAP_FIELDS.map((f) => [f, columnIndex.optional()])
    ) as Record<ColumnMapField, z.ZodOptional<typeof columnIndex>>
  )
  .strict();

export type ColumnMap = z.infer<typeof columnMapSchema>;

// ------------------------------------------------------------
// 4. Profile
// ------------------------------------------------------------

export const MAX_PROFILE_NAME_LENGTH = 100;

export const salesImportProfileInputSchema = z
  .object({
      posIntegrationId: z.string().uuid("เครื่อง POS ไม่ถูกต้อง"),
      name: z
        .string()
        .trim()
        .min(1, "ต้องระบุชื่อรูปแบบไฟล์")
        .max(MAX_PROFILE_NAME_LENGTH, "ชื่อต้องไม่เกิน 100 ตัวอักษร"),
      fileKind: z.enum(SALES_FILE_KIND_VALUES, {
        errorMap: () => ({ message: "ต้องระบุว่าไฟล์เป็นรายบิลหรือสรุปรายวัน" }),
      }),
      encoding: z.enum(FILE_ENCODING_VALUES, {
        errorMap: () => ({ message: "การเข้ารหัสไฟล์ไม่ถูกต้อง" }),
      }),
      dateFormat: z.enum(SALES_DATE_FORMATS, {
        errorMap: () => ({ message: "รูปแบบวันที่ไม่ถูกต้อง" }),
      }),
      isBuddhistYear: explicitBoolean("ต้องระบุว่าปีในไฟล์เป็น พ.ศ. หรือ ค.ศ."),
      headerSignature: z
        .string()
        .trim()
        .min(1, "ไม่พบลายเซ็นหัวตาราง"),
      columnMap: columnMapSchema,
      amountsIncludeVat: explicitBoolean("ต้องระบุว่าตัวเลขในไฟล์รวม VAT แล้วหรือยัง"),
      amountsIncludeServiceCharge: explicitBoolean(
        "ต้องระบุว่าตัวเลขในไฟล์รวม Service charge แล้วหรือยัง"
      ),
      defaultChannel: z.preprocess(
        blankToNull,
        z.enum(SALES_CHANNEL_VALUES).nullable()
      ),
    })
    .superRefine((v, ctx) => {
      const map = v.columnMap;

      // --- every row must carry its own date (rule P2) ---
      // A file summarised over a whole period cannot be split back into days, so
      // the graphs it produces would be wrong in a way nobody could see. Refused
      // at the profile, before any file is ever read.
      if (map.businessDate === undefined && map.soldAt === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["columnMap", "businessDate"],
          message: "ต้องมีคอลัมน์วันที่ หรือคอลัมน์วันเวลา — ไฟล์ที่รวบทั้งช่วงใช้ไม่ได้",
        });
      }

      // --- a sale must name its dish somehow (Q7) ---
      if (map.menuName === undefined && map.menuCode === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["columnMap", "menuName"],
          message: "ต้องมีคอลัมน์ชื่อเมนู หรือรหัสเมนู อย่างน้อยหนึ่งอย่าง",
        });
      }

      for (const required of ["qty", "netAmount"] as const) {
        if (map[required] === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["columnMap", required],
            message:
              required === "qty" ? "ต้องมีคอลัมน์จำนวน" : "ต้องมีคอลัมน์ยอดสุทธิ",
          });
        }
      }

      // --- a flag with nothing to subtract is a mis-set profile ---
      // Saying "these amounts include VAT" while mapping no VAT column leaves the
      // normaliser with nothing to remove, so revenue would silently stay 7% high
      // on every row — the failure this flag exists to prevent.
      if (v.amountsIncludeVat && map.vatAmount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["columnMap", "vatAmount"],
          message: "บอกว่าตัวเลขรวม VAT แล้ว แต่ไม่ได้ระบุคอลัมน์ VAT",
        });
      }
      if (v.amountsIncludeServiceCharge && map.serviceChargeAmount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["columnMap", "serviceChargeAmount"],
          message: "บอกว่าตัวเลขรวม Service charge แล้ว แต่ไม่ได้ระบุคอลัมน์ Service charge",
        });
      }

      // --- a daily summary has no bills and no times ---
      if (v.fileKind === "DAILY_SUMMARY") {
        if (map.billId !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["columnMap", "billId"],
            message: "ไฟล์สรุปรายวันไม่มีเลขบิล",
          });
        }
        if (map.soldAt !== undefined && map.businessDate === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["columnMap", "soldAt"],
            message: "ไฟล์สรุปรายวันไม่มีเวลาขาย — ใช้คอลัมน์วันที่แทน",
          });
        }
      }

      // --- two fields cannot read the same column ---
      // Almost always a slip while dragging the mapper, and it produces numbers
      // that are individually plausible: discount equal to VAT, say.
      const seen = new Map<number, ColumnMapField>();
      for (const field of COLUMN_MAP_FIELDS) {
        const idx = map[field];
        if (idx === undefined) continue;
        const clash = seen.get(idx);
        if (clash !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["columnMap", field],
            message: `คอลัมน์ที่ ${idx + 1} ถูกใช้ไปแล้วโดย "${clash}"`,
          });
        } else {
          seen.set(idx, field);
        }
      }
  });

export type SalesImportProfileInput = z.infer<typeof salesImportProfileInputSchema>;

// ------------------------------------------------------------
// 5. POS integration
// ------------------------------------------------------------

export const MAX_POS_NAME_LENGTH = 100;

export const posIntegrationInputSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  posType: z.enum(POS_TYPE_VALUES, {
    errorMap: () => ({ message: "ชนิด POS ไม่ถูกต้อง" }),
  }),
  name: z
    .string()
    .trim()
    .min(1, "ต้องระบุชื่อเครื่อง POS")
    .max(MAX_POS_NAME_LENGTH, "ชื่อต้องไม่เกิน 100 ตัวอักษร"),
});

export type PosIntegrationInput = z.infer<typeof posIntegrationInputSchema>;

// ------------------------------------------------------------
// 6. Upload / commit
// ------------------------------------------------------------

export const MAX_SALES_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_SALES_FILE_ROWS = 200_000;

export const uploadSalesFileInputSchema = z.object({
  /** The batch id IS the submit key (Part 13.5's pattern): a replayed submit
   *  collides on the primary key rather than importing the same file twice. */
  batchId: z.string().uuid("รหัสการนำเข้าไม่ถูกต้อง"),
  profileId: z.string().uuid("รูปแบบไฟล์ไม่ถูกต้อง"),
  fileName: z.string().trim().min(1, "ไม่พบชื่อไฟล์").max(255, "ชื่อไฟล์ยาวเกินไป"),
});

export type UploadSalesFileInput = z.infer<typeof uploadSalesFileInputSchema>;

/**
 * Commit what the preview showed.
 *
 * The two acknowledgements are not ceremony. Section D.4 forbids unannounced
 * auto-creation, and rule P3 makes a re-import destroy a day's current figures;
 * both are things the person clicking must have been shown. The counts are
 * echoed back so that a preview which has gone stale — someone else imported the
 * same days in another tab — is refused in L3 rather than committed blind.
 */
export const commitSalesImportInputSchema = z.object({
  batchId: z.string().uuid("รหัสการนำเข้าไม่ถูกต้อง"),
  acknowledgedReplacedDays: z
    .number({ invalid_type_error: "จำนวนวันที่จะถูกแทนที่ไม่ถูกต้อง" })
    .int()
    .min(0),
  acknowledgedNewMenus: z
    .number({ invalid_type_error: "จำนวนเมนูใหม่ไม่ถูกต้อง" })
    .int()
    .min(0),
  acknowledgedNewCategories: z
    .number({ invalid_type_error: "จำนวนหมวดใหม่ไม่ถูกต้อง" })
    .int()
    .min(0),
});

export type CommitSalesImportInput = z.infer<typeof commitSalesImportInputSchema>;

// ------------------------------------------------------------
// 7. Menu, category, alias
// ------------------------------------------------------------

export const MAX_MENU_NAME_LENGTH = 200;
export const MAX_MENU_CATEGORY_NAME_LENGTH = 100;

export const menuCategoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "ต้องระบุชื่อหมวด")
    .max(MAX_MENU_CATEGORY_NAME_LENGTH, "ชื่อหมวดต้องไม่เกิน 100 ตัวอักษร"),
  displayOrder: z.preprocess(
    blankToUndefined,
    z.coerce.number().int("ลำดับต้องเป็นจำนวนเต็ม").min(0).optional()
  ),
});

export const updateMenuInputSchema = z.object({
  menuId: z.string().uuid("เมนูไม่ถูกต้อง"),
  name: z
    .string()
    .trim()
    .min(1, "ต้องระบุชื่อเมนู")
    .max(MAX_MENU_NAME_LENGTH, "ชื่อเมนูต้องไม่เกิน 200 ตัวอักษร"),
  menuCategoryId: z.preprocess(blankToNull, z.string().uuid("หมวดไม่ถูกต้อง").nullable()),
  /** NULL is legal and visible (Q16): with departments on, unassigned revenue
   *  shows as its own row rather than being folded into Main. */
  primaryDepartmentId: z.preprocess(
    blankToNull,
    z.string().uuid("แผนกไม่ถูกต้อง").nullable()
  ),
});

/**
 * Point a spelling at a menu, and remember it (Q7).
 *
 * `menuId` is REQUIRED — there is no "best guess" path through this schema. The
 * system suggests with `pg_trgm`, a person decides, and only then does the pair
 * become an alias. Automatic merging on a similarity score is forbidden: Thai
 * menu names differ by one word for genuinely different dishes, so any threshold
 * that catches a typo also merges two real dishes, corrupting revenue now and
 * consuming the wrong ingredient in Sprint 5.
 */
export const resolveMenuAliasInputSchema = z.object({
  posIntegrationId: z.string().uuid("เครื่อง POS ไม่ถูกต้อง"),
  rawName: z.string().trim().min(1, "ไม่พบชื่อที่จะจับคู่").max(MAX_MENU_NAME_LENGTH),
  menuId: z.string().uuid("ต้องเลือกเมนูที่จะจับคู่ด้วย"),
});

// ------------------------------------------------------------
// 8. Read queries
// ------------------------------------------------------------

export const SALES_GROUP_BY_VALUES = ["DAY", "WEEK", "MONTH", "WEEKDAY"] as const;
export type SalesGroupBy = (typeof SALES_GROUP_BY_VALUES)[number];

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง")
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "วันที่ไม่ถูกต้อง");

export const getSalesQuerySchema = z
  .object({
    branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
    from: z.preprocess(blankToUndefined, dayString.optional()),
    to: z.preprocess(blankToUndefined, dayString.optional()),
    groupBy: z.preprocess(
      blankToUndefined,
      z.enum(SALES_GROUP_BY_VALUES).optional()
    ),
    menuCategoryId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
    /** Off by default: a superseded row is history, not sales. */
    includeSuperseded: z.preprocess(flagPreprocess, z.boolean()),
  })
  .refine((v) => !(v.from && v.to) || v.from <= v.to, {
    path: ["to"],
    message: "วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่มต้น",
  });

export const getMenusQuerySchema = z.object({
  posIntegrationId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  menuCategoryId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  /** The "รอตรวจ" queue — stubs a file created that nobody has identified yet. */
  stubsOnly: z.preprocess(flagPreprocess, z.boolean()),
  search: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
});
