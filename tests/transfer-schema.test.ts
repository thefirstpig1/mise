// ============================================================
// Mise — inter-branch transfer zod schemas unit tests (Sprint 3 Part 18 L2)
// ============================================================
// Pure zod, no DB. ADR 0018 decisions exercised: dispatch posts both legs so its
// date is a true INSTANT under the ledger's backdate window, not a document name
// (Q1) · receiving takes a real count, and 0 is an observation while NULL is the
// absence of one (Q2) · a driver confirmation must name somebody (Q3) · no cost
// ever crosses this boundary — the sender's FIFO money is frozen server-side
// (Q5) · a void demands a reason and reverses the whole document (Q6).
//
// What is deliberately NOT tested here, because it is not this layer's job:
// qtyReceived <= qtySent (the dispatched quantity is not in the receive payload
// and must not be trusted from it — L3 + the DB CHECK own that).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  MAX_LINES,
  MAX_TRANSFER_NOTE_LENGTH,
  QTY_MAX,
  TRANSFER_STATUS_VALUES,
  dispatchTransferInputSchema,
  getTransfersQuerySchema,
  receiveTransferInputSchema,
  voidTransferInputSchema,
} from "@/lib/validations/transfer";
import { COST_SOURCE_VALUES } from "@/lib/validations/stock-cost";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import {
  addDays,
  bangkokDayEndUtc,
  computeBangkokToday,
} from "@/lib/bangkok-date";

const A = "123e4567-e89b-12d3-a456-426614174000";
const B = "223e4567-e89b-12d3-a456-426614174000";
const PRODUCT = "323e4567-e89b-12d3-a456-426614174000";
const UNIT = "423e4567-e89b-12d3-a456-426614174000";
const UNIT2 = "523e4567-e89b-12d3-a456-426614174000";
const KEY = "623e4567-e89b-12d3-a456-426614174000";
const ITEM = "723e4567-e89b-12d3-a456-426614174000";
const ITEM2 = "823e4567-e89b-12d3-a456-426614174000";

const iso = (d: Date) => d.toISOString();
const noonToday = () => {
  const d = new Date(computeBangkokToday());
  d.setUTCHours(5, 0, 0, 0); // 12:00 Bangkok
  return d;
};

const line = (over: Record<string, unknown> = {}) => ({
  productId: PRODUCT,
  qtySent: 10,
  inputUnitId: UNIT,
  notes: null,
  ...over,
});

const validDispatch = {
  submitKey: KEY,
  fromBranchId: A,
  toBranchId: B,
  dispatchedAt: iso(noonToday()),
  dispatchedByName: null,
  driverName: null,
  driverConfirmed: false,
  notes: null,
  lines: [line()],
};

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? "" : (r.error?.issues[0]?.message ?? "");

