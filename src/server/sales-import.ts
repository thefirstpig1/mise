// ============================================================
// Mise — sales import: parse, preview, commit (Sprint 4 Part 19 L3a/L3c, ADR 0019)
// ============================================================
// Turns an uploaded file into staged rows, or into a list of reasons why it
// cannot be (L3a), then describes what committing it would do and does it (L3c).
// Deciding what a menu IS lives next door in src/server/menu.ts (L3b).
//
// Two rules shape every line of this file:
//
//   1. **A file is imported whole or not at all** (ADR 0019 Q14). Half a day of
//      sales is worse than none, because nothing on the screen looks wrong. So
//      a single unreadable cell fails the file, and the errors come back as a
//      list a shop can read rather than as the first exception thrown.
//   2. **Nothing is skipped in silence.** The previous system's
//      `if (csvRow.length < 17) continue;` meant a POS format change could empty
//      a file with no trace. Here a short row is an error, and even an entirely
//      blank row is counted and reported.
//
// The one thing that is NOT an error is a row whose numbers are zero or
// negative: a refund is negative and a giveaway is zero (Q14). That is exactly
// why `parseFileNumber` returns BLANK as its own answer — see src/lib/sales-file.ts.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, SalesImportBatch } from "@prisma/client";
import { voidConsumptionForDayInTx } from "@/server/consumption-post";
import { withTenantContext } from "@/lib/db";
import { reconcilePulsesLogic, type PulseReconciliation } from "@/server/sales-pulse";
import { isPulseMismatch, pulseMismatchThreshold } from "@/lib/validations/sales-pulse";
import {
  createStubMenusLogic,
  ensureMenuCategoriesLogic,
  menuLookupId,
  planMenuResolutionLogic,
  suggestForUnmatchedLogic,
  type MenuLookupKey,
  type MenuSuggestion,
  type UnmatchedMenu,
} from "@/server/menu";
import {
  computeHeaderSignature,
  decodeSalesFile,
  normaliseAmounts,
  normalizeMenuName,
  parseCsv,
  parseFileNumber,
  parseSalesDate,
  resolveSalesDay,
  type FileEncodingValue,
  type SalesDateFormat,
} from "@/lib/sales-file";
import {
  MAX_SALES_FILE_ROWS,
  SALES_CHANNEL_VALUES,
  type ColumnMap,
  type SalesChannelValue,
  type SalesFileKindValue,
} from "@/lib/validations/sales-import";

// ------------------------------------------------------------
// Inputs
// ------------------------------------------------------------

/** The parts of a `sales_import_profile` this step actually reads. */
export interface ParseProfile {
  fileKind: SalesFileKindValue;
  encoding: FileEncodingValue;
  dateFormat: SalesDateFormat;
  isBuddhistYear: boolean;
  headerSignature: string;
  columnMap: ColumnMap;
  amountsIncludeVat: boolean;
  amountsIncludeServiceCharge: boolean;
  defaultChannel: SalesChannelValue | null;
}

export interface ParseOptions {
  /** From `branch.sales_day_cutoff_minutes`. Only consulted when the file gives
   *  a time but no date — when it states a day, that statement wins (rule P14). */
  salesDayCutoffMinutes: number;
}

// ------------------------------------------------------------
// Outputs
// ------------------------------------------------------------

export interface StagedSalesRow {
  /** 1-based row number **in the file**, header included, so the message a shop
   *  reads matches what they see when they open it in Excel. */
  rowNumber: number;
  businessDate: Date;
  soldAt: Date | null;
  posMenuName: string | null;
  posMenuCode: string | null;
  /** Normalised name used for matching. Empty when the row identifies by code. */
  menuMatchKey: string;
  categoryName: string | null;
  qty: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  serviceChargeAmount: number;
  vatAmount: number;
  channel: SalesChannelValue | null;
  posBillId: string | null;
  /** |gross − discount − net| after normalisation. Surfaced in the preview. */
  consistencyDelta: number;
}

export interface SalesRowError {
  rowNumber: number;
  /** Which mapped field went wrong, for the preview to point at. */
  field: string | null;
  /** Thai, and specific enough to act on without asking anyone. */
  message: string;
}

export type ParseSalesFileResult =
  | {
      ok: true;
      rows: StagedSalesRow[];
      /** Blank rows that were skipped. Reported, never silent. */
      blankRowsSkipped: number;
      coveredFrom: Date;
      coveredTo: Date;
      /** Rows whose gross − discount − net does not tie out, worst first. */
      inconsistentRows: number;
      largestConsistencyDelta: number;
    }
  | { ok: false; errors: SalesRowError[] };

/** Enough to act on; more than this and the profile is simply wrong. */
export const MAX_REPORTED_ERRORS = 50;

/**
 * How much a row may miss by before it is worth mentioning. Real files round to
 * the satang; a VAT or service-charge flag set the wrong way misses by 7% or
 * 10%, which is orders of magnitude larger.
 */
export const CONSISTENCY_TOLERANCE = 0.05;

// ------------------------------------------------------------
// Channel
// ------------------------------------------------------------

/**
 * What a channel column can say, and what it means.
 *
 * Only proper nouns and the two obvious counter cases — deliberately small.
 * Anything else is an ERROR rather than a silent `OTHER`: a value we quietly
 * bucket is a value nobody ever tells us about, and the whole point of keeping
 * the channel is to know *which* platform ate the margin (Q12). A shop that does
 * not want the column can simply stop mapping it.
 */
