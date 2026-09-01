// ============================================================
// Mise — ของหายไปไหน (Part 32 L5, ADR 0032 Q6/Q7)
// ============================================================
// §H.8 as it actually exists. The comparison was built in Sprint 3 — every
// `stock_count_item` carries `qty_expected` beside `qty_counted` — and Part 22
// made the ledger balance BE the theoretical one. These pin the VIEW that was
// missing, and the refusal that comes with it.
//
// L4 is the rule that would be easiest to break by being helpful: there is no
// department column on this report, on purpose, because nobody recorded whose
// hands the missing stock left (rule F6).
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { getLeakReportLogic } from "@/server/leak-report";

describe("the leak report (ADR 0032 Q6/Q7)", () => {
  let tenantId: string;
  let userId: string;
  let branchId: string;

  let pork: ProductWithUnits;
  let lime: ProductWithUnits;

  const today = computeBangkokToday();
  const FROM = addDays(today, -20);
  const TO = addDays(today, -1);
  const COUNTED_ON = addDays(today, -5);
  /** Outside the window — L5 asserts it is not read. */
  const LONG_AGO = addDays(today, -90);

  const run = () => getLeakReportLogic(tenantId, { branchId, from: FROM, to: TO });

  const rowFor = (rows: Awaited<ReturnType<typeof run>>, p: ProductWithUnits) =>
    rows.find((r) => r.productId === p.id);

  const makeProduct = (tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantId,
      productInputSchema.parse({
        name: `LEAK-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

  /** A count, written straight in — Part 15 is proved by Part 15's own tests. */
  const count = async (
    countDate: Date,
    status: "CLOSED" | "DRAFT" | "VOIDED",
    lines: { product: ProductWithUnits; expected: number; counted: number }[]
  ) => {
    await withRlsBypass(async (tx) => {
      const sc = await tx.stockCount.create({
        data: {
          tenantId,
          branchId,
          scNumber: `SC-${randomUUID().slice(0, 8)}`,
          countDate,
          status,
          startedBy: userId,
          // Part 15 stamps both terminal states with a moment and a person,
          // and the CHECK constraints refuse a row that claims one without
          // them — which is the schema teaching the fixture, not a nuisance.
          ...(status === "CLOSED"
            ? { closedAt: new Date(), closedBy: userId }
            : {}),
          ...(status === "VOIDED"
            ? { voidedAt: new Date(), voidedBy: userId, voidReason: "test" }
            : {}),
        },
        select: { id: true },
      });
      let lineNo = 1;
      for (const l of lines) {
        await tx.stockCountItem.create({
          data: {
            tenantId,
            stockCountId: sc.id,
            productId: l.product.id,
            lineNo: lineNo++,
            qtyExpected: l.expected,
            qtyCounted: l.counted,
            countedAt: countDate,
            countedBy: userId,
          },
        });
      }
    });
  };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Leak Shop" } });
      tenantId = t.id;
      userId = (
        await tx.user.create({
          data: { email: `leak-${randomUUID().slice(0, 8)}@example.com` },
        })
      ).id;
      branchId = (
        await tx.branch.create({
          data: { tenantId, name: "ทองหล่อ", code: "LKA" },
        })
      ).id;
    });

    pork = await makeProduct("pork");
    lime = await makeProduct("lime");
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockCountItem.deleteMany({ where: { tenantId } });
      await tx.stockCount.deleteMany({ where: { tenantId } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId } } });
      await tx.product.deleteMany({ where: { tenantId } });
      await tx.branch.deleteMany({ where: { tenantId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
  });

  it("L1 — a closed count produces expected, counted and the shortfall", async () => {
    await count(COUNTED_ON, "CLOSED", [
      { product: pork, expected: 18, counted: 5 },
      { product: lime, expected: 12, counted: 11 },
    ]);

    const rows = await run();
    const p = rowFor(rows, pork);
    expect(p?.expectedQty.toString()).toBe("18");
    expect(p?.countedQty.toString()).toBe("5");
    expect(p?.varianceQty.toString()).toBe("-13");
    expect(p?.countLines).toBe(1);
  });

  it("L2 — several counts in the period accumulate, one line each", async () => {
    // Each count compared the shelf against the balance at that moment, so both
    // belong in the period's picture rather than only the latest.
    await count(addDays(today, -3), "CLOSED", [
      { product: pork, expected: 20, counted: 18 },
    ]);
    const p = rowFor(await run(), pork);
    expect(p?.countLines).toBe(2);
    expect(p?.varianceQty.toString()).toBe("-15"); // -13 and -2
  });

  it("L3 — a DRAFT or VOIDED count is not evidence and is not read", async () => {
    // A draft is a count somebody is still walking; a voided one was withdrawn.
    // Either would move a figure the owner is about to act on.
    const before = rowFor(await run(), lime)?.varianceQty.toString();
    await count(addDays(today, -4), "DRAFT", [
      { product: lime, expected: 999, counted: 0 },
    ]);
    await count(addDays(today, -4), "VOIDED", [
      { product: lime, expected: 999, counted: 0 },
    ]);
    expect(rowFor(await run(), lime)?.varianceQty.toString()).toBe(before);
  });

  it("L4 — there is no department column, and usage is a SHARE not an amount", async () => {
    // Rule F6 as a property of the returned shape. A `LeakRow` has nowhere to
    // put a per-department loss, so a future edit that wanted to apportion one
    // would have to change the type — which is the point at which somebody has
    // to read the rule.
    const p = rowFor(await run(), pork)!;
    expect(Object.keys(p)).not.toContain("departmentId");
    for (const u of p.usage) {
      expect(u.share).toBeGreaterThanOrEqual(0);
      expect(u.share).toBeLessThanOrEqual(1);
    }
  });

  it("L5 — a count outside the window is not read", async () => {
    await count(LONG_AGO, "CLOSED", [
      { product: lime, expected: 500, counted: 0 },
    ]);
    const l = rowFor(await run(), lime);
    // Still only the in-window count: 11 − 12.
    expect(l?.varianceQty.toString()).toBe("-1");
  });

  it("L6 — the biggest loss by MONEY sorts first", async () => {
    // With no purchases behind either product the ledger has no value to
    // report, so both are ฿0 and the tie-break by quantity decides — pork,
    // which is short by more, comes first. The ordering rule is what is under
    // test here, not the valuation.
    const rows = await run();
    expect(rows[0].productId).toBe(pork.id);
  });
});
