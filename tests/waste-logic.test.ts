// ============================================================
// Mise — waste *Logic integration tests (Sprint 3 Part 17 L3a)
// ============================================================
// Real Neon, real zod, real ledger. The invariants under test are the ones the
// Part exists to protect:
//   Q1 — waste posts an ordinary ADJUST_LOSS whose SOURCE is the waste row, so
//        the ledger's UNIQUE(source_type, source_id) makes a replay a no-op
//   Q2 — one row is posted immediately; correcting it is a VOID that appends
//   Q4 — /cost can tell waste from an adjustment, because only the source differs
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withAdminContext } from "@/lib/db";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import {
  createStockAdjustmentLogic,
  getStockBalanceLogic,
  StockUnitMismatchError,
} from "@/server/stock-movement";
import {
  createStockAdjustmentInputSchema,
  getStockBalanceQuerySchema,
} from "@/lib/validations/stock-movement";
import {
  createWasteInputSchema,
  getWasteQuerySchema,
  voidWasteInputSchema,
} from "@/lib/validations/waste";
import {
  WasteAlreadyVoidedError,
  WasteLogNotFoundError,
  WasteNotVoidableError,
  createWasteLogic,
  getWasteLogsLogic,
  voidWasteLogic,
} from "@/server/waste";

const num = (d: Prisma.Decimal) => d.toNumber();