const CHANNEL_ALIASES: Record<string, SalesChannelValue> = {
  grab: "DELIVERY_GRAB",
  grabfood: "DELIVERY_GRAB",
  lineman: "DELIVERY_LINEMAN",
  "line man": "DELIVERY_LINEMAN",
  foodpanda: "DELIVERY_FOODPANDA",
  panda: "DELIVERY_FOODPANDA",
  robinhood: "DELIVERY_ROBINHOOD",
  shopeefood: "DELIVERY_SHOPEEFOOD",
  shopee: "DELIVERY_SHOPEEFOOD",
  "dine in": "DINE_IN",
  "dine-in": "DINE_IN",
  ทานที่ร้าน: "DINE_IN",
  หน้าร้าน: "DINE_IN",
  takeaway: "TAKEAWAY",
  "take away": "TAKEAWAY",
  กลับบ้าน: "TAKEAWAY",
  ซื้อกลับบ้าน: "TAKEAWAY",
  delivery: "OTHER",
  other: "OTHER",
  อื่นๆ: "OTHER",
};

function resolveChannel(raw: string): SalesChannelValue | null {
  const key = normalizeMenuName(raw).toLowerCase();
  if (key === "") return null;
  const alias = CHANNEL_ALIASES[key];
  if (alias) return alias;
  const upper = key.toUpperCase().replace(/[\s-]+/g, "_");
  return (SALES_CHANNEL_VALUES as readonly string[]).includes(upper)
    ? (upper as SalesChannelValue)
    : null;
}

// ------------------------------------------------------------
// The parse
// ------------------------------------------------------------

