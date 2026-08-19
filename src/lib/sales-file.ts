// ============================================================
// Mise — sales file primitives (Sprint 4 Part 19 L2, ADR 0019)
// ============================================================
// Pure functions with no imports at all: decode the bytes, split the CSV, read a
// Thai date, read a number, normalise a menu name, fingerprint a header row, and
// strip VAT / service charge back out of the money.
//
// Every one of these exists because the previous system got it wrong in a way
// that left the screen green:
//   - it read TIS-620 correctly only because someone had already been burned;
//   - it hard-coded column indexes, so an inserted column would have shifted
//     every figure while they all still looked plausible;
//   - it used `parseFloat(x) || 0` on every column, so a blank cell, a header
//     typo and a genuine zero were the same value;
//   - it skipped short rows with `continue`, so a format change would have
//     emptied a file in silence.
//
// The single most important function here is `parseFileNumber`, and the single
// most important thing about it is that it distinguishes BLANK from ZERO.
// `sales_line` has no sign check and no `.positive()` (ADR 0019 Q14) — negative
// is a refund and zero is a giveaway — so nothing downstream can catch a blank
// that has already become a 0.
//
// No dependencies on purpose: this module is imported by both the parser and the
// profile-builder screen, so it must not drag `node:` anything into the bundle.
// ============================================================

// ------------------------------------------------------------
// 1. Bytes → text
// ------------------------------------------------------------

/** Mirrors the `FileEncoding` enum without importing Prisma into the browser. */
export const FILE_ENCODING_VALUES = ["UTF8", "TIS620"] as const;
export type FileEncodingValue = (typeof FILE_ENCODING_VALUES)[number];

const UTF8_BOM = "﻿";

/**
 * Decode an uploaded file.
 *
 * TIS-620 is not an edge case: the real Thai POS export read during the grill
 * was TIS-620, and Excel on a Thai Windows still writes it. Reading those bytes
 * as UTF-8 does not throw — it produces replacement characters, so every menu
 * name becomes a *different* unrecognised name and the import quietly creates a
 * full duplicate set of stub menus.
 *
 * The encoding comes from the profile, never from a guess (ADR 0019 Q11). Use
 * `looksLikeUtf8Bom` in the profile builder to offer a sensible default.
 */
