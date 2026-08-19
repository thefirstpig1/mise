// ============================================================
// Mise — POS sales import zod schemas unit tests (Sprint 4 Part 19 L2)
// ============================================================
// Pure zod, no DB. ADR 0019 decisions exercised: every row must carry its own
// date (Q4/rule P2) · a sale must name its dish somehow (Q7) · a profile states
// whether the file's amounts already include VAT and service charge, with no
// default that could quietly be wrong (Q11/rule P10) · a daily summary has no
// bills · an alias is only ever created by a person choosing (Q7).
//
// What is deliberately NOT tested here, because it is not this layer's job:
// which days a file will replace (a `sales_day` question, L3c), whether the
// integration belongs to the tenant (a DB lookup, L3), and the numbers
// themselves — no sales figure ever crosses this boundary, they all come out of
// the file through src/lib/sales-file.ts.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  FileEncoding,
  MenuSource,
  PosType,
  SalesChannel,
  SalesFileKind,
  SalesImportBatchStatus,
} from "@prisma/client";
import {
  COLUMN_MAP_FIELDS,
  FILE_ENCODING_VALUES,
  MAX_PROFILE_NAME_LENGTH,
  MENU_SOURCE_VALUES,
  POS_TYPE_VALUES,
  SALES_CHANNEL_LABELS_TH,
  SALES_CHANNEL_VALUES,
  SALES_FILE_KIND_VALUES,
  SALES_IMPORT_BATCH_STATUS_VALUES,
  commitSalesImportInputSchema,
  getSalesQuerySchema,
  posIntegrationInputSchema,
  resolveMenuAliasInputSchema,
  salesImportProfileInputSchema,
  updateMenuInputSchema,
  uploadSalesFileInputSchema,
} from "@/lib/validations/sales-import";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

/**
 * A profile that passes. Each test spoils exactly one thing.
 *
 * Loosely typed on purpose: these tests feed the schema what a FORM posts —
 * strings, missing keys, extra keys — which is exactly the shape a compile-time
 * type would stop us from expressing.
 */
type ProfileDraft = Record<string, unknown> & { columnMap: Record<string, number> };

const validProfile = (): ProfileDraft => ({
  posIntegrationId: UUID,
  name: "FoodStory — สรุปรายวัน",
  fileKind: "DAILY_SUMMARY",
  encoding: "TIS620",
  dateFormat: "dd/MM/yyyy",
  isBuddhistYear: "true",
  headerSignature: "a1b2c3d4e5f60718",
  columnMap: { businessDate: 1, menuName: 6, qty: 11, netAmount: 17 },
  amountsIncludeVat: "false",
  amountsIncludeServiceCharge: "false",
  defaultChannel: "",
});

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? "" : (r.error?.issues[0]?.message ?? "");