export function parseSalesFileLogic(
  bytes: Uint8Array,
  profile: ParseProfile,
  opts: ParseOptions
): ParseSalesFileResult {
  const text = decodeSalesFile(bytes, profile.encoding);
  const table = parseCsv(text);

  if (table.length === 0 || (table.length === 1 && table[0].every((c) => c.trim() === ""))) {
    return { ok: false, errors: [{ rowNumber: 1, field: null, message: "ไฟล์ว่าง ไม่มีข้อมูล" }] };
  }

  // --- the header must be the one this profile was built against (Q11) ---
  const header = table[0];
  const signature = computeHeaderSignature(header);
  if (signature !== profile.headerSignature) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 1,
          field: null,
          message:
            `หัวตารางของไฟล์ไม่ตรงกับรูปแบบที่ตั้งไว้ (พบ ${header.length} คอลัมน์) — ` +
            "POS อาจเปลี่ยนรูปแบบรายงาน กรุณาตั้งค่ารูปแบบไฟล์ใหม่ก่อนนำเข้า",
        },
      ],
    };
  }

  const body = table.slice(1);
  if (body.length > MAX_SALES_FILE_ROWS) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 1,
          field: null,
          message: `ไฟล์มี ${body.length.toLocaleString("th-TH")} แถว เกินที่ระบบรองรับ (${MAX_SALES_FILE_ROWS.toLocaleString("th-TH")} แถว)`,
        },
      ],
    };
  }

  const map = profile.columnMap;
  const mappedIndexes = Object.values(map).filter((v): v is number => v !== undefined);
  const widestColumn = mappedIndexes.length === 0 ? 0 : Math.max(...mappedIndexes);

  const rows: StagedSalesRow[] = [];
  const errors: SalesRowError[] = [];
  let blankRowsSkipped = 0;

  const cell = (row: string[], idx: number | undefined): string | undefined =>
    idx === undefined ? undefined : row[idx];

  const pushError = (rowNumber: number, field: string | null, message: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push({ rowNumber, field, message });
  };

  /**
   * A number that the file was supposed to carry.
   *
   * An UNMAPPED column is a genuine zero: the report simply does not break that
   * figure out, and a shop with no service charge has none to report. A MAPPED
   * column that is blank is an error — that is the distinction the whole parser
   * exists to preserve.
   */
  const readMoney = (
    row: string[],
    idx: number | undefined,
    field: string,
    rowNumber: number
  ): number | null => {
    if (idx === undefined) return 0;
    const parsed = parseFileNumber(cell(row, idx));
    if (parsed.ok) return parsed.value;
    pushError(
      rowNumber,
      field,
      parsed.reason === "BLANK"
        ? `คอลัมน์ ${field} ในแถวนี้ว่าง — ระบบไม่เดาว่าเป็น 0 เพราะยอดขายเป็น 0 ได้จริง`
        : `คอลัมน์ ${field} ในแถวนี้ไม่ใช่ตัวเลข`
    );
    return null;
  };

  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    const rowNumber = i + 2; // +1 for the header, +1 because humans count from 1

    if (row.every((c) => c.trim() === "")) {
      blankRowsSkipped++;
      continue;
    }

    if (row.length <= widestColumn) {
      pushError(
        rowNumber,
        null,
        `แถวนี้มี ${row.length} คอลัมน์ แต่รูปแบบไฟล์ต้องการอย่างน้อย ${widestColumn + 1} คอลัมน์`
      );
      continue;
    }

    // --- the sales day (Q15) ---
    let businessDate: Date | null = null;
    let soldAt: Date | null = null;

    const rawSoldAt = cell(row, map.soldAt);
    let soldAtMinutes: number | null = null;
    let soldAtDay: Date | null = null;
    if (map.soldAt !== undefined) {
      const parsed = parseSalesDate(rawSoldAt, {
        format: profile.dateFormat,
        isBuddhistYear: profile.isBuddhistYear,
      });
      if (!parsed.ok) {
        pushError(rowNumber, "วันเวลาขาย", dateErrorMessage(parsed.reason));
      } else {
        soldAtDay = parsed.day;
        soldAtMinutes = parsed.minutesOfDay;
        soldAt =
          parsed.minutesOfDay === null
            ? parsed.day
            : new Date(parsed.day.getTime() + parsed.minutesOfDay * 60_000);
      }
    }

    if (map.businessDate !== undefined) {
      const parsed = parseSalesDate(cell(row, map.businessDate), {
        format: profile.dateFormat,
        isBuddhistYear: profile.isBuddhistYear,
      });
      if (!parsed.ok) {
        pushError(rowNumber, "วันที่", dateErrorMessage(parsed.reason));
      } else {
        // The POS stated the day. That statement wins, always (rule P14).
        businessDate = parsed.day;
      }
    } else if (soldAtDay !== null) {
      businessDate =
        soldAtMinutes === null
          ? soldAtDay
          : resolveSalesDay(soldAtDay, soldAtMinutes, opts.salesDayCutoffMinutes);
    }

    // --- the dish (Q7) ---
    const rawName = cell(row, map.menuName)?.trim() ?? "";
    const rawCode = cell(row, map.menuCode)?.trim() ?? "";
    if (rawName === "" && rawCode === "") {
      pushError(rowNumber, "เมนู", "แถวนี้ไม่มีทั้งชื่อเมนูและรหัสเมนู");
    }

    // --- quantity and money ---
    let qty: number | null = null;
    if (map.qty === undefined) {
      pushError(rowNumber, "จำนวน", "รูปแบบไฟล์ไม่ได้ระบุคอลัมน์จำนวน");
    } else {
      const parsed = parseFileNumber(cell(row, map.qty));
      if (parsed.ok) {
        qty = parsed.value;
      } else {
        pushError(
          rowNumber,
          "จำนวน",
          parsed.reason === "BLANK"
            ? "คอลัมน์จำนวนในแถวนี้ว่าง — ระบบไม่เดาว่าเป็น 0 เพราะของแถมมีจำนวนเป็น 0 ได้จริง"
            : "คอลัมน์จำนวนในแถวนี้ไม่ใช่ตัวเลข"
        );
      }
    }

    const net = readMoney(row, map.netAmount, "ยอดสุทธิ", rowNumber);
    const gross = readMoney(row, map.grossAmount, "ยอดก่อนหักส่วนลด", rowNumber);
    const discount = readMoney(row, map.discountAmount, "ส่วนลด", rowNumber);
    const serviceCharge = readMoney(row, map.serviceChargeAmount, "Service charge", rowNumber);
    const vat = readMoney(row, map.vatAmount, "VAT", rowNumber);

    // --- channel (Q12) ---
    let channel: SalesChannelValue | null = profile.defaultChannel;
    if (map.channel !== undefined) {
      const raw = cell(row, map.channel) ?? "";
      if (raw.trim() === "") {
        channel = profile.defaultChannel;
      } else {
        const resolved = resolveChannel(raw);
        if (resolved === null) {
          pushError(
            rowNumber,
            "ช่องทางขาย",
            `ไม่รู้จักช่องทางขาย "${raw.trim()}" — ถ้าไม่ต้องการแยกช่องทาง ให้เอาคอลัมน์นี้ออกจากรูปแบบไฟล์`
          );
        } else {
          channel = resolved;
        }
      }
    }

    if (
      businessDate === null ||
      qty === null ||
      net === null ||
      gross === null ||
      discount === null ||
      serviceCharge === null ||
      vat === null ||
      (rawName === "" && rawCode === "")
    ) {
      continue; // already reported above
    }

    const amounts = normaliseAmounts(
      { gross, discount, net, serviceCharge, vat },
      {
        amountsIncludeVat: profile.amountsIncludeVat,
        amountsIncludeServiceCharge: profile.amountsIncludeServiceCharge,
      }
    );

    rows.push({
      rowNumber,
      businessDate,
      soldAt,
      posMenuName: rawName === "" ? null : rawName,
      posMenuCode: rawCode === "" ? null : rawCode,
      menuMatchKey: rawName === "" ? "" : normalizeMenuName(rawName),
      categoryName: cell(row, map.categoryName)?.trim() || null,
      qty,
      grossAmount: amounts.gross,
      discountAmount: amounts.discount,
      netAmount: amounts.net,
      serviceChargeAmount: amounts.serviceCharge,
      vatAmount: amounts.vat,
      channel,
      posBillId: cell(row, map.billId)?.trim() || null,
      consistencyDelta: amounts.consistencyDelta,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  if (rows.length === 0) {
    return {
      ok: false,
      errors: [
        {
          rowNumber: 1,
          field: null,
          message:
            blankRowsSkipped > 0
              ? `ไฟล์มีแต่แถวว่าง (${blankRowsSkipped} แถว) ไม่มีรายการขาย`
              : "ไม่พบรายการขายในไฟล์",
        },
      ],
    };
  }

  let coveredFrom = rows[0].businessDate;
  let coveredTo = rows[0].businessDate;
  let inconsistentRows = 0;
  let largestConsistencyDelta = 0;
  for (const r of rows) {
    if (r.businessDate < coveredFrom) coveredFrom = r.businessDate;
    if (r.businessDate > coveredTo) coveredTo = r.businessDate;
    if (r.consistencyDelta > CONSISTENCY_TOLERANCE) {
      inconsistentRows++;
      if (r.consistencyDelta > largestConsistencyDelta) {
        largestConsistencyDelta = r.consistencyDelta;
      }
    }
  }

  return {
    ok: true,
    rows,
    blankRowsSkipped,
    coveredFrom,
    coveredTo,
    inconsistentRows,
    largestConsistencyDelta,
  };
}

function dateErrorMessage(reason: "BLANK" | "UNPARSEABLE" | "YEAR_LOOKS_BUDDHIST"): string {
  switch (reason) {
    case "BLANK":
      return "แถวนี้ไม่มีวันที่ — ทุกแถวต้องมีวันที่ของตัวเอง";
    case "YEAR_LOOKS_BUDDHIST":
      return "ปีในไฟล์ดูเหมือนเป็น พ.ศ. แต่รูปแบบไฟล์ตั้งไว้เป็น ค.ศ. — ระบบไม่แปลงให้เอง";
    default:
      return "อ่านวันที่ไม่ได้ ไม่ตรงกับรูปแบบวันที่ที่ตั้งไว้";
  }
}

/**
 * The distinct days a staged file covers, in order.
 *
 * L3c turns this into the list of `sales_day` rows to replace, and the preview
 * shows it before anything is written — rule P3 says a re-import destroys a
 * day's current figures, so nobody may meet that as a surprise.
 */
export function distinctSalesDays(rows: readonly StagedSalesRow[]): Date[] {
  const seen = new Map<number, Date>();
  for (const r of rows) seen.set(r.businessDate.getTime(), r.businessDate);
  return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
}

// ============================================================
// L3c — preview and commit (ADR 0019 Q5)
// ============================================================
// The unit of import is **branch × sales day**, and re-importing REPLACES a day
// rather than adding to it. `sales_day`'s UNIQUE(branch_id, business_date) is
// what makes that a database fact instead of a promise in application code.
//
// Replaced rows are marked superseded, never deleted: in Sprint 5 these rows
// drive CONSUMPTION into an append-only ledger, and a deleted sale would leave
// stock consumed with no document to point at.
//
// ⚠️ THE FILE IS SENT TWICE, ON PURPOSE. There is no object storage yet
// (pending Feature 5), so a preview cannot hold the bytes it parsed between two
// requests. Commit therefore re-reads the same file and re-derives everything,
// and the acknowledged counts from the preview are checked against what the
// second parse finds. Parsing is deterministic, so the counts only differ when
// the world moved underneath — somebody imported the same days in another tab —
// and that is exactly when a commit must be refused rather than allowed to
// destroy figures nobody was shown.
// ============================================================

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class SalesImportBatchNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Sales import batch "${id}" does not exist for this tenant`);
    this.name = "SalesImportBatchNotFoundError";
  }
}

export class SalesImportProfileNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Sales import profile "${id}" does not exist for this tenant`);
    this.name = "SalesImportProfileNotFoundError";
  }
}