export function decodeSalesFile(
  bytes: Uint8Array,
  encoding: FileEncodingValue
): string {
  // "tis-620" is a WHATWG label for the windows-874 table, which is what Thai
  // Excel actually writes; both resolve to the same decoder.
  const label = encoding === "TIS620" ? "tis-620" : "utf-8";
  const text = new TextDecoder(label).decode(bytes);
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

/** A UTF-8 BOM is the one encoding fact a file states about itself. */
export function looksLikeUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

// ------------------------------------------------------------
// 2. Text → rows
// ------------------------------------------------------------

/**
 * RFC 4180 CSV: double quotes, `""` escapes, embedded commas and newlines, and
 * both CRLF and LF line endings.
 *
 * Written rather than installed. A CSV parser is a known quantity and a new
 * dependency is a stop-and-ask under CLAUDE.md, so the trade is not close — and
 * a Thai menu name containing a comma inside quotes is exactly the row that a
 * naive `split(",")` would silently shift by one column.
 *
 * A trailing newline does not produce a final empty row; a blank line in the
 * middle of the file does, because that is a real row that failed to be written
 * and the caller must see it rather than have it disappear.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      sawAnyChar = true;
      continue;
    }
    if (ch === "\r") {
      // swallow; the \n that follows ends the row
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyChar = false;
      continue;
    }
    field += ch;
    sawAnyChar = true;
  }

  if (sawAnyChar || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ------------------------------------------------------------
// 3. Header fingerprint
// ------------------------------------------------------------

/**
 * A stable fingerprint of the header row (ADR 0019 Q11).
 *
 * A file whose header still matches its profile imports without asking anything.
 * A POS update that inserts, renames or reorders a column changes the signature,
 * and the import STOPS and asks — instead of reading one column across while
 * every figure still looks plausible, which is the previous system's failure
 * mode and the hardest kind to notice.
 *
 * FNV-1a rather than a cryptographic hash: this is a change detector, not a
 * security boundary, and keeping the module free of `node:crypto` keeps it
 * usable on both sides of the wire. The field count is folded into the seed so
 * two files can never collide merely by having the same text in a different
 * number of columns.
 */
export function computeHeaderSignature(cells: readonly string[]): string {
  const canonical = cells.map((c) => normalizeMenuName(c).toLowerCase()).join("");
  const withArity = `${cells.length}${canonical}`;

  // FNV-1a, 32 bits at a time, twice with different offsets → 64-bit hex.
  const fnv = (input: string, seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      h ^= input.charCodeAt(i) >>> 8;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };

  const a = fnv(withArity, 0x811c9dc5);
  const b = fnv(withArity, 0x9e3779b9);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

// ------------------------------------------------------------
// 4. Names
// ------------------------------------------------------------

/**
 * Strip zero-width characters, collapse inner whitespace, trim, Unicode NFC.
 *
 * This absorbs the stray-space case with **no guessing at all**, which matters
 * because the fuzzy suggestion behind it must never be asked to do work that
 * exact matching can do.
 *
 * The zero-width strip is the part that earns its keep. `\s` does NOT match
 * U+200B and friends, and they ride along invisibly in text that has been
 * through a web back office — so "ผัดกะเพรา" and "ผัด<ZWSP>กะเพรา" look
 * identical on every screen a human will ever check, compare unequal, and
 * quietly become two menus with the revenue split between them. A non-breaking
 * space is whitespace as far as the regex is concerned, so it needs no special
 * case.
 *
 * NFC is hygiene rather than a fix here: Thai has no canonical decomposition, so
 * it is a no-op on Thai text and only matters for the Latin names that sit
 * beside it.
 */
export function normalizeMenuName(raw: string): string {
  return raw
    .replace(/[​-‍﻿]/g, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------
// 5. Numbers — the blank/zero distinction
// ------------------------------------------------------------

export type NumberParseResult =
  | { ok: true; value: number }
  /** The cell was empty. NOT a zero — see the module header. */
  | { ok: false; reason: "BLANK" }
  /** There was text, and it was not a number. A different mistake from BLANK. */
  | { ok: false; reason: "UNPARSEABLE" };

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/** ๑๒๓ → 123. Some Thai POS reports render totals in Thai numerals. */
function toArabicDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const idx = THAI_DIGITS.indexOf(ch);
    out += idx === -1 ? ch : String(idx);
  }
  return out;
}

/**
 * Read one numeric cell from a file.
 *
 * Returns a RESULT, never a number with a fallback, because the whole point is
 * that `""` and `"0"` must not converge. `sales_line` allows both negative and
 * zero (ADR 0019 Q14), so there is no `.positive()` downstream to reject a
 * silently-coerced blank — a blank that becomes 0 erases a menu's sales for a
 * day and nothing on screen looks wrong.
 *
 * Accepts what Thai POS exports actually contain: thousands separators, a
 * leading currency symbol, accounting parentheses for negatives, a trailing
 * minus, Thai numerals, and surrounding whitespace.
 */
export function parseFileNumber(raw: unknown): NumberParseResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "BLANK" };
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false, reason: "UNPARSEABLE" };
  }
  if (typeof raw !== "string") return { ok: false, reason: "UNPARSEABLE" };

  let s = toArabicDigits(raw).replace(/ /g, " ").trim();
  if (s === "") return { ok: false, reason: "BLANK" };

  let negative = false;

  // Accounting style: (1,234.00) means -1234.00
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // Trailing minus: "1,234.00-"
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }

  s = s.replace(/^[฿$]\s*/, "").replace(/,/g, "").trim();
  if (s === "") return { ok: false, reason: "UNPARSEABLE" };

  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, reason: "UNPARSEABLE" };

  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, reason: "UNPARSEABLE" };

  return { ok: true, value: negative ? -n : n };
}

// ------------------------------------------------------------
// 6. Dates
// ------------------------------------------------------------

/**
 * The date layouts a profile may declare. A closed list on purpose: a free-form
 * format string would be another thing that can be *almost* right, and "almost
 * right" on a date silently files a day of sales under the wrong day.
 */
export const SALES_DATE_FORMATS = [
  "dd/MM/yyyy",
  "d/M/yyyy",
  "dd-MM-yyyy",
  "yyyy-MM-dd",
  "yyyy/MM/dd",
  "MM/dd/yyyy",
] as const;
export type SalesDateFormat = (typeof SALES_DATE_FORMATS)[number];

export type DateParseResult =
  | {
      ok: true;
      /** UTC-midnight day value, so it compares and writes like a `@db.Date`. */
      day: Date;
      /** Minutes past midnight when the cell carried a time; null when it did not. */
      minutesOfDay: number | null;
    }
  | { ok: false; reason: "BLANK" }
  | { ok: false; reason: "UNPARSEABLE" }
  /**
   * The year is impossible as a Gregorian year but sensible as a Buddhist one,
   * and the profile said the file is Gregorian. Refused rather than guessed:
   * the previous system corrected this silently with `if (year > 2100)`, which
   * works until a shop has one file of each kind and no way to tell which.
   */
  | { ok: false; reason: "YEAR_LOOKS_BUDDHIST" };

const BE_OFFSET = 543;
const DAY_MS = 86_400_000;

