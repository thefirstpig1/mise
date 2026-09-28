// ============================================================
// Mise — stock count *Logic integration tests (Sprint 3 Part 15 L3)
// ============================================================
// Exercises the open → count → close → void lifecycle against real Neon, through
// the real zod schemas. The invariants under test are the ones the Part exists
// to protect:
//   Q1 — closing posts through the ledger, with the count LINE as the source
//   Q3 — qty_expected is snapshotted per line, and a later delivery cannot move it
//   Q6 — a closed count is voided by compensating rows, never edited
//   Q7 — a counted 0 is a real observation; an uncounted product is untouched
//   Q8 — the variance occurs at the line's countedAt, and one branch has one sheet
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { createStockAdjustmentLogic, getStockBalanceLogic } from "@/server/stock-movement";
import {
  createStockAdjustmentInputSchema,
  getStockBalanceQuerySchema,
} from "@/lib/validations/stock-movement";
import {
  closeStockCountInputSchema,
  editStockCountContributionInputSchema,
  openStockCountInputSchema,
  saveStockCountLineInputSchema,
  voidStockCountInputSchema,
} from "@/lib/validations/stock-count";
import {
  closeStockCountLogic,
  CountLineTakenError,
  CountUnitMismatchError,
  deleteStockCountContributionLogic,
  deleteStockCountDraftLogic,
  deleteStockCountLineLogic,
  editStockCountContributionLogic,
  getStockCountByIdLogic,
  NotCountHostError,
  NotYourContributionError,
  getUncountedStockedCountLogic,
  openStockCountLogic,
  saveStockCountLineLogic,
  StockCountAlreadyOpenError,
  StockCountNotEditableError,
  StockCountTransitionError,
  voidStockCountLogic,
} from "@/server/stock-count";

const num = (d: Prisma.Decimal) => d.toNumber();

