// ============================================================
// Mise — the money must survive the cut (Part 32 L1, ADR 0032 Q2)
// ============================================================
// Rule F2 says the department columns sum to the real COGS by definition. That
// is a claim about arithmetic, so it is tested as one: every case here asserts
// the parts add back to the whole, and F1 hammers it with values chosen to
// leave a remainder.
//
// The second thing under test is the refusal. Where the data cannot say whose
// cost it was, this function must say "ไม่ระบุแผนก" rather than pick — and
// must never lose the money on the way, which is the failure that would be
// invisible on screen because a smaller number still looks like a number.
// ============================================================

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  splitValueByDepartment,
  sumSharesByDepartment,
  type DepartmentShare,
} from "@/server/department-split";

const D = (n: string | number) => new Prisma.Decimal(n);
const KITCHEN = "dept-kitchen";
const BAR = "dept-bar";

const total = (shares: DepartmentShare[]) =>
  shares.reduce((t, s) => t.plus(s.value), D(0));

describe("splitValueByDepartment — rule F2 (ADR 0032)", () => {
  it("F1 — the parts always sum to the whole, remainder or not", () => {
    // ฿100 across three equal departments is 33.333… each: the case where a
    // naive round() loses or invents a satang. Largest-remainder cannot.
    const cases: { value: string; weights: string[] }[] = [
      { value: "100.00", weights: ["-1", "-1", "-1"] },
      { value: "3040.00", weights: ["-8", "-30"] },
      { value: "0.01", weights: ["-1", "-1"] },
      { value: "0.03", weights: ["-1", "-1", "-1", "-1", "-1", "-1", "-1"] },
      { value: "12345.67", weights: ["-7", "-11", "-13"] },
      { value: "999.99", weights: ["-1", "-999999"] },
    ];

    for (const c of cases) {
      const shares = splitValueByDepartment(
        D(c.value),
        c.weights.map((w, i) => ({ departmentId: `d${i}`, qty: D(w) })),
      );
      expect(total(shares).toFixed(2), JSON.stringify(c)).toBe(D(c.value).toFixed(2));
    }
  });

  it("F2 — the worked example from the ADR, to the satang", () => {
    // มะนาว: the ledger moved ฿3,040. ยำ demanded 8 kg (ครัว), โซดามะนาว
    // demanded 30 kg (บาร์). The ADR prints ฿640 / ฿2,400.
    const shares = splitValueByDepartment(D("3040.00"), [
      { departmentId: KITCHEN, qty: D("-8") },
      { departmentId: BAR, qty: D("-30") },
    ]);

    const by = sumSharesByDepartment(shares);
    expect(by.get(KITCHEN)?.toFixed(2)).toBe("640.00");
    expect(by.get(BAR)?.toFixed(2)).toBe("2400.00");
    expect(total(shares).toFixed(2)).toBe("3040.00");
  });

  it("F3 — only the RATIO of demand is read, never its size", () => {
    // This is what makes a recipe edited after posting unable to move money:
    // the recomputed quantities may all be wrong by a factor and the split is
    // unchanged, because the posted value is the thing being cut.
    const small = splitValueByDepartment(D("500.00"), [
      { departmentId: KITCHEN, qty: D("-1") },
      { departmentId: BAR, qty: D("-3") },
    ]);
    const large = splitValueByDepartment(D("500.00"), [
      { departmentId: KITCHEN, qty: D("-1000") },
      { departmentId: BAR, qty: D("-3000") },
    ]);
    expect(small).toEqual(large);
  });

  it("F4 — a menu with no department is a bucket, not a dropped row", () => {
    // Rule F8. Dropping it would shrink the denominator and quietly change the
    // percentages of a past period.
    const shares = splitValueByDepartment(D("300.00"), [
      { departmentId: KITCHEN, qty: D("-1") },
      { departmentId: null, qty: D("-2") },
    ]);
    const by = sumSharesByDepartment(shares);
    expect(by.get(KITCHEN)?.toFixed(2)).toBe("100.00");
    expect(by.get(null)?.toFixed(2)).toBe("200.00");
    expect(total(shares).toFixed(2)).toBe("300.00");
  });

  it("F5 — with no demand at all the money goes to ไม่ระบุ, never nowhere", () => {
    // Waste and manual adjustments arrive here (rule F7). The failure this
    // guards against is invisible on screen: a smaller number still looks like
    // a number, and nobody would know a column had eaten ฿750.
    const shares = splitValueByDepartment(D("750.00"), []);
    expect(shares).toHaveLength(1);
    expect(shares[0].departmentId).toBeNull();
    expect(shares[0].value.toFixed(2)).toBe("750.00");
  });

  it("F6 — demand that nets to zero is unattributable, and says so", () => {
    // One department's cancellations exactly cancelled another's sales. The
    // money moved and is real; whose it was is genuinely undefined. Using
    // magnitudes here would hand out a split on the strength of arithmetic
    // rather than evidence.
    const shares = splitValueByDepartment(D("120.00"), [
      { departmentId: KITCHEN, qty: D("-5") },
      { departmentId: BAR, qty: D("5") },
    ]);
    expect(shares).toHaveLength(1);
    expect(shares[0].departmentId).toBeNull();
    expect(shares[0].value.toFixed(2)).toBe("120.00");
  });

  it("F7 — a negative value keeps its sign and still sums exactly", () => {
    // A reversal, or a day whose cancellations outweighed its sales. Math.floor
    // on a negative rounds away from zero, so an implementation that forgot to
    // carry the sign separately would hand out more than there is.
    const shares = splitValueByDepartment(D("-100.00"), [
      { departmentId: KITCHEN, qty: D("-1") },
      { departmentId: BAR, qty: D("-2") },
    ]);
    expect(total(shares).toFixed(2)).toBe("-100.00");
    for (const s of shares) expect(s.value.isNegative()).toBe(true);
  });

  it("F8 — a department whose demand ran the other way takes a negative share", () => {
    // Not an error: on that day the kitchen genuinely put stock back while the
    // bar took more out. Forcing both positive would misreport both.
    const shares = splitValueByDepartment(D("100.00"), [
      { departmentId: KITCHEN, qty: D("2") },
      { departmentId: BAR, qty: D("-6") },
    ]);
    const by = sumSharesByDepartment(shares);
    expect(by.get(KITCHEN)?.isNegative()).toBe(true);
    expect(by.get(BAR)?.isNegative()).toBe(false);
    expect(total(shares).toFixed(2)).toBe("100.00");
  });

  it("F11 — demand that nearly cancels is refused, not divided into nonsense", () => {
    // 🔴 The review's finding 5. The zero guard above catches only the exact
    // case; +101 against −100 nets to 1, and cutting ฿1.00 by that ratio hands
    // ครัว ฿101.00 and บาร์ −฿100.00. The total is right and both rows are
    // gibberish — the failure the zero guard was written for, arriving through
    // the door it does not cover.
    const shares = splitValueByDepartment(D("1.00"), [
      { departmentId: KITCHEN, qty: D("101") },
      { departmentId: BAR, qty: D("-100") },
    ]);
    expect(shares).toHaveLength(1);
    expect(shares[0].departmentId).toBeNull();
    expect(shares[0].value.toFixed(2)).toBe("1.00");
  });

  it("F12 — weights that all run the same way can never trip that guard", () => {
    // The refusal must not be reachable from an ordinary day. With one sign the
    // net IS the gross, so the ratio is 100% however lopsided the split —
    // 999999 against 1 still divides.
    const shares = splitValueByDepartment(D("500.00"), [
      { departmentId: KITCHEN, qty: D("-999999") },
      { departmentId: BAR, qty: D("-1") },
    ]);
    expect(total(shares).toFixed(2)).toBe("500.00");
    expect(shares.every((s) => !s.value.isNegative())).toBe(true);
    expect(shares.find((s) => s.departmentId === KITCHEN)).toBeDefined();
  });

  it("F13 — a mixed-sign day that still divides sensibly is left alone", () => {
    // F8's case must survive: ครัว put stock back while บาร์ took more out.
    // Net 4 of gross 8 is 50% — well clear of the floor — so it is a real
    // answer about a real day and the guard has no business touching it. The
    // first version of the guard caught this case, which is how the structural
    // formulation was found to be wrong.
    const shares = splitValueByDepartment(D("100.00"), [
      { departmentId: KITCHEN, qty: D("2") },
      { departmentId: BAR, qty: D("-6") },
    ]);
    expect(shares.length).toBeGreaterThan(1);
    expect(total(shares).toFixed(2)).toBe("100.00");
  });

  it("F9 — nothing moved means no rows, not a row of zeroes per department", () => {
    // A department that had no part in a figure should not appear beside it.
    expect(splitValueByDepartment(D("0.00"), [
      { departmentId: KITCHEN, qty: D("-1") },
    ])).toEqual([]);
  });

  it("F10 — the leftover satang goes to the biggest share, and ไม่ระบุ never wins a tie", () => {
    // The tiebreak matters because it is the only thing that decides where an
    // odd satang lands, and it must not drift from prorateAllocations' rule.
    // ฿1.00 across two equal named departments: 50/50, no remainder to place.
    const even = sumSharesByDepartment(
      splitValueByDepartment(D("1.00"), [
        { departmentId: KITCHEN, qty: D("-1") },
        { departmentId: BAR, qty: D("-1") },
      ]),
    );
    expect(even.get(KITCHEN)?.toFixed(2)).toBe("0.50");
    expect(even.get(BAR)?.toFixed(2)).toBe("0.50");

    // ฿0.01 with equal demand between a named department and ไม่ระบุ: the
    // remainders tie, the demands tie, and the named one takes it.
    const odd = splitValueByDepartment(D("0.01"), [
      { departmentId: null, qty: D("-1") },
      { departmentId: KITCHEN, qty: D("-1") },
    ]);
    expect(odd).toHaveLength(1);
    expect(odd[0].departmentId).toBe(KITCHEN);
    expect(total(odd).toFixed(2)).toBe("0.01");
  });
});