export class SalesImportAlreadyCommittedError extends Error {
  constructor(public readonly id: string) {
    super(`Sales import batch "${id}" has already been committed`);
    this.name = "SalesImportAlreadyCommittedError";
  }
}

/**
 * The preview the user approved no longer describes what would happen.
 *
 * Not a technical nicety: rule P3 makes a commit destroy a day's current
 * figures, and Section D.4 forbids creating menus nobody was shown. Both
 * promises are only kept if what is committed is what was previewed.
 */
export class SalesImportPreviewStaleError extends Error {
  constructor(
    public readonly expected: { days: number; menus: number; categories: number },
    public readonly actual: { days: number; menus: number; categories: number }
  ) {
    super("Sales import preview is stale");
    this.name = "SalesImportPreviewStaleError";
  }
}

export class SalesImportFileRejectedError extends Error {
  constructor(public readonly errors: SalesRowError[]) {
    super(`Sales file rejected with ${errors.length} error(s)`);
    this.name = "SalesImportFileRejectedError";
  }
}

// ------------------------------------------------------------
// Preview
// ------------------------------------------------------------

export interface ReplacedDay {
  businessDate: Date;
  /** Rows that will be superseded. The size of what is being thrown away. */
  existingRows: number;
  existingNet: Prisma.Decimal;
  /** Which file currently owns the day, so the warning names it. */
  currentFileName: string | null;
  currentImportedAt: Date | null;
}

/** One retired dish a file still carries, with what it would bring in. */
export interface RetiredMenuSelling {
  menuId: string;
  name: string;
  qty: Prisma.Decimal;
  net: Prisma.Decimal;
}