describe("stock count *Logic (the document that reconciles the ledger)", () => {
  let tenantA: string;
  let branchA: string;
  let branchA2: string;
  let userA: string;
  let userB: string; // a second cook on the same sheet (ADR 0034)

  const freshProduct = (tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `SC-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
      })
    );

  /** userA opens every sheet in this file, so userA is its host (ADR 0034 Q5). */
  const host = () => ({ userId: userA, canCloseAny: false });

  const unitOf = (p: ProductWithUnits, name: string) =>
    p.productUnits.find((u) => u.unitName === name)!.id;

  /** Seed stock through the real ledger path. */
  const seed = (p: ProductWithUnits, qty: number, branchId = branchA) =>
    createStockAdjustmentLogic(
      tenantA,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: qty,
        inputUnitId: unitOf(p, "kg"),
        occurredAt: new Date(),
        notes: null,
      }),
      userA
    );

  const openSheet = (branchId = branchA) =>
    openStockCountLogic(
      tenantA,
      openStockCountInputSchema.parse({
        branchId,
        countDate: new Date().toISOString().slice(0, 10),
        notes: null,
      }),
      userA
    );

  const countLine = (
    stockCountId: string,
    p: ProductWithUnits,
    entries: { unit: string; qty: number }[],
    mode: "new" | "add" = "new",
    by: string = userA
  ) =>
    saveStockCountLineLogic(
      tenantA,
      saveStockCountLineInputSchema.parse({
        stockCountId,
        productId: p.id,
        mode,
        entries: entries.map((e) => ({
          productUnitId: unitOf(p, e.unit),
          qtyInUnit: e.qty,
        })),
        notes: null,
      }),
      by
    );

  const balanceOf = async (p: ProductWithUnits, branchId = branchA) =>
    num(
      (
        await getStockBalanceLogic(
          tenantA,
          getStockBalanceQuerySchema.parse({ productId: p.id, branchId })
        )
      ).balance
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Count Test Tenant" } });
      tenantA = t.id;
      const [b1, b2] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } }),
      ]);
      branchA = b1.id;
      branchA2 = b2.id;
      const u = await tx.user.create({
        data: { email: `count-${randomUUID()}@example.com`, name: "ผู้นับ" },
      });
      userA = u.id;
      const u2 = await tx.user.create({
        data: { email: `count-b-${randomUUID()}@example.com`, name: "ผู้นับคนที่สอง" },
      });
      userB = u2.id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockCountEntry.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCountContribution.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCountItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCount.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    });
    await prisma.$disconnect();
  });

  // ----------------------------------------------------------
  // N1–N4 — the sheet
  // ----------------------------------------------------------

  it("N1: opening a sheet numbers it per branch and starts as DRAFT", async () => {
    const sheet = await openSheet();
    expect(sheet.scNumber).toBe("THL-SC-0001");
    expect(sheet.status).toBe("DRAFT");
    expect(sheet.startedBy).toBe(userA);
    expect(sheet.showExpected).toBe(true);

    // Another branch counts independently, with its own counter.
    const other = await openSheet(branchA2);
    expect(other.scNumber).toBe("ARY-SC-0001");

    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );
    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: other.id }),
      host()
    );
  });

  it("N2: a branch may have only ONE open sheet (Q8)", async () => {
    const sheet = await openSheet();
    await expect(openSheet()).rejects.toBeInstanceOf(StockCountAlreadyOpenError);

    // Closing it frees the branch for the next count.
    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );
    const next = await openSheet();
    expect(next.id).not.toBe(sheet.id);
    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: next.id }),
      host()
    );
  });

  it("N3: a line sums its units and snapshots the expected quantity (Q3)", async () => {
    const p = await freshProduct("N3");
    await seed(p, 100);

    const sheet = await openSheet();
    const withLine = await countLine(sheet.id, p, [
      { unit: "กระสอบ", qty: 2 },
      { unit: "kg", qty: 3 },
    ]);

    const item = withLine.items[0];
    expect(num(item.qtyCounted)).toBe(53); // 2 × 25 + 3
    expect(num(item.qtyExpected)).toBe(100); // the ledger, at save time
    expect(item.entries).toHaveLength(2);
    expect(item.countedBy).toBe(userA);

    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );
  });

  it("N4: a delivery arriving AFTER the line was saved does not move its expected (Q3)", async () => {
    const p = await freshProduct("N4");
    await seed(p, 100);

    const sheet = await openSheet();
    await countLine(sheet.id, p, [{ unit: "kg", qty: 95 }]);

    // The 14:00 delivery, in the middle of the count.
    await seed(p, 10);

    const closed = await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );
    const item = closed.items[0];
    // Still 100, not 110 — the snapshot is what the counter saw.
    expect(num(item.qtyExpected)).toBe(100);
    // 100 → −5 (the count) → +10 (the delivery) = 105.
    expect(await balanceOf(p)).toBe(105);
  });

  // ----------------------------------------------------------
  // N5–N8 — closing
  // ----------------------------------------------------------

  it("N5: closing posts one movement per non-zero variance, none for a match", async () => {
    const short = await freshProduct("N5a");
    const over = await freshProduct("N5b");
    const exact = await freshProduct("N5c");
    await Promise.all([seed(short, 100), seed(over, 100), seed(exact, 100)]);

    const sheet = await openSheet();
    await countLine(sheet.id, short, [{ unit: "kg", qty: 95 }]);
    await countLine(sheet.id, over, [{ unit: "kg", qty: 108 }]);
    await countLine(sheet.id, exact, [{ unit: "kg", qty: 100 }]);

    const closed = await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedBy).toBe(userA);

    expect(await balanceOf(short)).toBe(95);
    expect(await balanceOf(over)).toBe(108);
    expect(await balanceOf(exact)).toBe(100);

    const movements = await withRlsBypass((tx) =>
      tx.stockMovement.findMany({
        where: { tenantId: tenantA, sourceType: "STOCK_COUNT" },
        select: { productId: true, qty: true, type: true },
      })
    );
    const forSheet = movements.filter((m) =>
      [short.id, over.id, exact.id].includes(m.productId)
    );
    // The line that matched wrote NOTHING — nothing moved.
    expect(forSheet).toHaveLength(2);
    expect(forSheet.find((m) => m.productId === short.id)!.type).toBe("ADJUST_LOSS");
    expect(num(forSheet.find((m) => m.productId === over.id)!.qty)).toBe(8);
  });

  it("N6: a counted ZERO empties the shelf; an uncounted product is untouched (Q7)", async () => {
    const counted = await freshProduct("N6a");
    const untouched = await freshProduct("N6b");
    await Promise.all([seed(counted, 40), seed(untouched, 40)]);

    const sheet = await openSheet();
    await countLine(sheet.id, counted, [{ unit: "kg", qty: 0 }]);

    const uncounted = await getUncountedStockedCountLogic(tenantA, sheet.id);
    expect(uncounted).toBeGreaterThanOrEqual(1); // information, never a blocker

    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );

    expect(await balanceOf(counted)).toBe(0);
    expect(await balanceOf(untouched)).toBe(40); // never implied to be zero
  });

  it("N7: the variance occurs at the LINE's countedAt, not at close (Q8)", async () => {
    const p = await freshProduct("N7");
    await seed(p, 50);

    const sheet = await openSheet();
    const saved = await countLine(sheet.id, p, [{ unit: "kg", qty: 45 }]);
    const countedAt = saved.items[0].countedAt;

    await new Promise((r) => setTimeout(r, 1100));
    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );

    const movement = await withRlsBypass((tx) =>
      tx.stockMovement.findFirst({
        where: { tenantId: tenantA, productId: p.id, sourceType: "STOCK_COUNT" },
        select: { occurredAt: true, sourceId: true },
      })
    );
    expect(movement!.occurredAt.getTime()).toBe(countedAt.getTime());
    // The count LINE is the ledger's source (Q1).
    expect(movement!.sourceId).toBe(saved.items[0].id);
  });

  it("N8: closing twice is a no-op — the count line is its own submit key (Q1)", async () => {
    const p = await freshProduct("N8");
    await seed(p, 30);

    const sheet = await openSheet();
    await countLine(sheet.id, p, [{ unit: "kg", qty: 20 }]);
    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );

    // A second close is refused by the state machine...
    await expect(
      closeStockCountLogic(
        tenantA,
        closeStockCountInputSchema.parse({ id: sheet.id }),
        host()
      )
    ).rejects.toBeInstanceOf(StockCountTransitionError);
    // ...and the balance moved exactly once regardless.
    expect(await balanceOf(p)).toBe(20);
  });

  // ----------------------------------------------------------
  // N9–N11 — void, and the guards
  // ----------------------------------------------------------

  it("N9: voiding nets the ledger back and leaves the original rows untouched (Q6)", async () => {
    const p = await freshProduct("N9");
    await seed(p, 60);

    const sheet = await openSheet();
    await countLine(sheet.id, p, [{ unit: "kg", qty: 45 }]);
    const closed = await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );
    expect(await balanceOf(p)).toBe(45);

    const voided = await voidStockCountLogic(
      tenantA,
      voidStockCountInputSchema.parse({ id: sheet.id, voidReason: "นับซ้ำช่องเดิม" }),
      host()
    );

    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("นับซ้ำช่องเดิม");
    expect(await balanceOf(p)).toBe(60); // back where it started

    // The original line is intact; the reversal is a NEW line pointing at it.
    const original = closed.items[0];
    const reversal = voided.items.find((i) => i.reversalOfItemId === original.id)!;
    expect(reversal).toBeDefined();
    expect(num(reversal.qtyCounted)).toBe(num(original.qtyExpected));
    expect(num(reversal.qtyExpected)).toBe(num(original.qtyCounted));
    expect(voided.items.find((i) => i.id === original.id)).toBeDefined();
  });

  it("N10: only a CLOSED count can be voided, and only a DRAFT can be edited", async () => {
    const p = await freshProduct("N10");
    const sheet = await openSheet();

    await expect(
      voidStockCountLogic(
        tenantA,
        voidStockCountInputSchema.parse({ id: sheet.id, voidReason: "ยังไม่ปิด" }),
        host()
      )
    ).rejects.toBeInstanceOf(StockCountTransitionError);

    await countLine(sheet.id, p, [{ unit: "kg", qty: 5 }]);
    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );

    await expect(countLine(sheet.id, p, [{ unit: "kg", qty: 9 }])).rejects.toBeInstanceOf(
      StockCountNotEditableError
    );
  });

  it("N11: a second 'new' is refused, 'add' sums; a foreign unit is refused (ADR 0034 Q3)", async () => {
    const p = await freshProduct("N11a");
    const other = await freshProduct("N11b");
    await seed(p, 20);

    const sheet = await openSheet();
    await countLine(sheet.id, p, [{ unit: "kg", qty: 15 }]);

    // Someone else also believed it was uncounted — refused, not overwritten.
    await expect(countLine(sheet.id, p, [{ unit: "kg", qty: 18 }], "new", userB)).rejects.toBeInstanceOf(
      CountLineTakenError
    );

    // "Found more in the walk-in": a second contribution, summed.
    const second = await countLine(sheet.id, p, [{ unit: "kg", qty: 3 }], "add", userB);
    const line = second.items.filter((i) => i.productId === p.id);
    expect(line).toHaveLength(1);
    expect(num(line[0].qtyCounted)).toBe(18);
    expect(line[0].contributions.map((c) => c.countedBy)).toEqual([userA, userB]);
    expect(line[0].countedBy).toBe(userB); // the last person to touch it

    await expect(
      saveStockCountLineLogic(
        tenantA,
        saveStockCountLineInputSchema.parse({
          stockCountId: sheet.id,
          productId: p.id,
          mode: "add",
          entries: [{ productUnitId: unitOf(other, "kg"), qtyInUnit: 1 }],
          notes: null,
        }),
        userA
      )
    ).rejects.toBeInstanceOf(CountUnitMismatchError);

    // Removing a whole line is the host's call, and takes everyone's count with it.
    const emptied = await deleteStockCountLineLogic(tenantA, sheet.id, line[0].id, host());
    expect(emptied.items).toHaveLength(0);

    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );
    expect(await balanceOf(p)).toBe(20); // an emptied sheet posts nothing
  });

  it("N12: the detail read carries the entries as typed", async () => {
    const p = await freshProduct("N12");
    const sheet = await openSheet();
    await countLine(sheet.id, p, [
      { unit: "กระสอบ", qty: 1 },
      { unit: "kg", qty: 2 },
    ]);

    const detail = await getStockCountByIdLogic(tenantA, sheet.id);
    const entries = detail!.items[0].entries;
    expect(entries.map((e) => e.productUnit.unitName)).toEqual(["กระสอบ", "kg"]);
    expect(num(entries[0].qtyInUnit)).toBe(1);

    await closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      host()
    );
  });

  // ----------------------------------------------------------
  // N13–N17 — many devices, one sheet (ADR 0034)
  // ----------------------------------------------------------

  const lineOf = (detail: Awaited<ReturnType<typeof countLine>>, p: ProductWithUnits) =>
    detail.items.find((i) => i.productId === p.id && i.reversalOfItemId === null)!;

  it("N13: you edit only your own contribution, and the line re-sums (ADR 0034 Q3)", async () => {
    const p = await freshProduct("N13");
    const sheet = await openSheet();
    await countLine(sheet.id, p, [{ unit: "kg", qty: 4 }]);
    const both = await countLine(sheet.id, p, [{ unit: "kg", qty: 2 }], "add", userB);
    const [mine, theirs] = lineOf(both, p).contributions;

    await expect(
      editStockCountContributionLogic(
        tenantA,
        editStockCountContributionInputSchema.parse({
          stockCountId: sheet.id,
          contributionId: theirs.id,
          entries: [{ productUnitId: unitOf(p, "kg"), qtyInUnit: 99 }],
          notes: null,
        }),
        userA
      )
    ).rejects.toBeInstanceOf(NotYourContributionError);

    const edited = await editStockCountContributionLogic(
      tenantA,
      editStockCountContributionInputSchema.parse({
        stockCountId: sheet.id,
        contributionId: mine.id,
        entries: [{ productUnitId: unitOf(p, "กระสอบ"), qtyInUnit: 1 }],
        notes: "ของเสีย 1 ถุง",
      }),
      userA
    );
    const line = lineOf(edited, p);
    expect(num(line.qtyCounted)).toBe(27); // 1 กระสอบ (25) + 2 kg
    expect(line.notes).toBe("ของเสีย 1 ถุง");

    await deleteStockCountDraftLogic(tenantA, sheet.id, host());
  });

  it("N14: taking back the last contribution removes the line; someone else's cannot be taken", async () => {
    const p = await freshProduct("N14");
    const sheet = await openSheet();
    const first = await countLine(sheet.id, p, [{ unit: "kg", qty: 4 }]);
    const mine = lineOf(first, p).contributions[0];

    await expect(
      deleteStockCountContributionLogic(tenantA, sheet.id, mine.id, userB)
    ).rejects.toBeInstanceOf(NotYourContributionError);

    const after = await deleteStockCountContributionLogic(tenantA, sheet.id, mine.id, userA);
    expect(after.items.filter((i) => i.productId === p.id)).toHaveLength(0);

    await deleteStockCountDraftLogic(tenantA, sheet.id, host());
  });

  it("N15: two devices confirming at once queue — one 'new' wins, the other is told; 'add's both land", async () => {
    const p = await freshProduct("N15a");
    const q = await freshProduct("N15b");
    const sheet = await openSheet();

    const raced = await Promise.allSettled([
      countLine(sheet.id, p, [{ unit: "kg", qty: 1 }], "new", userA),
      countLine(sheet.id, p, [{ unit: "kg", qty: 2 }], "new", userB),
    ]);
    const won = raced.filter((r) => r.status === "fulfilled");
    const lost = raced.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // Told in words — not a raw unique-index error from the database.
    expect(lost[0].reason).toBeInstanceOf(CountLineTakenError);

    await Promise.all([
      countLine(sheet.id, q, [{ unit: "kg", qty: 1 }], "add", userA),
      countLine(sheet.id, q, [{ unit: "kg", qty: 2 }], "add", userB),
    ]);
    const detail = await getStockCountByIdLogic(tenantA, sheet.id);
    const line = detail!.items.find((i) => i.productId === q.id)!;
    expect(num(line.qtyCounted)).toBe(3);
    expect(line.contributions.map((c) => c.seq)).toEqual([1, 2]);

    await deleteStockCountDraftLogic(tenantA, sheet.id, host());
  });

  it("N16: only the host or a count:close holder closes, voids, discards, or removes a line (ADR 0034 Q5)", async () => {
    const p = await freshProduct("N16");
    await seed(p, 10);
    const sheet = await openSheet(); // host = userA
    const saved = await countLine(sheet.id, p, [{ unit: "kg", qty: 7 }], "new", userB);
    const cook = { userId: userB, canCloseAny: false };
    const head = { userId: userB, canCloseAny: true };

    await expect(
      deleteStockCountLineLogic(tenantA, sheet.id, lineOf(saved, p).id, cook)
    ).rejects.toBeInstanceOf(NotCountHostError);
    await expect(deleteStockCountDraftLogic(tenantA, sheet.id, cook)).rejects.toBeInstanceOf(
      NotCountHostError
    );
    await expect(
      closeStockCountLogic(tenantA, closeStockCountInputSchema.parse({ id: sheet.id }), cook)
    ).rejects.toBeInstanceOf(NotCountHostError);

    // A head of department closes on the host's behalf.
    await closeStockCountLogic(tenantA, closeStockCountInputSchema.parse({ id: sheet.id }), head);
    expect(await balanceOf(p)).toBe(7);

    await expect(
      voidStockCountLogic(
        tenantA,
        voidStockCountInputSchema.parse({ id: sheet.id, voidReason: "ทดสอบ" }),
        cook
      )
    ).rejects.toBeInstanceOf(NotCountHostError);
    await voidStockCountLogic(
      tenantA,
      voidStockCountInputSchema.parse({ id: sheet.id, voidReason: "ทดสอบ" }),
      host()
    );
    expect(await balanceOf(p)).toBe(10);
  });

  it("N17: a later contribution re-takes the expected snapshot, so a delivery in between is not a loss (calc S4)", async () => {
    const p = await freshProduct("N17");
    await seed(p, 10);
    const sheet = await openSheet();
    await countLine(sheet.id, p, [{ unit: "kg", qty: 4 }]); // walk-in
    await seed(p, 5); // a delivery lands mid-count
    const after = await countLine(sheet.id, p, [{ unit: "kg", qty: 11 }], "add", userB); // the line

    const line = lineOf(after, p);
    expect(num(line.qtyExpected)).toBe(15);
    expect(num(line.qtyCounted)).toBe(15);

    await closeStockCountLogic(tenantA, closeStockCountInputSchema.parse({ id: sheet.id }), host());
    expect(await balanceOf(p)).toBe(15); // matched — nothing posted
  });
});
