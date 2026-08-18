// ============================================================
// Mise — transfer *Logic integration tests (Sprint 3 Part 18 L3b)
// ============================================================
// Real Neon, real zod, real ledger, real FIFO. The invariants under test are the
// ones this Part exists to protect:
//   Q1 — BOTH legs post at dispatch; the goods belong to the receiver from the
//        moment the truck leaves, and the status is about paperwork only
//   Q2 — receiving records the count, and the gap becomes a TRANSFER_SHORTAGE
//        loss at the RECEIVING branch
//   Q5 — the sending branch's FIFO money travels frozen, and the receiver's cost
//        is that money rather than a guess made from its own history
//   Q6 — a void appends and reverses both ends; it is not a transfer back
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
import { getProductCostLogic } from "@/server/stock-cost";
import { getProductCostQuerySchema } from "@/lib/validations/stock-cost";
import {
  dispatchTransferInputSchema,
  getTransfersQuerySchema,
  receiveTransferInputSchema,
  voidTransferInputSchema,
} from "@/lib/validations/transfer";
import {
  TransferAlreadyReceivedError,
  TransferAlreadyVoidedError,
  TransferLineMismatchError,
  TransferNotReceivableError,
  TransferQtyExceedsSentError,
  TransferSameBranchError,
  dispatchTransferLogic,
  getIncomingTransfersLogic,
  getTransfersLogic,
  receiveTransferLogic,
  voidTransferLogic,
} from "@/server/transfer";

const num = (d: Prisma.Decimal) => d.toNumber();