export function parseSalesDate(
  raw: unknown,
  opts: { format: SalesDateFormat; isBuddhistYear: boolean }
): DateParseResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "BLANK" };

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { ok: false, reason: "UNPARSEABLE" };
    return {
      ok: true,
      day: new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate())),
      minutesOfDay: null,
    };
  }

  if (typeof raw !== "string") return { ok: false, reason: "UNPARSEABLE" };
  const text = toArabicDigits(raw).trim();
  if (text === "") return { ok: false, reason: "BLANK" };

  // Split an optional time off the back: "31/12/2568 01:30" or "...T01:30:00".
  const m = text.match(/^(\S+)(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return { ok: false, reason: "UNPARSEABLE" };

  const datePart = m[1];
  const hasTime = m[2] !== undefined;
  const hour = hasTime ? Number(m[2]) : 0;
  const minute = hasTime ? Number(m[3]) : 0;
  if (hasTime && (hour > 23 || minute > 59)) return { ok: false, reason: "UNPARSEABLE" };

  const pieces = datePart.split(/[/-]/);
  if (pieces.length !== 3 || pieces.some((p) => !/^\d+$/.test(p))) {
    return { ok: false, reason: "UNPARSEABLE" };
  }

  let year: number;
  let month: number;
  let day: number;
  switch (opts.format) {
    case "yyyy-MM-dd":
    case "yyyy/MM/dd":
      [year, month, day] = pieces.map(Number);
      break;
    case "MM/dd/yyyy":
      [month, day, year] = pieces.map(Number);
      break;
    default:
      [day, month, year] = pieces.map(Number);
  }

  if (pieces.find((p) => p.length === 4) === undefined) {
    // A two-digit year is ambiguous by 100 years and by 543. Refuse it rather
    // than pick; the profile can declare a four-digit format instead.
    return { ok: false, reason: "UNPARSEABLE" };
  }

  if (opts.isBuddhistYear) {
    year -= BE_OFFSET;
  } else if (year > 2200) {
    return { ok: false, reason: "YEAR_LOOKS_BUDDHIST" };
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) {
    return { ok: false, reason: "UNPARSEABLE" };
  }

  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  // Rejects 31 February and friends, which Date.UTC would happily roll forward.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return { ok: false, reason: "UNPARSEABLE" };
  }

  return {
    ok: true,
    day: new Date(utc),
    minutesOfDay: hasTime ? hour * 60 + minute : null,
  };
}

// ------------------------------------------------------------
// 7. The sales day (ADR 0019 Q15)
// ------------------------------------------------------------

/**
 * Which SALES DAY a timestamp belongs to, given the branch's cut-off.
 *
 * Only ever called when the file carried a time but no date. When the file
 * states a day, that statement wins and Mise never recomputes it — the POS
 * settled it at shift close and every report the shop already argues over uses
 * it (rule P14). Being right by our own reckoning and different from the POS
 * screen means nobody believes any of our numbers.
 */
export function resolveSalesDay(
  day: Date,
  minutesOfDay: number,
  cutoffMinutes: number
): Date {
  return minutesOfDay < cutoffMinutes ? new Date(day.getTime() - DAY_MS) : day;
}

// ------------------------------------------------------------
// 8. Money (ADR 0019 Q10, rules P8 / P10)
// ------------------------------------------------------------

export interface RawAmounts {
  gross: number;
  discount: number;
  net: number;
  serviceCharge: number;
  vat: number;
}

export interface NormalisedAmounts extends RawAmounts {
  /**
   * |gross − discount − net| after normalisation, in baht.
   *
   * Not an error on its own — real files round. It is surfaced in the import
   * preview because a profile with the VAT or service-charge flag set the wrong
   * way produces a delta of exactly 7% or 10%, and that is the silent error this
   * whole design is organised against.
   */
  consistencyDelta: number;
}

/**
 * Strip VAT and service charge back out of the money, so `net` means the same
 * thing on every row of every file: **after discount, excluding VAT, excluding
 * service charge** — the revenue that gross profit is computed from.
 *
 * VAT is collected for the Revenue Department (and an unregistered shop charges
 * none at all). A service charge is paid out to staff as a labour expense
 * (Decision #39), so counting it as revenue would inflate gross profit with
 * money that has no cost of sales behind it, and the same baht would then
 * reappear as an expense.
 *
 * `gross` and `discount` are stored as the file gave them: VAT and service
 * charge are computed on the bill, not on the menu line, so they were never
 * inside those two.
 */
export function normaliseAmounts(
  raw: RawAmounts,
  opts: { amountsIncludeVat: boolean; amountsIncludeServiceCharge: boolean }
): NormalisedAmounts {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  let net = raw.net;
  if (opts.amountsIncludeServiceCharge) net -= raw.serviceCharge;
  if (opts.amountsIncludeVat) net -= raw.vat;
  net = round2(net);

  const gross = round2(raw.gross);
  const discount = round2(raw.discount);

  return {
    gross,
    discount,
    net,
    serviceCharge: round2(raw.serviceCharge),
    vat: round2(raw.vat),
    consistencyDelta: Math.abs(round2(gross - discount - net)),
  };
}
