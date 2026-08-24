// ============================================================
// Mise — consumption zod schemas unit tests (Sprint 5 Part 22 L2)
// ============================================================
// Pure zod, no DB. ADR 0022 decisions exercised here:
//   - the days are a LIST, not a range, because an import covers the days its
//     file happened to hold (Q2);
//   - the 90-day window is NOT a refusal — rule N9 makes an old day a coverage
//     reason, so the schema must let it through and let L3 report it. This is the
//     one place Part 22 deliberately breaks step with every other write schema in
//     the project, so it gets a test that says so;
//   - the FUTURE is refused, because a business date that has not happened is a
//     broken file rather than a gap;
//   - `acknowledgeRepost` is never defaulted true (Q2b) — it voids real ledger
//     rows, and rule R13's lesson is that the wrong default is the value people
//     click past;
//   - the two Prisma enums are covered exactly, so the drift guard is load-bearing.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  CANCELLED_SALE_POLICY_HINTS_TH,
  CANCELLED_SALE_POLICY_LABELS_TH,
  CANCELLED_SALE_POLICY_VALUES,
  CONSUMPTION_SKIP_REASON_HINTS_TH,
  CONSUMPTION_SKIP_REASON_LABELS_TH,
  CONSUMPTION_SKIP_REASON_VALUES,
  CONSUMPTION_VOID_REASON_LABELS_TH,
  CONSUMPTION_VOID_REASON_VALUES,
  MAX_DAYS_PER_POST,
  consumptionCoverageQuerySchema,
  postConsumptionInputSchema,
} from "@/lib/validations/consumption";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const BRANCH = "223e4567-e89b-12d3-a456-426614174000";

const today = () => computeBangkokToday();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const validPost = {
  submitKey: UUID,
  branchId: BRANCH,
  businessDates: [isoDay(addDays(today(), -1))],
};

/** The first error message for a dotted field path, or undefined. */
function errorFor(result: { success: boolean; error?: unknown }, path: string) {
  if (result.success) return undefined;
  const err = result.error as { issues: { path: (string | number)[]; message: string }[] };
  return err.issues.find((i) => i.path.join(".") === path)?.message;
}

describe("postConsumptionInputSchema", () => {
  it("C1: accepts one past day and defaults acknowledgeRepost to false", () => {
    const r = postConsumptionInputSchema.safeParse(validPost);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.businessDates).toHaveLength(1);
    // Never true by default: a re-post voids ledger rows that already exist.
    expect(r.data.acknowledgeRepost).toBe(false);
  });

  it("C2: today is a legal business day", () => {
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: [isoDay(today())],
    });
    expect(r.success).toBe(true);
  });

  it("C3: a future business date is refused — that is a broken file, not a gap", () => {
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: [isoDay(addDays(today(), 1))],
    });
    expect(r.success).toBe(false);
    expect(errorFor(r, "businessDates")).toContain("อนาคต");
  });

  it("C4 (rule N9): a day OLDER than the backdate window still parses", () => {
    // Every other write schema in the project refuses this. Part 22 must not:
    // a shop importing a year of history presses the button once and is TOLD
    // which days could not post. Refusing the batch for the sake of its oldest
    // day would make the report — the whole point of coverage — unreachable.
    const tooOld = addDays(today(), -(MAX_BACKDATE_DAYS + 30));
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: [isoDay(tooOld)],
    });
    expect(r.success).toBe(true);
  });

  it("C5: an empty day list is refused", () => {
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: [],
    });
    expect(r.success).toBe(false);
    expect(errorFor(r, "businessDates")).toContain("อย่างน้อย");
  });

  it("C6: more days than one press may cover is refused, naming the cap", () => {
    const many = Array.from({ length: MAX_DAYS_PER_POST + 1 }, (_, i) =>
      isoDay(addDays(today(), -(i + 1)))
    );
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: many,
    });
    expect(r.success).toBe(false);
    expect(errorFor(r, "businessDates")).toContain(String(MAX_DAYS_PER_POST));
  });

  it("C7: exactly the cap is allowed", () => {
    const many = Array.from({ length: MAX_DAYS_PER_POST }, (_, i) =>
      isoDay(addDays(today(), -(i + 1)))
    );
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: many,
    });
    expect(r.success).toBe(true);
  });

  it("C8: the same day twice in one submission is refused", () => {
    // The live-run partial unique would catch it at the database, but a duplicate
    // inside one payload is a caller bug, not a race — and the day would be
    // consumed twice before anything noticed.
    const d = isoDay(addDays(today(), -2));
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: [d, d],
    });
    expect(r.success).toBe(false);
    expect(errorFor(r, "businessDates")).toContain("ซ้ำ");
  });

  it("C9: two DIFFERENT days are fine", () => {
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: [isoDay(addDays(today(), -1)), isoDay(addDays(today(), -2))],
    });
    expect(r.success).toBe(true);
  });

  it("C10: a missing submit key is refused in Thai", () => {
    const { submitKey: _drop, ...rest } = validPost;
    const r = postConsumptionInputSchema.safeParse(rest);
    expect(r.success).toBe(false);
    expect(errorFor(r, "submitKey")).toBeTruthy();
  });

  it("C11: a branch that is not a uuid is refused on the branch field", () => {
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      branchId: "สาขาทองหล่อ",
    });
    expect(r.success).toBe(false);
    expect(errorFor(r, "branchId")).toContain("สาขา");
  });

  it("C12: an unparseable date is refused, not silently dropped", () => {
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: ["ไม่ใช่วันที่"],
    });
    expect(r.success).toBe(false);
  });

  it("C12b: a day carrying a TIME is refused rather than silently truncated", () => {
    // business_date is a DATE column. A timestamp would land as a different day
    // than the caller named, and nothing would report it.
    const r = postConsumptionInputSchema.safeParse({
      ...validPost,
      businessDates: ["2026-08-20T09:30:00.000Z"],
    });
    expect(r.success).toBe(false);
    expect(errorFor(r, "businessDates")).toContain("เวลา");
  });

  it("C13: the acknowledgement takes a checkbox's 'on', and only truthy strings", () => {
    const on = postConsumptionInputSchema.safeParse({
      ...validPost,
      acknowledgeRepost: "on",
    });
    expect(on.success && on.data.acknowledgeRepost).toBe(true);

    // z.coerce.boolean would read the non-empty string "false" as true, which is
    // how a link saying ?acknowledge=false ends up voiding a day.
    const off = postConsumptionInputSchema.safeParse({
      ...validPost,
      acknowledgeRepost: "false",
    });
    expect(off.success && off.data.acknowledgeRepost).toBe(false);
  });
});