describe("waste *Logic (the fourth writer to the ledger)", () => {
  let tenantA: string;
  let branchA: string;
  let branchA2: string;
  let userA: string;

  const freshProduct = (tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `WL-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [
          { unitName: "กระสอบ", toBaseRatio: 25 },
          { unitName: "mg", toBaseRatio: 0.000001 },
        ],
      })
    );

  const unitOf = (p: ProductWithUnits, name: string) =>
    p.productUnits.find((u) => u.unitName === name)!.id;

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

  const throwAway = (
    p: ProductWithUnits,
    qty: number,
    opts: {
      unit?: string;
      reason?: string;
      submitKey?: string;
      branchId?: string;
      wastedByName?: string | null;
      occurredAt?: Date;
    } = {}
  ) =>
    createWasteLogic(
      tenantA,
      createWasteInputSchema.parse({
        submitKey: opts.submitKey ?? randomUUID(),
        productId: p.id,
        branchId: opts.branchId ?? branchA,
        reason: opts.reason ?? "SPOILED",
        inputQty: qty,
        inputUnitId: unitOf(p, opts.unit ?? "kg"),
        occurredAt: opts.occurredAt ?? new Date(),
        wastedByName: opts.wastedByName ?? null,
        notes: null,
      }),
      userA
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
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Waste Test Tenant" } });
      tenantA = t.id;
      const [b1, b2] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } }),
      ]);
      branchA = b1.id;
      branchA2 = b2.id;
      const u = await tx.user.create({
        data: { email: `waste-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
    });
  });

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.wasteLog.updateMany({
        where: { tenantId: tenantA },
        data: { reversalOfId: null },
      });
      await tx.wasteLog.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  it("L1: throwing something away posts an ADJUST_LOSS sourced at the waste row (Q1)", async () => {
    const p = await freshProduct("L1");
    await seed(p, 20);

    const { waste, movement, postBalance } = await throwAway(p, 3);

    expect(movement.type).toBe("ADJUST_LOSS");
    // Q1's whole point: no new MovementType, only a new SourceType — which is
    // what lets /cost mean ของเสีย when it says ของเสีย (Q4).
    expect(movement.sourceType).toBe("WASTE_LOG");
    expect(movement.sourceId).toBe(waste.id);
    expect(num(movement.qty)).toBe(-3);
    expect(num(postBalance)).toBe(17);
    expect(await balanceOf(p)).toBe(17);
  });

  it("L2: the quantity is entered in ANY unit and stored in base", async () => {
    const p = await freshProduct("L2");
    await seed(p, 100);

    const { waste, movement } = await throwAway(p, 2, { unit: "กระสอบ" });

    // As entered on the row, converted on the ledger — mirroring stock_adjustment.
    expect(num(waste.inputQty)).toBe(2);
    expect(num(movement.qty)).toBe(-50);
    expect(await balanceOf(p)).toBe(50);
  });

  it("L3: a replayed submit is ONE write, not two (Part 13.5's key)", async () => {
    const p = await freshProduct("L3");
    await seed(p, 10);
    const key = randomUUID();

    const first = await throwAway(p, 4, { submitKey: key });
    const second = await throwAway(p, 4, { submitKey: key });

    expect(second.waste.id).toBe(first.waste.id);
    expect(second.movement.id).toBe(first.movement.id);
    // The bin does not get twice as full because the button was pressed twice.
    expect(await balanceOf(p)).toBe(6);
  });

  it("L4: waste may take the shelf NEGATIVE — the ledger never blocks (ADR 0011 Q9)", async () => {
    const p = await freshProduct("L4");
    await seed(p, 1);

    // A shop that never recorded the delivery still threw the tray away. The
    // negative is the signal that something upstream is missing; refusing the
    // write would only lose the fact.
    const { postBalance } = await throwAway(p, 5);
    expect(num(postBalance)).toBe(-4);
  });

  it("L5: a unit from another product is refused", async () => {
    const p = await freshProduct("L5a");
    const other = await freshProduct("L5b");
    await seed(p, 10);

    await expect(
      createWasteLogic(
        tenantA,
        createWasteInputSchema.parse({
          submitKey: randomUUID(),
          productId: p.id,
          branchId: branchA,
          reason: "DAMAGED",
          inputQty: 1,
          inputUnitId: unitOf(other, "kg"),
          occurredAt: new Date(),
          wastedByName: null,
          notes: null,
        }),
        userA
      )
    ).rejects.toBeInstanceOf(StockUnitMismatchError);
  });

  it("L6: a quantity that rounds to zero in the base unit is refused, not silently dropped", async () => {
    const p = await freshProduct("L6");
    await seed(p, 10);
    // 0.001 mg against a kg base is 0.000000001 kg — the DB CHECK forbids a
    // zero-qty movement, so this is caught with a field error instead.
    await expect(throwAway(p, 0.001, { unit: "mg" })).rejects.toThrow();
    expect(await balanceOf(p)).toBe(10);
  });

  it("L7: voiding appends a compensating ADJUST_GAIN and leaves the original standing (Q2)", async () => {
    const p = await freshProduct("L7");
    await seed(p, 30);
    const { waste } = await throwAway(p, 8, { wastedByName: "เชฟหนึ่ง" });
    expect(await balanceOf(p)).toBe(22);

    const voided = await voidWasteLogic(
      tenantA,
      voidWasteInputSchema.parse({ id: waste.id, voidReason: "คีย์ผิดหน่วย" }),
      userA
    );

    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidReason).toBe("คีย์ผิดหน่วย");
    // The stock comes back exactly, and the original entry is still there to read.
    expect(await balanceOf(p)).toBe(30);

    const rows = await withAdminContext((tx) =>
      tx.wasteLog.findMany({ where: { tenantId: tenantA, productId: p.id } })
    );
    expect(rows).toHaveLength(2);
    const reversal = rows.find((r) => r.reversalOfId !== null)!;
    expect(reversal.reversalOfId).toBe(waste.id);
    // The reversal carries the original's attribution, not a blank.
    expect(reversal.wastedByName).toBe("เชฟหนึ่ง");
  });

  it("L8: a second void is refused — one reversal per row", async () => {
    const p = await freshProduct("L8");
    await seed(p, 10);
    const { waste } = await throwAway(p, 2);

    const input = voidWasteInputSchema.parse({ id: waste.id, voidReason: "ซ้ำ" });
    await voidWasteLogic(tenantA, input, userA);

    await expect(voidWasteLogic(tenantA, input, userA)).rejects.toBeInstanceOf(
      WasteAlreadyVoidedError
    );
    // Not credited back twice.
    expect(await balanceOf(p)).toBe(10);
  });

  it("L9: a reversal cannot itself be voided", async () => {
    const p = await freshProduct("L9");
    await seed(p, 10);
    const { waste } = await throwAway(p, 2);
    await voidWasteLogic(
      tenantA,
      voidWasteInputSchema.parse({ id: waste.id, voidReason: "แก้" }),
      userA
    );

    const reversal = (
      await withAdminContext((tx) =>
        tx.wasteLog.findMany({ where: { tenantId: tenantA, productId: p.id } })
      )
    ).find((r) => r.reversalOfId !== null)!;

    await expect(
      voidWasteLogic(
        tenantA,
        voidWasteInputSchema.parse({ id: reversal.id, voidReason: "ย้อนอีกที" }),
        userA
      )
    ).rejects.toBeInstanceOf(WasteNotVoidableError);
  });

  it("L10: voiding a row that does not belong to this tenant is a not-found", async () => {
    await expect(
      voidWasteLogic(
        tenantA,
        voidWasteInputSchema.parse({ id: randomUUID(), voidReason: "x" }),
        userA
      )
    ).rejects.toBeInstanceOf(WasteLogNotFoundError);
  });

  it("L11: the list hides voided entries and their reversals by default", async () => {
    const p = await freshProduct("L11");
    await seed(p, 40);
    const kept = await throwAway(p, 3, { reason: "COOKING_ERROR" });
    const undone = await throwAway(p, 5, { reason: "SPOILED" });
    await voidWasteLogic(
      tenantA,
      voidWasteInputSchema.parse({ id: undone.waste.id, voidReason: "คีย์ผิด" }),
      userA
    );

    const live = await getWasteLogsLogic(
      tenantA,
      getWasteQuerySchema.parse({ productId: p.id })
    );
    // Showing the voided pair would double every correction in a list people
    // read as a total of what was thrown away.
    expect(live.map((r) => r.id)).toEqual([kept.waste.id]);

    const all = await getWasteLogsLogic(
      tenantA,
      getWasteQuerySchema.parse({ productId: p.id, includeVoided: "true" })
    );
    expect(all).toHaveLength(3);
  });

  it("L12: the list filters by branch and by reason", async () => {
    const p = await freshProduct("L12");
    await seed(p, 20);
    await seed(p, 20, branchA2);
    await throwAway(p, 1, { reason: "SPOILED" });
    await throwAway(p, 2, { reason: "CUSTOMER_RETURN", branchId: branchA2 });

    const byBranch = await getWasteLogsLogic(
      tenantA,
      getWasteQuerySchema.parse({ productId: p.id, branchId: branchA2 })
    );
    expect(byBranch).toHaveLength(1);
    expect(byBranch[0].branch.id).toBe(branchA2);

    const byReason = await getWasteLogsLogic(
      tenantA,
      getWasteQuerySchema.parse({ productId: p.id, reason: "SPOILED" })
    );
    expect(byReason).toHaveLength(1);
    expect(num(byReason[0].inputQty)).toBe(1);
  });

  it("L14: the date window is inclusive of the day at both ends", async () => {
    // /waste defaults its filter to the CURRENT MONTH (the UX pass), so this
    // window is the page's real behaviour rather than a rarely used filter. An
    // off-by-one at either end would silently hide today's entries — the ones
    // someone is most likely looking for.
    const p = await freshProduct("L14");
    await seed(p, 100);

    const today = new Date();
    const longAgo = new Date(today.getTime() - 40 * 86_400_000);
    await throwAway(p, 1, { occurredAt: today });
    await throwAway(p, 2, { occurredAt: longAgo });

    const thisMonth = await getWasteLogsLogic(
      tenantA,
      getWasteQuerySchema.parse({
        productId: p.id,
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        // The page passes end-of-day for exactly this reason: the form posts a
        // DATE, and a midnight upper bound would exclude everything logged today.
        to: new Date(
          `${today.toISOString().slice(0, 10)}T23:59:59.999Z`
        ),
      })
    );
    expect(thisMonth).toHaveLength(1);
    expect(num(thisMonth[0].inputQty)).toBe(1);

    const everything = await getWasteLogsLogic(
      tenantA,
      getWasteQuerySchema.parse({ productId: p.id })
    );
    expect(everything).toHaveLength(2);
  });

  it("L13: a void credits back what was POSTED, even if the unit's ratio changed since", async () => {
    const p = await freshProduct("L13");
    await seed(p, 100);
    const { waste } = await throwAway(p, 2, { unit: "กระสอบ" }); // 50 kg out
    expect(await balanceOf(p)).toBe(50);

    // Someone corrects the sack size afterwards. Recomputing the reversal from
    // today's ratio would credit back 60 kg for stock that left as 50 — the
    // ledger would be permanently 10 kg richer than the shelf.
    await withAdminContext((tx) =>
      tx.productUnit.update({
        where: { id: unitOf(p, "กระสอบ") },
        data: { toBaseRatio: new Prisma.Decimal(30) },
      })
    );

    await voidWasteLogic(
      tenantA,
      voidWasteInputSchema.parse({ id: waste.id, voidReason: "ทิ้งผิดตัว" }),
      userA
    );
    expect(await balanceOf(p)).toBe(100);
  });
});