export interface ImportPreview {
  batchId: string;
  fileName: string;
  branchId: string;
  posIntegrationId: string;
  coveredFrom: Date;
  coveredTo: Date;
  rowCount: number;
  blankRowsSkipped: number;
  inconsistentRows: number;
  largestConsistencyDelta: number;
  totalNet: Prisma.Decimal;
  totalQty: Prisma.Decimal;
  /** Days already holding figures, which this import will replace (rule P3). */
  replacedDays: ReplacedDay[];
  /** Days with nothing in them yet. */
  newDays: Date[];
  /** Dishes Mise has never seen — each becomes a stub unless pointed elsewhere. */
  newMenus: UnmatchedMenu[];
  /** lookupId → candidates, for the "did you mean…?" beside each new dish. */
  suggestions: Map<string, MenuSuggestion[]>;
  newCategories: string[];
  /**
   * Days whose recorded pulse disagrees with what this file totals (ADR 0020 Q3).
   *
   * Shown HERE and not after the commit, because this is the only moment somebody
   * is holding the file and can still do something about it — re-export it, widen
   * the date range, ask the cashier. It never blocks: if a mismatch blocked, the
   * fastest way past would be to delete the pulse, and then both the warning and
   * the evidence are gone.
   *
   * This is the one check that can see a file which covered only PART of a day.
   * Such a file is valid in every way Part 19 knows how to test — every row real,
   * header signature matching, no blank cells, every menu resolved — and nothing
   * inside it says it is incomplete.
   */
  pulseMismatches: PulseReconciliation[];
  /**
   * ADR 0027 Q3 — dishes in this file that the shop has marked เลิกขาย.
   *
   * Retiring a menu in Mise does not retire it in the POS, so a retired dish
   * that keeps selling is an ordinary mistake rather than a rare one — and it
   * is the reason `/menus` is allowed to hide retired rows by default at all.
   * Without this line, hiding them would be hiding a row that still takes
   * money, which ADR 0026 spent a whole Part refusing to do.
   *
   * Shown HERE, before the commit, and it WARNS — never blocks. The sale is
   * real: `sales_line` will be written and Part 22 will deduct stock from it,
   * exactly as ADR 0027 Q2 requires. The only thing wrong is the flag.
   */
  retiredMenusSelling: RetiredMenuSelling[];
}

/** What the acknowledgement counts on the commit payload have to match. */
export function previewCounts(preview: ImportPreview) {
  return {
    days: preview.replacedDays.length,
    menus: preview.newMenus.length,
    categories: preview.newCategories.length,
  };
}

interface LoadedProfile {
  profileId: string;
  branchId: string;
  posIntegrationId: string;
  parse: ParseProfile;
  salesDayCutoffMinutes: number;
}

async function loadProfileLogic(tx: Tx, tenantId: string, profileId: string): Promise<LoadedProfile> {
  const profile = await tx.salesImportProfile.findFirst({
    where: { id: profileId, tenantId, deletedAt: null },
    include: { posIntegration: { include: { branch: true } } },
  });
  if (!profile) throw new SalesImportProfileNotFoundError(profileId);

  return {
    profileId: profile.id,
    branchId: profile.posIntegration.branchId,
    posIntegrationId: profile.posIntegrationId,
    salesDayCutoffMinutes: profile.posIntegration.branch.salesDayCutoffMinutes,
    parse: {
      fileKind: profile.fileKind as ParseProfile["fileKind"],
      encoding: profile.encoding as ParseProfile["encoding"],
      dateFormat: profile.dateFormat as ParseProfile["dateFormat"],
      isBuddhistYear: profile.isBuddhistYear,
      headerSignature: profile.headerSignature,
      columnMap: profile.columnMap as ColumnMap,
      amountsIncludeVat: profile.amountsIncludeVat,
      amountsIncludeServiceCharge: profile.amountsIncludeServiceCharge,
      defaultChannel: profile.defaultChannel as SalesChannelValue | null,
    },
  };
}

function lookupKeysFor(rows: readonly StagedSalesRow[]): MenuLookupKey[] {
  return rows.map((r) => ({
    code: r.posMenuCode,
    rawName: r.posMenuName,
    matchKey: r.menuMatchKey,
  }));
}

/**
 * Read a file and describe, in full, what committing it would do.
 *
 * Nothing is written except the batch's own status and error log — the record of
 * an attempt, which is the one thing the previous system never kept.
 */