describe("dispatchTransferInputSchema (ADR 0018 Q1/Q3)", () => {
  it("T1: accepts a dispatch, blanks collapsing to null", () => {
    const r = dispatchTransferInputSchema.parse({
      ...validDispatch,
      dispatchedByName: "   ",
      driverName: "",
      notes: "  ",
    });
    expect(r.dispatchedByName).toBeNull();
    expect(r.driverName).toBeNull();
    expect(r.notes).toBeNull();
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].qtySent).toBe(10);
  });

  it("T2: refuses a transfer to the same branch — the DB CHECK's rule, said in Thai on the right field", () => {
    const r = dispatchTransferInputSchema.safeParse({
      ...validDispatch,
      toBranchId: A,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "toBranchId");
      expect(issue?.message).toContain("ต้องไม่ใช่สาขาเดียวกับต้นทาง");
    }
  });

  it("T3: NO cost field survives the boundary — the sender's FIFO money is frozen server-side (Q5)", () => {
    const r = dispatchTransferInputSchema.parse({
      ...validDispatch,
      lines: [{ ...line(), costTotal: 99999, costSource: "FRONT_LAYER" }],
    });
    expect(r.lines[0]).not.toHaveProperty("costTotal");
    expect(r.lines[0]).not.toHaveProperty("costSource");
  });

  it("T4: qtySent is a positive magnitude — 0 and negatives are refused", () => {
    for (const qtySent of [0, -1]) {
      const r = dispatchTransferInputSchema.safeParse({
        ...validDispatch,
        lines: [line({ qtySent })],
      });
      expect(r.success).toBe(false);
      expect(firstMessage(r)).toContain("ต้องมากกว่า 0");
    }
  });

  it("T5: quantity keeps 3 dp and refuses a 4th (toFixed round-trip, Pitfall #30)", () => {
    expect(
      dispatchTransferInputSchema.parse({
        ...validDispatch,
        lines: [line({ qtySent: 2.125 })],
      }).lines[0].qtySent
    ).toBe(2.125);

    const r = dispatchTransferInputSchema.safeParse({
      ...validDispatch,
      lines: [line({ qtySent: 2.1255 })],
    });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain("ทศนิยมไม่เกิน 3");
  });

  it("T6: refuses a quantity past the Decimal(15,3) ceiling", () => {
    const r = dispatchTransferInputSchema.safeParse({
      ...validDispatch,
      lines: [line({ qtySent: QTY_MAX + 1 })],
    });
    expect(r.success).toBe(false);
  });

  it("T7: dispatchedAt obeys the LEDGER's window — future refused, 90 days back is the floor", () => {
    const tomorrow = bangkokDayEndUtc(addDays(computeBangkokToday(), 1));
    expect(
      dispatchTransferInputSchema.safeParse({
        ...validDispatch,
        dispatchedAt: iso(tomorrow),
      }).success
    ).toBe(false);

    const tooOld = addDays(computeBangkokToday(), -(MAX_BACKDATE_DAYS + 1));
    const r = dispatchTransferInputSchema.safeParse({
      ...validDispatch,
      dispatchedAt: iso(tooOld),
    });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain(String(MAX_BACKDATE_DAYS));

    // The edge itself is IN. A transfer keyed exactly 90 days back is legal, and
    // the boundary is a Bangkok day boundary, not a UTC one.
    const justInside = addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS);
    expect(
      dispatchTransferInputSchema.safeParse({
        ...validDispatch,
        dispatchedAt: iso(justInside),
      }).success
    ).toBe(true);
  });

  it("T8: an INSTANT survives — a same-day afternoon dispatch is not flattened to a date", () => {
    const afternoon = noonToday();
    const r = dispatchTransferInputSchema.parse({
      ...validDispatch,
      dispatchedAt: iso(afternoon),
    });
    // ADR 0014 Q9b: a date-only value costs at the END of its Bangkok day, which
    // would draw this dispatch from the wrong FIFO layer relative to a same-day
    // receipt. The time of day must therefore survive the parse.
    expect(r.dispatchedAt.getTime()).toBe(afternoon.getTime());
  });

  it("T9: a driver confirmation with nobody named is refused (Q3)", () => {
    const r = dispatchTransferInputSchema.safeParse({
      ...validDispatch,
      driverConfirmed: true,
      driverName: null,
    });
    expect(r.success).toBe(false);
    const issue = !r.success
      ? r.error.issues.find((i) => i.path[0] === "driverName")
      : undefined;
    expect(issue?.message).toContain("ต้องระบุชื่อคนขับ");

    expect(
      dispatchTransferInputSchema.safeParse({
        ...validDispatch,
        driverConfirmed: true,
        driverName: "สมชาย",
      }).success
    ).toBe(true);
  });

  it('T10: driverConfirmed reads "on"/"true" as true and the STRING "false" as false', () => {
    // z.coerce.boolean would read the non-empty string "false" as true, and a
    // form that posts it would silently claim the driver signed for the load.
    expect(
      dispatchTransferInputSchema.parse({
        ...validDispatch,
        driverConfirmed: "false",
      }).driverConfirmed
    ).toBe(false);
    expect(
      dispatchTransferInputSchema.parse({
        ...validDispatch,
        driverConfirmed: "on",
        driverName: "สมชาย",
      }).driverConfirmed
    ).toBe(true);
  });

  it("T11: the same product in the same unit twice is a duplicated row; a different unit is not", () => {
    const dup = dispatchTransferInputSchema.safeParse({
      ...validDispatch,
      lines: [line(), line({ qtySent: 3 })],
    });
    expect(dup.success).toBe(false);
    expect(firstMessage(dup)).toContain("ซ้ำ");

    expect(
      dispatchTransferInputSchema.safeParse({
        ...validDispatch,
        lines: [line(), line({ inputUnitId: UNIT2 })],
      }).success
    ).toBe(true);
  });

  it("T12: a transfer needs at least one line and no more than MAX_LINES", () => {
    expect(
      dispatchTransferInputSchema.safeParse({ ...validDispatch, lines: [] }).success
    ).toBe(false);

    const tooMany = Array.from({ length: MAX_LINES + 1 }, (_, i) =>
      line({ productId: PRODUCT, inputUnitId: `${i}`.padStart(8, "0") + "-e89b-12d3-a456-426614174000" })
    );
    expect(
      dispatchTransferInputSchema.safeParse({ ...validDispatch, lines: tooMany })
        .success
    ).toBe(false);
  });
});