describe("transfer *Logic (the fifth writer, and the first at two branches)", () => {
  let tenantA: string;
  let thonglor: string;
  let ari: string;
  let userA: string;

  const freshProduct = (tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `TF-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
      })
    );

  const unitOf = (p: ProductWithUnits, name: string) =>
    p.productUnits.find((u) => u.unitName === name)!.id;

  /** Stock in, with a declared cost so the FIFO layer has real money on it. */
  const seed = (
    p: ProductWithUnits,
    qty: number,
    branchId: string,
    unitCost?: number
  ) =>
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
        // A declaration is how an adjustment gets a price (ADR 0014 Q6) — the
        // seed needs one, or every layer here would be UNPRICED and the transfer
        // would have nothing to freeze.
        costDeclaration:
          unitCost === undefined
            ? null
            : { unitCost, unitId: unitOf(p, "kg"), note: null },
      }),
      userA
    );

  const send = (
    p: ProductWithUnits,
    qty: number,
    opts: {
      from?: string;
      to?: string;
      unit?: string;
      submitKey?: string;
      driverName?: string | null;
      driverConfirmed?: boolean;
      dispatchedAt?: Date;
    } = {}
  ) =>
    dispatchTransferLogic(
      tenantA,
      dispatchTransferInputSchema.parse({
        submitKey: opts.submitKey ?? randomUUID(),
        fromBranchId: opts.from ?? thonglor,
        toBranchId: opts.to ?? ari,
        dispatchedAt: opts.dispatchedAt ?? new Date(),
        dispatchedByName: null,
        driverName: opts.driverName ?? null,
        driverConfirmed: opts.driverConfirmed ?? false,
        notes: null,
        lines: [
          {
            productId: p.id,
            qtySent: qty,
            inputUnitId: unitOf(p, opts.unit ?? "kg"),
            notes: null,
          },
        ],
      }),
      userA
    );

  const balanceOf = async (p: ProductWithUnits, branchId: string) =>
    num(
      (
        await getStockBalanceLogic(
          tenantA,
          getStockBalanceQuerySchema.parse({ productId: p.id, branchId })
        )
      ).balance
    );

  const costOf = (p: ProductWithUnits, branchId: string) =>
    getProductCostLogic(
      tenantA,
      getProductCostQuerySchema.parse({ productId: p.id, branchId })
    );

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Transfer Test Tenant" } });
      tenantA = t.id;
      const [b1, b2] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } }),
      ]);
      thonglor = b1.id;
      ari = b2.id;
      const u = await tx.user.create({
        data: { email: `tf-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
    });
  });

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      // Reversal lines go FIRST, and are never null'd out on the way. waste_log's
      // teardown clears its self-FK before deleting; the same move here violates
      // stock_transfer_item_sign_check, because a negative qty_sent is only legal
      // ON a reversal line — the constraint that makes direction structural
      // rather than typed. Deleting children before parents needs no such edit.
      await tx.stockTransferItem.deleteMany({
        where: { tenantId: tenantA, reversalOfItemId: { not: null } },
      });
      await tx.stockTransferItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockTransfer.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCostDeclaration.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  it("X1: dispatch posts BOTH legs at once — the receiver owns the goods from the truck leaving (Q1)", async () => {
    const p = await freshProduct("X1");
    await seed(p, 20, thonglor, 180);

    const tf = await send(p, 8);

    expect(tf.status).toBe("SENT");
    expect(await balanceOf(p, thonglor)).toBe(12);
    // The whole of Q1 in one assertion: nothing has been received, and the
    // receiving branch already holds the stock.
    expect(tf.receivedAt).toBeNull();
    expect(await balanceOf(p, ari)).toBe(8);
  });

  it("X2: one line, two source types, one row id — the ledger's unique is on the PAIR", async () => {
    const p = await freshProduct("X2");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 4);

    const item = tf.items[0];
    const movements = await withAdminContext((tx) =>
      tx.stockMovement.findMany({
        where: { tenantId: tenantA, sourceId: item.id },
        orderBy: { sourceType: "asc" },
      })
    );

    expect(movements).toHaveLength(2);
    const out = movements.find((m) => m.type === "TRANSFER_OUT")!;
    const inn = movements.find((m) => m.type === "TRANSFER_IN")!;
    expect(out.sourceType).toBe("TRANSFER_OUT");
    expect(inn.sourceType).toBe("TRANSFER_IN");
    expect(out.sourceId).toBe(inn.sourceId);
    expect(out.branchId).toBe(thonglor);
    expect(inn.branchId).toBe(ari);
    expect(num(out.qty)).toBe(-4);
    expect(num(inn.qty)).toBe(4);
  });

  it("X3: the sending branch's FIFO money travels frozen (Q5)", async () => {
    const p = await freshProduct("X3");
    await seed(p, 10, thonglor, 180);
    const tf = await send(p, 4);

    // 4 kg out of a 180/kg layer.
    expect(num(tf.items[0].costTotal)).toBe(720);
    // DECLARED, not FRONT_LAYER — and that is the point of carrying the source
    // rather than just the money. ทองหล่อ's layer was priced by a human saying so
    // (ADR 0014 Q6), and crossing a branch boundary must not launder that into a
    // figure that looks like it came off a supplier's invoice.
    expect(tf.items[0].costSource).toBe("DECLARED");
  });

  it("X4: the receiver's cost is the SENDER's money, not a guess from its own history", async () => {
    const p = await freshProduct("X4");
    await seed(p, 10, thonglor, 180);
    // อารีย์ bought the same product far more expensively.
    await seed(p, 10, ari, 400);

    await send(p, 5);

    const cost = await costOf(p, ari);
    // 10 @ 400 = 4,000 plus 5 @ 180 = 900. If the arrival had been priced at
    // อารีย์'s own last known cost it would have added 2,000.
    expect(num(cost.inventoryValue)).toBe(4900);
    expect(num(cost.qtyOnHand)).toBe(15);
  });

  it("X5: goods reaching a branch that never bought them are NOT free", async () => {
    const p = await freshProduct("X5");
    await seed(p, 10, thonglor, 250);

    await send(p, 6);

    const cost = await costOf(p, ari);
    expect(num(cost.inventoryValue)).toBe(1500);
    expect(num(cost.costPerBaseUnit)).toBe(250);
    expect(cost.hasUnpricedLayers).toBe(false);
  });

  it("X6: a sender that cannot price its own stock says so, instead of shipping free goods", async () => {
    const p = await freshProduct("X6");
    // No cost declared and nothing ever purchased: the layer is UNPRICED.
    await seed(p, 10, thonglor);

    const tf = await send(p, 5);

    expect(num(tf.items[0].costTotal)).toBe(0);
    expect(tf.items[0].costSource).toBe("UNPRICED");
    const cost = await costOf(p, ari);
    // The zero is legible as ignorance rather than as a gift.
    expect(cost.hasUnpricedLayers).toBe(true);
  });

  it("X7: quantities are entered in ANY unit and posted in base", async () => {
    const p = await freshProduct("X7");
    await seed(p, 100, thonglor, 10);

    const tf = await send(p, 2, { unit: "กระสอบ" });

    expect(num(tf.items[0].qtySent)).toBe(2);
    expect(num(tf.items[0].toBaseRatio)).toBe(25);
    expect(await balanceOf(p, ari)).toBe(50);
    expect(await balanceOf(p, thonglor)).toBe(50);
  });

  it("X8: a replayed submit moves the goods ONCE, not twice", async () => {
    const p = await freshProduct("X8");
    await seed(p, 10, thonglor, 100);
    const key = randomUUID();

    const first = await send(p, 3, { submitKey: key });
    const second = await send(p, 3, { submitKey: key });

    expect(second.id).toBe(first.id);
    expect(second.tfNumber).toBe(first.tfNumber);
    // The failure this prevents is wrong at TWO branches at once, and the two
    // errors are equal and opposite — neither looks wrong on its own.
    expect(await balanceOf(p, thonglor)).toBe(7);
    expect(await balanceOf(p, ari)).toBe(3);
  });

  it("X9: receiving posts the SHORTFALL at the receiving branch, and nothing else (Q2)", async () => {
    const p = await freshProduct("X9");
    await seed(p, 20, thonglor, 200);
    const tf = await send(p, 10);

    const received = await receiveTransferLogic(
      tenantA,
      receiveTransferInputSchema.parse({
        id: tf.id,
        receivedByName: "สมหญิง",
        notes: null,
        lines: [{ itemId: tf.items[0].id, qtyReceived: 8 }],
      }),
      userA
    );

    expect(received.status).toBe("RECEIVED");
    expect(num(received.items[0].qtyReceived!)).toBe(8);
    // The arrival was already posted at dispatch; only the gap posts now.
    expect(await balanceOf(p, ari)).toBe(8);
    expect(await balanceOf(p, thonglor)).toBe(10);

    const shortage = await withAdminContext((tx) =>
      tx.stockMovement.findFirst({
        where: { tenantId: tenantA, sourceType: "TRANSFER_SHORTAGE" },
      })
    );
    expect(shortage!.branchId).toBe(ari);
    expect(num(shortage!.qty)).toBe(-2);
    expect(shortage!.type).toBe("ADJUST_LOSS");
  });

  it("X10: receiving everything posts NO shortage movement at all", async () => {
    const p = await freshProduct("X10");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 5);

    await receiveTransferLogic(
      tenantA,
      receiveTransferInputSchema.parse({
        id: tf.id,
        receivedByName: null,
        notes: null,
        lines: [{ itemId: tf.items[0].id, qtyReceived: 5 }],
      }),
      userA
    );

    const shortages = await withAdminContext((tx) =>
      tx.stockMovement.count({
        where: {
          tenantId: tenantA,
          sourceType: "TRANSFER_SHORTAGE",
          sourceId: tf.items[0].id,
        },
      })
    );
    expect(shortages).toBe(0);
    expect(await balanceOf(p, ari)).toBe(5);
  });

  it("X11: receiving 0 is a real count — everything is written off, and it says so", async () => {
    const p = await freshProduct("X11");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 4);

    const received = await receiveTransferLogic(
      tenantA,
      receiveTransferInputSchema.parse({
        id: tf.id,
        receivedByName: null,
        notes: null,
        lines: [{ itemId: tf.items[0].id, qtyReceived: 0 }],
      }),
      userA
    );

    expect(num(received.items[0].qtyReceived!)).toBe(0);
    expect(await balanceOf(p, ari)).toBe(0);
  });

  it("X12: receiving MORE than was dispatched is refused", async () => {
    const p = await freshProduct("X12");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 4);

    await expect(
      receiveTransferLogic(
        tenantA,
        receiveTransferInputSchema.parse({
          id: tf.id,
          receivedByName: null,
          notes: null,
          lines: [{ itemId: tf.items[0].id, qtyReceived: 5 }],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(TransferQtyExceedsSentError);
  });

  it("X13: the receive payload must answer exactly this document's lines", async () => {
    const p = await freshProduct("X13");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 4);

    await expect(
      receiveTransferLogic(
        tenantA,
        receiveTransferInputSchema.parse({
          id: tf.id,
          receivedByName: null,
          notes: null,
          lines: [{ itemId: randomUUID(), qtyReceived: 4 }],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(TransferLineMismatchError);
  });

  it("X14: receiving twice is refused — a second, different count is a correction, and corrections are voids", async () => {
    const p = await freshProduct("X14");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 4);
    const line = [{ itemId: tf.items[0].id, qtyReceived: 4 }];

    await receiveTransferLogic(
      tenantA,
      receiveTransferInputSchema.parse({ id: tf.id, receivedByName: null, notes: null, lines: line }),
      userA
    );
    await expect(
      receiveTransferLogic(
        tenantA,
        receiveTransferInputSchema.parse({ id: tf.id, receivedByName: null, notes: null, lines: line }),
        userA
      )
    ).rejects.toBeInstanceOf(TransferAlreadyReceivedError);
  });

  it("X15: a void puts the goods back at the sender and takes them off the receiver (Q6)", async () => {
    const p = await freshProduct("X15");
    await seed(p, 20, thonglor, 150);
    const tf = await send(p, 9);

    const voided = await voidTransferLogic(
      tenantA,
      voidTransferInputSchema.parse({ id: tf.id, voidReason: "คีย์ผิดสาขา" }),
      userA
    );

    expect(voided.status).toBe("VOIDED");
    expect(await balanceOf(p, thonglor)).toBe(20);
    expect(await balanceOf(p, ari)).toBe(0);
    // Appended, never edited: the original line still stands beside its reversal.
    expect(voided.items).toHaveLength(2);
    expect(num(voided.items[1].qtySent)).toBe(-9);
    expect(voided.items[1].reversalOfItemId).toBe(tf.items[0].id);
  });

  it("X16: a void restores the sender's VALUE exactly, not just its quantity", async () => {
    const p = await freshProduct("X16");
    await seed(p, 10, thonglor, 300);
    const before = num((await costOf(p, thonglor)).inventoryValue);

    const tf = await send(p, 4);
    await voidTransferLogic(
      tenantA,
      voidTransferInputSchema.parse({ id: tf.id, voidReason: "รถไม่ได้ออก" }),
      userA
    );

    expect(num((await costOf(p, thonglor)).inventoryValue)).toBe(before);
    expect(num((await costOf(p, ari)).inventoryValue)).toBe(0);
  });

  it("X17: voiding a RECEIVED transfer also gives back the shortfall it recorded", async () => {
    const p = await freshProduct("X17");
    await seed(p, 20, thonglor, 100);
    const tf = await send(p, 10);
    await receiveTransferLogic(
      tenantA,
      receiveTransferInputSchema.parse({
        id: tf.id,
        receivedByName: null,
        notes: null,
        lines: [{ itemId: tf.items[0].id, qtyReceived: 7 }],
      }),
      userA
    );
    expect(await balanceOf(p, ari)).toBe(7);

    await voidTransferLogic(
      tenantA,
      voidTransferInputSchema.parse({ id: tf.id, voidReason: "ผิดสินค้า" }),
      userA
    );

    // A loss recorded against a document that never happened must not survive it.
    expect(await balanceOf(p, ari)).toBe(0);
    expect(await balanceOf(p, thonglor)).toBe(20);
  });

  it("X18: voiding after the receiver used the stock drives it negative rather than hiding the problem", async () => {
    const p = await freshProduct("X18");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 6);
    // อารีย์ cooks 4 of the 6 before ทองหล่อ notices the document was wrong.
    await createStockAdjustmentLogic(
      tenantA,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId: ari,
        type: "ADJUST_LOSS",
        reason: "OTHER",
        inputQty: 4,
        inputUnitId: unitOf(p, "kg"),
        occurredAt: new Date(),
        notes: null,
      }),
      userA
    );

    await voidTransferLogic(
      tenantA,
      voidTransferInputSchema.parse({ id: tf.id, voidReason: "คีย์ผิด" }),
      userA
    );

    expect(await balanceOf(p, ari)).toBe(-4);
  });

  it("X19: voiding twice is refused, and a voided transfer cannot be received", async () => {
    const p = await freshProduct("X19");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 3);
    const voidInput = voidTransferInputSchema.parse({ id: tf.id, voidReason: "ผิด" });

    await voidTransferLogic(tenantA, voidInput, userA);
    await expect(voidTransferLogic(tenantA, voidInput, userA)).rejects.toBeInstanceOf(
      TransferAlreadyVoidedError
    );
    await expect(
      receiveTransferLogic(
        tenantA,
        receiveTransferInputSchema.parse({
          id: tf.id,
          receivedByName: null,
          notes: null,
          lines: [{ itemId: tf.items[0].id, qtyReceived: 3 }],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(TransferNotReceivableError);
  });

  it("X20: a transfer to the same branch is refused before anything is written", async () => {
    const p = await freshProduct("X20");
    await seed(p, 10, thonglor, 100);

    // Bypassing zod on purpose: zod refuses this too (T2), and the point here is
    // that the LOGIC does not depend on having been called through it.
    await expect(
      dispatchTransferLogic(
        tenantA,
        {
          submitKey: randomUUID(),
          fromBranchId: thonglor,
          toBranchId: thonglor,
          dispatchedAt: new Date(),
          dispatchedByName: null,
          driverName: null,
          driverConfirmed: false,
          notes: null,
          lines: [
            { productId: p.id, qtySent: 2, inputUnitId: unitOf(p, "kg"), notes: null },
          ],
        },
        userA
      )
    ).rejects.toBeInstanceOf(TransferSameBranchError);
    expect(await balanceOf(p, thonglor)).toBe(10);
  });

  it("X21: a unit belonging to another product is refused", async () => {
    const p = await freshProduct("X21a");
    const other = await freshProduct("X21b");
    await seed(p, 10, thonglor, 100);

    await expect(
      dispatchTransferLogic(
        tenantA,
        dispatchTransferInputSchema.parse({
          submitKey: randomUUID(),
          fromBranchId: thonglor,
          toBranchId: ari,
          dispatchedAt: new Date(),
          dispatchedByName: null,
          driverName: null,
          driverConfirmed: false,
          notes: null,
          lines: [
            {
              productId: p.id,
              qtySent: 1,
              inputUnitId: unitOf(other, "kg"),
              notes: null,
            },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(StockUnitMismatchError);
  });

  it("X22: the driver is recorded, and the confirmation is stamped only when claimed", async () => {
    const p = await freshProduct("X22");
    await seed(p, 10, thonglor, 100);

    const plain = await send(p, 1);
    expect(plain.driverName).toBeNull();
    expect(plain.driverConfirmedAt).toBeNull();

    const signed = await send(p, 1, { driverName: "สมชาย", driverConfirmed: true });
    expect(signed.driverName).toBe("สมชาย");
    expect(signed.driverConfirmedAt).not.toBeNull();
    // The FK stays empty until user management exists — the name is the record.
    expect(signed.driverUserId).toBeNull();
  });

  it("X23: document numbers come from the SENDING branch and count up", async () => {
    const p = await freshProduct("X23");
    await seed(p, 10, thonglor, 100);
    await seed(p, 10, ari, 100);

    const out = await send(p, 1);
    const back = await send(p, 1, { from: ari, to: thonglor });

    expect(out.tfNumber.startsWith("THL-TF-")).toBe(true);
    expect(back.tfNumber.startsWith("ARY-TF-")).toBe(true);
  });

  it("X24: the list can be asked about either END of the journey", async () => {
    const p = await freshProduct("X24");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 2);

    const out = await getTransfersLogic(
      tenantA,
      getTransfersQuerySchema.parse({ branchId: thonglor, direction: "OUT", productId: p.id })
    );
    const inbound = await getTransfersLogic(
      tenantA,
      getTransfersQuerySchema.parse({ branchId: thonglor, direction: "IN", productId: p.id })
    );

    expect(out.map((t) => t.id)).toContain(tf.id);
    expect(inbound.map((t) => t.id)).not.toContain(tf.id);
  });

  it("X25: the destination branch can see what is on its way, which is the point of Q8", async () => {
    const p = await freshProduct("X25");
    await seed(p, 10, thonglor, 100);
    const tf = await send(p, 2);

    const waiting = await getIncomingTransfersLogic(tenantA, ari);
    expect(waiting.map((t) => t.id)).toContain(tf.id);

    await receiveTransferLogic(
      tenantA,
      receiveTransferInputSchema.parse({
        id: tf.id,
        receivedByName: null,
        notes: null,
        lines: [{ itemId: tf.items[0].id, qtyReceived: 2 }],
      }),
      userA
    );

    // Confirmed goods stop asking to be looked at.
    const after = await getIncomingTransfersLogic(tenantA, ari);
    expect(after.map((t) => t.id)).not.toContain(tf.id);
  });
});