export async function previewSalesImportLogic(
  tenantId: string,
  userId: string,
  input: { batchId: string; profileId: string; fileName: string },
  bytes: Uint8Array
): Promise<ImportPreview> {
  // --- 1. read the profile, then parse. Parsing touches nothing. ---
  const profile = await withTenantContext(tenantId, (tx) =>
    loadProfileLogic(tx, tenantId, input.profileId)
  );
  const parsed = parseSalesFileLogic(bytes, profile.parse, {
    salesDayCutoffMinutes: profile.salesDayCutoffMinutes,
  });

  // --- 2. record the attempt, in a transaction of its OWN ---
  //
  // ⚠️ This cannot live in the same transaction as the throw below. A rejection
  // written inside a transaction that then throws is rolled back with it, so the
  // record of the failure would vanish at exactly the moment it is worth having —
  // and "why is Tuesday missing?" would be unanswerable again. (The same shape as
  // the Part 18 sweep script whose RAISE EXCEPTION undid its own DELETEs.)
  //
  // `id` is the submit key, so a double-tap collides on the primary key rather
  // than importing the file twice.
  await withTenantContext(tenantId, (tx) =>
    tx.salesImportBatch.upsert({
      where: { id: input.batchId },
      create: {
        id: input.batchId,
        tenantId,
        branchId: profile.branchId,
        posIntegrationId: profile.posIntegrationId,
        profileId: profile.profileId,
        fileName: input.fileName,
        status: parsed.ok ? "PREVIEW" : "FAILED",
        uploadedBy: userId,
        coveredFrom: parsed.ok ? parsed.coveredFrom : null,
        coveredTo: parsed.ok ? parsed.coveredTo : null,
        errorLog: parsed.ok ? Prisma.DbNull : (parsed.errors as unknown as Prisma.InputJsonValue),
      },
      update: {
        status: parsed.ok ? "PREVIEW" : "FAILED",
        fileName: input.fileName,
        coveredFrom: parsed.ok ? parsed.coveredFrom : null,
        coveredTo: parsed.ok ? parsed.coveredTo : null,
        errorLog: parsed.ok ? Prisma.DbNull : (parsed.errors as unknown as Prisma.InputJsonValue),
      },
    })
  );

  if (!parsed.ok) throw new SalesImportFileRejectedError(parsed.errors);

  // --- 3. describe what committing would do. Reads only. ---
  return withTenantContext(
    tenantId,
    async (tx) => {
      const plan = await planMenuResolutionLogic(
        tenantId,
        profile.posIntegrationId,
        lookupKeysFor(parsed.rows),
        tx
      );
      const suggestions = await suggestForUnmatchedLogic(tenantId, plan.unmatched, tx);

      const days = distinctSalesDays(parsed.rows);
      const existingDays = await tx.salesDay.findMany({
        where: { tenantId, branchId: profile.branchId, businessDate: { in: days } },
        include: { currentBatch: { select: { fileName: true, uploadedAt: true } } },
      });

      const replacedDays: ReplacedDay[] = [];
      for (const d of existingDays) {
        const live = await tx.salesLine.aggregate({
          where: { salesDayId: d.id, supersededAt: null },
          _count: { _all: true },
          _sum: { netAmount: true },
        });
        if (live._count._all === 0) continue;
        replacedDays.push({
          businessDate: d.businessDate,
          existingRows: live._count._all,
          existingNet: live._sum.netAmount ?? new Prisma.Decimal(0),
          currentFileName: d.currentBatch?.fileName ?? null,
          currentImportedAt: d.currentBatch?.uploadedAt ?? null,
        });
      }

      const replacedSet = new Set(replacedDays.map((d) => d.businessDate.getTime()));
      const newDays = days.filter((d) => !replacedSet.has(d.getTime()));

      const newCategories = await unseenCategoryNames(tx, tenantId, parsed.rows);

      // Compare against the pulses ALREADY recorded for these days, using what
      // this file would total per day — not what is currently stored, which is
      // exactly what is about to be replaced.
      const recorded = await reconcilePulsesLogic(tenantId, profile.branchId, days, tx);
      const fileCustomerPaidByDay = new Map<number, Prisma.Decimal>();
      for (const r of parsed.rows) {
        const k = r.businessDate.getTime();
        const paid = new Prisma.Decimal(r.netAmount)
          .plus(r.vatAmount)
          .plus(r.serviceChargeAmount);
        fileCustomerPaidByDay.set(k, (fileCustomerPaidByDay.get(k) ?? new Prisma.Decimal(0)).plus(paid));
      }
      const pulseMismatches = recorded
        .map((r) => {
          const detailAmount = fileCustomerPaidByDay.get(r.businessDate.getTime()) ?? new Prisma.Decimal(0);
          return {
            ...r,
            detailAmount,
            difference: detailAmount.minus(r.pulseAmount),
            threshold: new Prisma.Decimal(pulseMismatchThreshold(detailAmount.toNumber())),
            isMismatch: isPulseMismatch(r.pulseAmount.toNumber(), detailAmount.toNumber()),
          };
        })
        .filter((r) => r.isMismatch);

      // What the file would land on a dish nobody is supposed to be selling.
      // The match result already says which menu each row hit, so this costs
      // one lookup over menus that matched — never a scan.
      const perMenu = new Map<string, { qty: Prisma.Decimal; net: Prisma.Decimal }>();
      for (const r of parsed.rows) {
        const menuId = plan.matched.get(
          menuLookupId({ code: r.posMenuCode, matchKey: r.menuMatchKey })
        );
        if (menuId === undefined) continue;
        const acc = perMenu.get(menuId) ?? {
          qty: new Prisma.Decimal(0),
          net: new Prisma.Decimal(0),
        };
        perMenu.set(menuId, {
          qty: acc.qty.plus(r.qty),
          net: acc.net.plus(r.netAmount),
        });
      }
      const retiredMenusSelling: RetiredMenuSelling[] = [];
      if (perMenu.size > 0) {
        const retired = await tx.menu.findMany({
          where: {
            tenantId,
            id: { in: [...perMenu.keys()] },
            deletedAt: null,
            isActive: false,
          },
          select: { id: true, name: true },
        });
        for (const m of retired) {
          const totals = perMenu.get(m.id);
          if (totals === undefined) continue;
          retiredMenusSelling.push({ menuId: m.id, name: m.name, ...totals });
        }
        // Biggest first: the one worth acting on is the one earning most.
        retiredMenusSelling.sort((a, b) => b.net.comparedTo(a.net));
      }

      let totalNet = new Prisma.Decimal(0);
      let totalQty = new Prisma.Decimal(0);
      for (const r of parsed.rows) {
        totalNet = totalNet.plus(r.netAmount);
        totalQty = totalQty.plus(r.qty);
      }

      return {
        batchId: input.batchId,
        fileName: input.fileName,
        branchId: profile.branchId,
        posIntegrationId: profile.posIntegrationId,
        coveredFrom: parsed.coveredFrom,
        coveredTo: parsed.coveredTo,
        rowCount: parsed.rows.length,
        blankRowsSkipped: parsed.blankRowsSkipped,
        inconsistentRows: parsed.inconsistentRows,
        largestConsistencyDelta: parsed.largestConsistencyDelta,
        totalNet,
        totalQty,
        replacedDays,
        newDays,
        newMenus: plan.unmatched,
        suggestions,
        newCategories,
        pulseMismatches,
        retiredMenusSelling,
      };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}

/** Category names in the file that Mise does not have yet (by its name or the POS's). */
async function unseenCategoryNames(
  tx: Tx,
  tenantId: string,
  rows: readonly StagedSalesRow[]
): Promise<string[]> {
  const wanted = [
    ...new Set(
      rows
        .map((r) => (r.categoryName ? normalizeMenuName(r.categoryName) : ""))
        .filter((n) => n !== "")
    ),
  ];
  if (wanted.length === 0) return [];

  const existing = await tx.menuCategory.findMany({
    where: { tenantId, deletedAt: null },
    select: { name: true, posCategoryName: true },
  });
  const known = new Set<string>();
  for (const c of existing) {
    known.add(normalizeMenuName(c.name));
    if (c.posCategoryName) known.add(normalizeMenuName(c.posCategoryName));
  }
  return wanted.filter((n) => !known.has(n));
}

// ------------------------------------------------------------
// Commit
// ------------------------------------------------------------

export interface CommitSalesImportResult {
  batchId: string;
  rowsWritten: number;
  daysReplaced: number;
  daysAdded: number;
  stubMenusCreated: number;
  categoriesCreated: number;
  rowsSuperseded: number;
  /**
   * Days whose posted consumption this import took back (ADR 0022 Q5).
   *
   * Surfaced rather than done silently: the stock those days consumed has just
   * returned to the ledger, and the screen has to say so and offer to post the
   * new figures — a re-import that quietly un-cut a week of stock would be the
   * most expensive kind of invisible.
   */
  consumptionRunsVoided: number;
}

/**
 * Write the file.
 *
 * One transaction, so a shop never ends up with half a month imported. The
 * timeout is raised well past Prisma's default: a thirty-day file from a busy
 * branch is thousands of rows, each an insert into Neon in Singapore.
 */
export async function commitSalesImportLogic(
  tenantId: string,
  userId: string,
  input: {
    batchId: string;
    acknowledgedReplacedDays: number;
    acknowledgedNewMenus: number;
    acknowledgedNewCategories: number;
  },
  bytes: Uint8Array
): Promise<CommitSalesImportResult> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const batch = await tx.salesImportBatch.findFirst({
        where: { id: input.batchId, tenantId },
      });
      if (!batch) throw new SalesImportBatchNotFoundError(input.batchId);
      if (batch.status === "COMMITTED") {
        throw new SalesImportAlreadyCommittedError(input.batchId);
      }

      const profile = await loadProfileLogic(tx, tenantId, batch.profileId);
      const parsed = parseSalesFileLogic(bytes, profile.parse, {
        salesDayCutoffMinutes: profile.salesDayCutoffMinutes,
      });
      if (!parsed.ok) throw new SalesImportFileRejectedError(parsed.errors);

      const plan = await planMenuResolutionLogic(
        tenantId,
        profile.posIntegrationId,
        lookupKeysFor(parsed.rows),
        tx
      );

      const days = distinctSalesDays(parsed.rows);
      const existingDays = await tx.salesDay.findMany({
        where: { tenantId, branchId: profile.branchId, businessDate: { in: days } },
        select: { id: true, businessDate: true },
      });
      const dayIdByTime = new Map(existingDays.map((d) => [d.businessDate.getTime(), d.id]));

      let willReplace = 0;
      for (const d of existingDays) {
        const live = await tx.salesLine.count({
          where: { salesDayId: d.id, supersededAt: null },
        });
        if (live > 0) willReplace++;
      }

      const newCategories = await unseenCategoryNames(tx, tenantId, parsed.rows);

      // --- the preview must still describe reality (Section D.4, rule P3) ---
      const actual = {
        days: willReplace,
        menus: plan.unmatched.length,
        categories: newCategories.length,
      };
      const expected = {
        days: input.acknowledgedReplacedDays,
        menus: input.acknowledgedNewMenus,
        categories: input.acknowledgedNewCategories,
      };
      if (
        actual.days !== expected.days ||
        actual.menus !== expected.menus ||
        actual.categories !== expected.categories
      ) {
        throw new SalesImportPreviewStaleError(expected, actual);
      }

      // --- categories, then stubs ---
      const categoryIds = await ensureMenuCategoriesLogic(
        tx,
        tenantId,
        parsed.rows.map((r) => r.categoryName ?? "").filter((n) => n !== "")
      );

      const categoryForLookup = new Map<string, string | null>();
      for (const r of parsed.rows) {
        const id = menuLookupId({ code: r.posMenuCode, matchKey: r.menuMatchKey });
        if (categoryForLookup.has(id)) continue;
        const catName = r.categoryName ? normalizeMenuName(r.categoryName) : "";
        categoryForLookup.set(id, catName ? (categoryIds.get(catName) ?? null) : null);
      }

      const stubIds = await createStubMenusLogic(
        tx,
        tenantId,
        profile.posIntegrationId,
        plan.unmatched.map((u) => ({
          code: u.code,
          rawName: u.rawName,
          matchKey: u.matchKey,
          menuCategoryId: categoryForLookup.get(menuLookupId(u)) ?? null,
        }))
      );

      const menuIdFor = (r: StagedSalesRow): string => {
        const id = menuLookupId({ code: r.posMenuCode, matchKey: r.menuMatchKey });
        const resolved = plan.matched.get(id) ?? stubIds.get(id);
        if (!resolved) {
          // Unreachable: every row is either matched or was just given a stub.
          throw new Error(`Sales row ${r.rowNumber} resolved to no menu`);
        }
        return resolved;
      };

      // --- day by day: supersede, then write (rule P3) ---
      const now = new Date();
      let rowsSuperseded = 0;
      let consumptionRunsVoided = 0;
      let daysAdded = 0;
      const rowsByDay = new Map<number, StagedSalesRow[]>();
      for (const r of parsed.rows) {
        const t = r.businessDate.getTime();
        const arr = rowsByDay.get(t) ?? [];
        arr.push(r);
        rowsByDay.set(t, arr);
      }

      for (const day of days) {
        let salesDayId = dayIdByTime.get(day.getTime());
        if (!salesDayId) {
          const created = await tx.salesDay.create({
            data: {
              tenantId,
              branchId: profile.branchId,
              businessDate: day,
              currentBatchId: input.batchId,
            },
            select: { id: true },
          });
          salesDayId = created.id;
          daysAdded++;
        } else {
          const superseded = await tx.salesLine.updateMany({
            where: { salesDayId, supersededAt: null },
            data: { supersededAt: now, supersededByBatchId: input.batchId },
          });
          rowsSuperseded += superseded.count;
          await tx.salesDay.update({
            where: { id: salesDayId },
            data: { currentBatchId: input.batchId },
          });

          // Part 22 (ADR 0022 Q5, rule N6). Superseding the day's sales makes any
          // CONSUMPTION already posted from them refer to rows that no longer
          // stand: the ledger is wrong and the system knows it. Waiting for
          // someone to notice is not an option ADR 0019 Consequence 2 left open.
          //
          // Safe inside THIS transaction for the exact reason posting is not
          // (Q2): voiding never touches a recipe. It reads the movements already
          // written and appends their negation, so it cannot fail on a cycle or
          // a missing yield, and a recipe problem still cannot sink a good file.
          //
          // Re-POSTING stays the user's own step, so a day whose new file lands
          // at 3am is not silently re-cut against whatever the recipes say by
          // morning.
          const { voidedRunId } = await voidConsumptionForDayInTx(
            tx,
            tenantId,
            profile.branchId,
            day,
            "RE_IMPORT",
            userId
          );
          if (voidedRunId !== null) consumptionRunsVoided++;
        }

        const dayRows = rowsByDay.get(day.getTime()) ?? [];
        await tx.salesLine.createMany({
          data: dayRows.map((r) => ({
            tenantId,
            branchId: profile.branchId,
            businessDate: r.businessDate,
            salesDayId: salesDayId!,
            importBatchId: input.batchId,
            menuId: menuIdFor(r),
            posMenuName: r.posMenuName,
            posMenuCode: r.posMenuCode,
            qty: new Prisma.Decimal(r.qty),
            grossAmount: new Prisma.Decimal(r.grossAmount),
            discountAmount: new Prisma.Decimal(r.discountAmount),
            netAmount: new Prisma.Decimal(r.netAmount),
            serviceChargeAmount: new Prisma.Decimal(r.serviceChargeAmount),
            vatAmount: new Prisma.Decimal(r.vatAmount),
            channel: r.channel,
            posBillId: r.posBillId,
            soldAt: r.soldAt,
          })),
        });
      }

      await tx.salesImportBatch.update({
        where: { id: input.batchId },
        data: {
          status: "COMMITTED",
          committedAt: now,
          rowCount: parsed.rows.length,
          coveredFrom: parsed.coveredFrom,
          coveredTo: parsed.coveredTo,
          errorLog: Prisma.DbNull,
          uploadedBy: userId,
        },
      });

      // Last COMMITTED import, not last upload — a failed file is not a sync.
      await tx.posIntegration.update({
        where: { id: profile.posIntegrationId },
        data: { lastImportAt: now },
      });

      return {
        batchId: input.batchId,
        rowsWritten: parsed.rows.length,
        daysReplaced: willReplace,
        daysAdded,
        stubMenusCreated: stubIds.size,
        categoriesCreated: newCategories.length,
        rowsSuperseded,
        consumptionRunsVoided,
      };
    },
    { maxWait: 15_000, timeout: 120_000 }
  );
}

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

export async function getSalesImportBatchesLogic(
  tenantId: string,
  branchId?: string
): Promise<SalesImportBatch[]> {
  return withTenantContext(tenantId, async (tx) =>
    tx.salesImportBatch.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      orderBy: { uploadedAt: "desc" },
      take: 100,
    })
  );
}