describe("receiveTransferInputSchema (ADR 0018 Q2)", () => {
  const validReceive = {
    id: KEY,
    receivedByName: null,
    notes: null,
    lines: [{ itemId: ITEM, qtyReceived: 8 }],
  };

  it("T13: accepts a count at the far end", () => {
    const r = receiveTransferInputSchema.parse(validReceive);
    expect(r.lines[0].qtyReceived).toBe(8);
  });

  it("T14: 0 is a real observation — nothing arrived is not the same as nobody looked", () => {
    const r = receiveTransferInputSchema.parse({
      ...validReceive,
      lines: [{ itemId: ITEM, qtyReceived: 0 }],
    });
    expect(r.lines[0].qtyReceived).toBe(0);

    // The state this schema CANNOT express is the stored NULL: a form that
    // submits has counted by definition.
    //
    // This is the assertion that caught a real bug in the first draft.
    // `z.coerce.number()` reads null / undefined / "" as **0**, and here 0 is a
    // legal answer, so a blank box would have validated and written the entire
    // line off as lost in transit — with a driver's name attached to a loss that
    // never happened. Every other quantity in the system is accidentally saved
    // from this by a `.positive()` that rejects the coerced 0; this is the first
    // one where 0 is meaningful, so the blank has to be caught BEFORE coercion.
    for (const blank of [null, undefined, "", "   "]) {
      const r = receiveTransferInputSchema.safeParse({
        ...validReceive,
        lines: [{ itemId: ITEM, qtyReceived: blank }],
      });
      expect(r.success).toBe(false);
      expect(firstMessage(r)).toContain("ต้องระบุจำนวนที่รับ");
    }
  });

  it("T15: a negative arrival is refused — a shortfall is the gap, not a minus sign", () => {
    const r = receiveTransferInputSchema.safeParse({
      ...validReceive,
      lines: [{ itemId: ITEM, qtyReceived: -2 }],
    });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain("ไม่ติดลบ");
  });

  it("T16: the same line answered twice is refused", () => {
    const r = receiveTransferInputSchema.safeParse({
      ...validReceive,
      lines: [
        { itemId: ITEM, qtyReceived: 8 },
        { itemId: ITEM, qtyReceived: 2 },
      ],
    });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain("ซ้ำ");

    expect(
      receiveTransferInputSchema.safeParse({
        ...validReceive,
        lines: [
          { itemId: ITEM, qtyReceived: 8 },
          { itemId: ITEM2, qtyReceived: 2 },
        ],
      }).success
    ).toBe(true);
  });

  it("T17: there is no submitKey — the shortfall's source key is what makes receiving idempotent", () => {
    const r = receiveTransferInputSchema.parse({
      ...validReceive,
      submitKey: KEY,
    });
    expect(r).not.toHaveProperty("submitKey");
  });
});

describe("voidTransferInputSchema (ADR 0018 Q6)", () => {
  it("T18: a reason is required and is trimmed", () => {
    expect(
      voidTransferInputSchema.safeParse({ id: KEY, voidReason: "   " }).success
    ).toBe(false);
    expect(
      voidTransferInputSchema.safeParse({ id: KEY }).success
    ).toBe(false);
    expect(
      voidTransferInputSchema.parse({ id: KEY, voidReason: "  คีย์ผิดสาขา  " })
        .voidReason
    ).toBe("คีย์ผิดสาขา");
  });

  it("T19: a void takes no quantity — it reverses the WHOLE document, never part of it", () => {
    const r = voidTransferInputSchema.parse({
      id: KEY,
      voidReason: "คีย์ผิด",
      qtySent: 5,
      lines: [{ itemId: ITEM, qtySent: 5 }],
    });
    expect(r).not.toHaveProperty("qtySent");
    expect(r).not.toHaveProperty("lines");
  });

  it("T20: refuses a reason past the note ceiling", () => {
    expect(
      voidTransferInputSchema.safeParse({
        id: KEY,
        voidReason: "ก".repeat(MAX_TRANSFER_NOTE_LENGTH + 1),
      }).success
    ).toBe(false);
  });
});

describe("getTransfersQuerySchema", () => {
  it("T21: an empty query is valid and every flag defaults to false", () => {
    const r = getTransfersQuerySchema.parse({});
    expect(r.branchId).toBeUndefined();
    expect(r.direction).toBeUndefined();
    expect(r.includeReversalLines).toBe(false);
  });

  it("T22: direction narrows which END of the journey is being asked about", () => {
    expect(
      getTransfersQuerySchema.parse({ branchId: A, direction: "IN" }).direction
    ).toBe("IN");
    expect(
      getTransfersQuerySchema.safeParse({ branchId: A, direction: "SIDEWAYS" })
        .success
    ).toBe(false);
  });

  it("T23: blank strings from a form collapse to undefined rather than failing uuid", () => {
    const r = getTransfersQuerySchema.parse({
      branchId: "",
      productId: "   ",
      status: "",
      from: "",
    });
    expect(r.branchId).toBeUndefined();
    expect(r.productId).toBeUndefined();
    expect(r.status).toBeUndefined();
    expect(r.from).toBeUndefined();
  });
});

describe("the vocabularies this Part now stores twice", () => {
  it("T24: the status list matches the Prisma enum (compile-time guard, asserted at runtime too)", () => {
    expect([...TRANSFER_STATUS_VALUES].sort()).toEqual(
      ["RECEIVED", "SENT", "VOIDED"].sort()
    );
  });

  it("T25: COST_SOURCE_VALUES still matches what a transfer line can freeze (ADR 0018 Q5)", () => {
    // Part 18 turned this list into a DB enum. If someone adds a fifth cost
    // source in TypeScript without a migration, the transfer line cannot store
    // it — and the failure would otherwise appear months later as a constraint
    // violation on one unlucky dispatch.
    expect([...COST_SOURCE_VALUES].sort()).toEqual(
      ["DECLARED", "FRONT_LAYER", "LAST_KNOWN", "UNPRICED"].sort()
    );
  });
});