describe("consumptionCoverageQuerySchema", () => {
  it("C14: an empty query is valid and hides voided runs by default", () => {
    const r = consumptionCoverageQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.branchId).toBeUndefined();
    expect(r.data.includeVoided).toBe(false);
  });

  it("C15: blank strings from a query string become undefined, not errors", () => {
    const r = consumptionCoverageQuerySchema.safeParse({
      branchId: "",
      from: "",
      to: "",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.from).toBeUndefined();
  });

  it("C16: includeVoided=false in a URL means false", () => {
    const r = consumptionCoverageQuerySchema.safeParse({
      includeVoided: "false",
    });
    expect(r.success && r.data.includeVoided).toBe(false);
  });

  it("C17: a bad branch id is refused rather than ignored", () => {
    const r = consumptionCoverageQuerySchema.safeParse({ branchId: "nope" });
    expect(r.success).toBe(false);
  });
});

describe("the vocabularies the screens render", () => {
  it("C18: every cancelled-sale policy has a label AND a consequence (rule N12)", () => {
    // N12's requirement is not that the option has a name — it is that the shop
    // is shown what choosing it does. A label with no hint is the failure mode.
    for (const v of CANCELLED_SALE_POLICY_VALUES) {
      expect(CANCELLED_SALE_POLICY_LABELS_TH[v]).toBeTruthy();
      expect(CANCELLED_SALE_POLICY_HINTS_TH[v]).toBeTruthy();
    }
    // And the consequence has to be concrete enough to picture.
    expect(CANCELLED_SALE_POLICY_HINTS_TH.TREAT_AS_COOKED).toContain("12");
    expect(CANCELLED_SALE_POLICY_HINTS_TH.TREAT_AS_NOT_COOKED).toContain("11");
  });

  it("C19: every skip reason names a next step, not just a diagnosis", () => {
    for (const v of CONSUMPTION_SKIP_REASON_VALUES) {
      expect(CONSUMPTION_SKIP_REASON_LABELS_TH[v]).toBeTruthy();
      expect(CONSUMPTION_SKIP_REASON_HINTS_TH[v]).toBeTruthy();
    }
  });

  it("C20: the set-menu skip reason exists at all — it is the silent one", () => {
    // Rule N2/R16: a component menu with no recipe explodes to LESS than it
    // should and nothing on screen looks wrong. If this value ever disappears,
    // the dish quietly posts a short quantity instead of being held back.
    expect(CONSUMPTION_SKIP_REASON_VALUES).toContain("COMPONENT_MENU_NO_RECIPE");
  });

  it("C21: every void reason is glossed", () => {
    for (const v of CONSUMPTION_VOID_REASON_VALUES) {
      expect(CONSUMPTION_VOID_REASON_LABELS_TH[v]).toBeTruthy();
    }
  });
});