describe("sales import schemas (Part 19 L2)", () => {
  // ------------------------------------------------------------
  // Enum vocabularies stay pinned to the database
  // ------------------------------------------------------------

  it("J1: every local enum list matches its Prisma enum exactly", () => {
    // The compile-time drift guards in the module catch this too, but only while
    // someone is running tsc. Part 13's enum drift stayed green for weeks.
    const pairs: [readonly string[], Record<string, string>][] = [
      [POS_TYPE_VALUES, PosType],
      [SALES_FILE_KIND_VALUES, SalesFileKind],
      [FILE_ENCODING_VALUES, FileEncoding],
      [SALES_CHANNEL_VALUES, SalesChannel],
      [MENU_SOURCE_VALUES, MenuSource],
      [SALES_IMPORT_BATCH_STATUS_VALUES, SalesImportBatchStatus],
    ];
    for (const [local, prisma] of pairs) {
      expect([...local].sort()).toEqual(Object.values(prisma).sort());
    }
  });

  it("J2: every sales channel has a Thai label, so no screen can print an enum name", () => {
    for (const c of SALES_CHANNEL_VALUES) {
      expect(SALES_CHANNEL_LABELS_TH[c]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  // ------------------------------------------------------------
  // The profile — every row must carry its own date
  // ------------------------------------------------------------

  it("J3: a well-formed profile is accepted", () => {
    const r = salesImportProfileInputSchema.safeParse(validProfile());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.isBuddhistYear).toBe(true);
      expect(r.data.amountsIncludeVat).toBe(false);
      expect(r.data.defaultChannel).toBeNull();
    }
  });

  it("J4: a profile with NO date column at all is refused (rule P2)", () => {
    // This is the file that summarises a whole period into one row per menu. It
    // cannot be split back into days, so every graph built on it would be wrong
    // in a way nobody could see — refused before a file is ever read.
    const p = validProfile();
    p.columnMap = { menuName: 6, qty: 11, netAmount: 17 };
    const r = salesImportProfileInputSchema.safeParse(p);
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain("ไฟล์ที่รวบทั้งช่วงใช้ไม่ได้");
  });

  it("J5: a time column alone satisfies the date requirement for a bill file", () => {
    const p = validProfile();
    p.fileKind = "BILL_DETAIL";
    p.columnMap = { soldAt: 2, menuName: 6, qty: 11, netAmount: 17 };
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(true);
  });

  it("J6: a sale must name its dish by name or by code", () => {
    const p = validProfile();
    p.columnMap = { businessDate: 1, qty: 11, netAmount: 17 };
    expect(firstMessage(salesImportProfileInputSchema.safeParse(p))).toContain("ชื่อเมนู");
  });

  it("J7: a code alone is enough — identity is the code, not the name (Q7)", () => {
    const p = validProfile();
    p.columnMap = {
      businessDate: 1,
      menuCode: 5,
      qty: 11,
      netAmount: 17,
    };
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(true);
  });

  it("J8: quantity and net amount are both required", () => {
    for (const drop of ["qty", "netAmount"] as const) {
      const p = validProfile();
      const map: Record<string, number> = { businessDate: 1, menuName: 6, qty: 11, netAmount: 17 };
      delete map[drop];
      p.columnMap = map;
      expect(salesImportProfileInputSchema.safeParse(p).success).toBe(false);
    }
  });

  // ------------------------------------------------------------
  // The VAT / service-charge flags
  // ------------------------------------------------------------

  it("J9: an UNANSWERED VAT question is refused — it must not look like 'no'", () => {
    // HTML omits unchecked boxes entirely. If a missing value defaulted to false,
    // a profile built for a VAT-inclusive report would leave revenue 7% high on
    // every row it ever reads, and nothing would look wrong.
    const p = validProfile();
    delete p.amountsIncludeVat;
    const r = salesImportProfileInputSchema.safeParse(p);
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain("รวม VAT");
  });

  it("J10: the same applies to service charge, and to the Buddhist-year question", () => {
    for (const field of ["amountsIncludeServiceCharge", "isBuddhistYear"]) {
      const p = validProfile();
      delete p[field];
      expect(salesImportProfileInputSchema.safeParse(p).success).toBe(false);
    }
  });

  it("J11: a stray checkbox value is not quietly read as true", () => {
    const p = validProfile();
    p.amountsIncludeVat = "on";
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(false);
  });

  it("J12: claiming amounts include VAT while mapping no VAT column is refused", () => {
    // The normaliser would have nothing to subtract, so the flag would be a lie
    // that produced no error anywhere.
    const p = validProfile();
    p.amountsIncludeVat = "true";
    const r = salesImportProfileInputSchema.safeParse(p);
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain("ไม่ได้ระบุคอลัมน์ VAT");
  });

  it("J13: with the VAT column mapped, the same profile is accepted", () => {
    const p = validProfile();
    p.amountsIncludeVat = "true";
    p.columnMap = { ...p.columnMap, vatAmount: 24 };
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(true);
  });

  it("J14: the service-charge flag has the same rule", () => {
    const p = validProfile();
    p.amountsIncludeServiceCharge = "true";
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(false);
    p.columnMap = { ...p.columnMap, serviceChargeAmount: 19 };
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(true);
  });

  // ------------------------------------------------------------
  // Shape-of-file consistency
  // ------------------------------------------------------------

  it("J15: a daily summary cannot claim to have bill numbers", () => {
    const p = validProfile();
    p.columnMap = { ...p.columnMap, billId: 3 };
    expect(firstMessage(salesImportProfileInputSchema.safeParse(p))).toContain("ไม่มีเลขบิล");
  });

  it("J16: a bill file may of course have them", () => {
    const p = validProfile();
    p.fileKind = "BILL_DETAIL";
    p.columnMap = { ...p.columnMap, billId: 3, soldAt: 2 };
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(true);
  });

  it("J17: two fields cannot read the same column", () => {
    // Almost always a slip while dragging the mapper, and it produces figures
    // that are individually plausible — discount equal to VAT, say.
    const p = validProfile();
    p.columnMap = { businessDate: 1, menuName: 6, qty: 11, netAmount: 11 };
    const r = salesImportProfileInputSchema.safeParse(p);
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain("ถูกใช้ไปแล้ว");
  });

  it("J18: an unknown column-map key is rejected rather than ignored", () => {
    const p = validProfile();
    p.columnMap = { ...p.columnMap, tableNo: 4 };
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(false);
  });

  it("J19: the column-map vocabulary covers everything a sales_line can hold", () => {
    for (const f of ["businessDate", "menuName", "qty", "netAmount", "vatAmount", "channel"]) {
      expect(COLUMN_MAP_FIELDS).toContain(f);
    }
  });

  it("J20: a made-up date format is refused — the list is closed on purpose", () => {
    const p = validProfile();
    p.dateFormat = "dd.MM.yy";
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(false);
  });

  it("J21: an over-long profile name is refused", () => {
    const p = validProfile();
    p.name = "ก".repeat(MAX_PROFILE_NAME_LENGTH + 1);
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(false);
  });

  it("J22: a blank header signature is refused — it would match every file", () => {
    const p = validProfile();
    p.headerSignature = "   ";
    expect(salesImportProfileInputSchema.safeParse(p).success).toBe(false);
  });

  // ------------------------------------------------------------
  // POS integration
  // ------------------------------------------------------------

  it("J23: a POS is a branch, a type and a name — and carries no credentials", () => {
    const r = posIntegrationInputSchema.safeParse({
      branchId: UUID,
      posType: "FOODSTORY",
      name: "เครื่องหน้าร้าน",
    });
    expect(r.success).toBe(true);
    // Nothing resembling a secret exists on this boundary (Q2).
    expect(Object.keys(r.success ? r.data : {})).toEqual(["branchId", "posType", "name"]);
  });

  // ------------------------------------------------------------
  // Upload and commit
  // ------------------------------------------------------------

  it("J24: an upload carries its own batch id, which is the submit key", () => {
    const r = uploadSalesFileInputSchema.safeParse({
      batchId: UUID,
      profileId: UUID2,
      fileName: "sales-2025-12.csv",
    });
    expect(r.success).toBe(true);
  });

  it("J25: committing echoes back what the preview showed", () => {
    // Section D.4 forbids unannounced auto-creation and rule P3 makes a
    // re-import destroy a day's current figures. Both were shown; the counts come
    // back so L3 can refuse a preview that has since gone stale.
    const r = commitSalesImportInputSchema.safeParse({
      batchId: UUID,
      acknowledgedReplacedDays: 6,
      acknowledgedNewMenus: 4,
      acknowledgedNewCategories: 1,
    });
    expect(r.success).toBe(true);
    const missing = commitSalesImportInputSchema.safeParse({ batchId: UUID });
    expect(missing.success).toBe(false);
  });

  it("J26: acknowledged counts cannot be negative", () => {
    expect(
      commitSalesImportInputSchema.safeParse({
        batchId: UUID,
        acknowledgedReplacedDays: -1,
        acknowledgedNewMenus: 0,
        acknowledgedNewCategories: 0,
      }).success
    ).toBe(false);
  });

  // ------------------------------------------------------------
  // Menus and aliases
  // ------------------------------------------------------------

  it("J27: an alias REQUIRES the menu a person chose — there is no best-guess path", () => {
    // Automatic merging on a similarity score is forbidden: Thai menu names
    // differ by one word for genuinely different dishes, so any threshold that
    // catches a typo also merges two real ones.
    const withoutChoice = resolveMenuAliasInputSchema.safeParse({
      posIntegrationId: UUID,
      rawName: "ผัดกะเพรา หมู",
    });
    expect(withoutChoice.success).toBe(false);

    const withChoice = resolveMenuAliasInputSchema.safeParse({
      posIntegrationId: UUID,
      rawName: "ผัดกะเพรา หมู",
      menuId: UUID2,
    });
    expect(withChoice.success).toBe(true);
  });

  it("J28: a menu may have no category and no department, and that is not an error", () => {
    // NULL is legal and visible (Q16): with departments on, unassigned revenue
    // shows as its own row rather than being folded into Main.
    const r = updateMenuInputSchema.safeParse({
      menuId: UUID,
      name: "ผัดกะเพราหมู",
      menuCategoryId: "",
      primaryDepartmentId: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.menuCategoryId).toBeNull();
      expect(r.data.primaryDepartmentId).toBeNull();
    }
  });

  it("J29: a menu must still have a name", () => {
    expect(
      updateMenuInputSchema.safeParse({
        menuId: UUID,
        name: "   ",
        menuCategoryId: "",
        primaryDepartmentId: "",
      }).success
    ).toBe(false);
  });

  // ------------------------------------------------------------
  // Read query
  // ------------------------------------------------------------

  it("J30: a date range must not run backwards", () => {
    const r = getSalesQuerySchema.safeParse({
      from: "2025-12-31",
      to: "2025-12-01",
      includeSuperseded: "false",
    });
    expect(r.success).toBe(false);
  });

  it("J31: includeSuperseded=false means false — superseded rows are history, not sales", () => {
    // `z.coerce.boolean` reads the non-empty string "false" as true, which would
    // make a link showing history do the opposite of what it says.
    const off = getSalesQuerySchema.safeParse({ includeSuperseded: "false" });
    expect(off.success && off.data.includeSuperseded).toBe(false);
    const on = getSalesQuerySchema.safeParse({ includeSuperseded: "true" });
    expect(on.success && on.data.includeSuperseded).toBe(true);
    const absent = getSalesQuerySchema.safeParse({});
    expect(absent.success && absent.data.includeSuperseded).toBe(false);
  });

  it("J32: a day string becomes a UTC-midnight day value, like every other date in Mise", () => {
    const r = getSalesQuerySchema.safeParse({ from: "2025-12-31", includeSuperseded: "false" });
    expect(r.success && r.data.from?.toISOString()).toBe("2025-12-31T00:00:00.000Z");
  });
});
