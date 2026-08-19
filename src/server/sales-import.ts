// ============================================================
// Mise — sales import: parse and stage (Sprint 4 Part 19 L3a, ADR 0019)
// ============================================================
// Turns an uploaded file into staged rows, or into a list of reasons why it
// cannot be. Nothing here touches the database and nothing here decides what a
// menu is — that is L3b — or which days get replaced — that is L3c.
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
