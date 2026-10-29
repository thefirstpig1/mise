// ============================================================
// Mise — production documents against the real ledger (ADR 0040)
// ============================================================
// The engine's rules are pinned in fifo-production.test.ts with tables of
// numbers. This file pins that the DOCUMENT writes what the engine needs, and
// that /cost's own read path hands the money over — including when the caller
// asks for the soup alone and never mentions the bones.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { addDays, bangkokDayStartUtc, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { createStockAdjustmentLogic, getStockBalanceLogic } from "@/server/stock-movement";
import {
  createStockAdjustmentInputSchema,
  getStockBalanceQuerySchema,
} from "@/lib/validations/stock-movement";
import { getProductCostLogic } from "@/server/stock-cost";
import { declareStockCostLogic } from "@/server/cost-declaration";
import { declareStockCostInputSchema } from "@/lib/validations/stock-cost";
import {
  createProductionInputSchema,
  voidProductionInputSchema,
} from "@/lib/validations/production";
import {
  ProductionAlreadyVoidedError,
  ProductionLoopError,
  ProductionOutputNotPreppedError,
  TrimRecipeMismatchError,
  createProductionLogic,
  voidProductionLogic,
} from "@/server/production";
import { sweepTestTenants } from "./support/sweep";

const num = (d: Prisma.Decimal) => d.toNumber();

describe("production *Logic (ADR 0040)", () => {
  let tenant: string;
  let branch: string;
  let branch2: string;
  let user: string;

  const product = (tag: string, type: "RAW" | "PREPPED" = "RAW", base = "kg") =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `PD-${tag}-${randomUUID().slice(0, 6)}`,
        type,
        primaryDimension: base === "kg" ? "WEIGHT" : "VOLUME",
        baseUnitName: base,
      })
    );

  const unit = (p: ProductWithUnits) => p.productUnits.find((u) => u.isBase)!.id;

  /** `qty` base units at `unitCost` each, declared so the layer is priced. */
  const stock = async (p: ProductWithUnits, qty: number, unitCost: number, branchId = branch) => {
    const { movement } = await createStockAdjustmentLogic(
      tenant,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: qty,
        inputUnitId: unit(p),
        occurredAt: addDays(new Date(), -10),
        notes: null,
      }),
      user
    );
    await declareStockCostLogic(
      tenant,
      declareStockCostInputSchema.parse({
        movementId: movement.id,
        unitCost,
        unitId: unit(p),
        note: "ทดสอบ",
      }),
      user
    );
    return movement;
  };

  const produce = (
    inputs: [ProductWithUnits, number][],
    outputs: [ProductWithUnits, number][],
    opts: { kind?: "PRODUCE" | "TRIM"; trimRecipeId?: string; producedOn?: Date; submitKey?: string; branchId?: string } = {}
  ) =>
    createProductionLogic(
      tenant,
      createProductionInputSchema.parse({
        submitKey: opts.submitKey ?? randomUUID(),
        branchId: opts.branchId ?? branch,
        kind: opts.kind ?? "PRODUCE",
        producedOn: opts.producedOn ?? computeBangkokToday(),
        trimRecipeId: opts.trimRecipeId ?? null,
        inputs: inputs.map(([p, q]) => ({ productId: p.id, inputQty: q, inputUnitId: unit(p) })),
        outputs: outputs.map(([p, q]) => ({ productId: p.id, inputQty: q, inputUnitId: unit(p) })),
      }),
      user
    );

  const cost = (p: ProductWithUnits, branchId = branch) =>
    getProductCostLogic(tenant, { productId: p.id, branchId });

  const balance = async (p: ProductWithUnits, branchId = branch) =>
    num(
      (
        await getStockBalanceLogic(
          tenant,
          getStockBalanceQuerySchema.parse({ productId: p.id, branchId })
        )
      ).balance
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Production Test Tenant" } });
      tenant = t.id;
      const b = await tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } });
      const b2 = await tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } });
      branch = b.id;
      branch2 = b2.id;
      const u = await tx.user.create({
        data: { email: `production-${randomUUID()}@example.com`, name: "เชฟ" },
      });
      user = u.id;
    });
  });

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: user } }));
  });

  it("P1: soup carries what the bones and onion cost — read for the soup ALONE", async () => {
    const bones = await product("bones");
    const onion = await product("onion");
    const soup = await product("soup", "PREPPED", "l");
    await stock(bones, 10, 50);
    await stock(onion, 5, 30);

    const doc = await produce([[bones, 8], [onion, 2]], [[soup, 20]]);

    expect(doc.kind).toBe("PRODUCE");
    expect(doc.pdNumber).toMatch(/^THL-PD-\d{4}$/);
    expect(doc.items.filter((i) => i.role === "INPUT")).toHaveLength(2);
    expect(num(doc.items.find((i) => i.role === "OUTPUT")!.valueSharePct!)).toBe(100);

    expect(await balance(bones)).toBe(2);
    expect(await balance(onion)).toBe(3);
    expect(await balance(soup)).toBe(20);

    // The caller names the soup only; the loader walks the bones and onion as
    // helpers. 8 × 50 + 2 × 30 = 460 for 20 L.
    const s = await cost(soup);
    expect(num(s.inventoryValue)).toBe(460);
    expect(num(s.costPerBaseUnit)).toBe(23);
    expect(s.costSource).not.toBe("UNPRICED");
    // And the inputs' own piles lost exactly that.
    expect(num((await cost(bones)).inventoryValue)).toBe(100);
    expect(num((await cost(onion)).inventoryValue)).toBe(90);
  });

  it("P2: pressing twice is one production", async () => {
    const bones = await product("bones2");
    const soup = await product("soup2", "PREPPED", "l");
    await stock(bones, 10, 50);
    const key = randomUUID();
    const a = await produce([[bones, 5]], [[soup, 10]], { submitKey: key });
    const b = await produce([[bones, 5]], [[soup, 10]], { submitKey: key });
    expect(b.id).toBe(a.id);
    expect(await balance(bones)).toBe(5);
    expect(await balance(soup)).toBe(10);
  });

  it("P3: raw stock is bought, not made", async () => {
    const bones = await product("bones3");
    const notPrepped = await product("raw-out");
    await expect(produce([[bones, 1]], [[notPrepped, 1]])).rejects.toBeInstanceOf(
      ProductionOutputNotPreppedError
    );
  });

  it("P4: a production that would loop back into its own input is refused", async () => {
    const bones = await product("bones4");
    const stockP = await product("stock4", "PREPPED", "l");
    const soup = await product("soup4", "PREPPED", "l");
    await stock(bones, 10, 50);
    await produce([[bones, 5]], [[stockP, 10]]);
    await produce([[stockP, 5]], [[soup, 5]]);
    // stock → soup exists; making stock FROM soup would close the loop.
    await expect(produce([[soup, 1]], [[stockP, 1]])).rejects.toBeInstanceOf(ProductionLoopError);
    // The same products at ANOTHER branch have no history, so no loop there.
    await stock(soup, 5, 10, branch2);
    await expect(produce([[soup, 1]], [[stockP, 1]], { branchId: branch2 })).resolves.toBeTruthy();
  });

  it("P5: a trim splits the fish by % value to the satang, and freezes the shares", async () => {
    const fish = await product("fish");
    const fillet = await product("fillet", "PREPPED");
    const belly = await product("belly", "PREPPED");
    const head = await product("head", "PREPPED");
    await stock(fish, 5, 200.002); // ฿1,000.01 for the whole fish
    const trimId = randomUUID();
    await withRlsBypass(async (tx) => {
      await tx.trimRecipe.create({
        data: { id: trimId, tenantId: tenant, parentProductId: fish.id, name: "ปลาทั้งตัว" },
      });
      await tx.trimRecipePart.createMany({
        data: [
          { tenantId: tenant, trimRecipeId: trimId, productId: fillet.id, weightPct: 48, valuePct: 60 },
          { tenantId: tenant, trimRecipeId: trimId, productId: belly.id, weightPct: 18, valuePct: 25 },
          { tenantId: tenant, trimRecipeId: trimId, productId: head.id, weightPct: 12, valuePct: 15 },
          { tenantId: tenant, trimRecipeId: trimId, productId: null, label: "เกล็ด เครื่องใน", weightPct: 22, valuePct: 0 },
        ],
      });
    });

    const doc = await produce([[fish, 5]], [[fillet, 2.4], [belly, 0.9], [head, 0.6]], {
      kind: "TRIM",
      trimRecipeId: trimId,
    });
    const shares = doc.items.filter((i) => i.role === "OUTPUT").map((i) => num(i.valueSharePct!));
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);

    const [cf, cb, ch, cfish] = await Promise.all([cost(fillet), cost(belly), cost(head), cost(fish)]);
    const total = num(cf.inventoryValue) + num(cb.inventoryValue) + num(ch.inventoryValue);
    expect(Math.round(total * 100)).toBe(Math.round(num(cfish.totalOut) * 100));
    expect(num(cb.inventoryValue)).toBe(250);
    expect(num(ch.inventoryValue)).toBe(150);

    // A part the kitchen did not keep this time hands its share to the rest.
    await stock(fish, 5, 200);
    const doc2 = await produce([[fish, 5]], [[fillet, 2.4], [belly, 0.9]], {
      kind: "TRIM",
      trimRecipeId: trimId,
    });
    const s2 = doc2.items.filter((i) => i.role === "OUTPUT").map((i) => num(i.valueSharePct!));
    expect(s2.reduce((a, b) => a + b, 0)).toBe(100);
    expect(s2.sort((a, b) => b - a)[0]).toBeCloseTo(70.5882, 4);

    // The trim must start from its own whole thing and give only its parts.
    const other = await product("not-fish");
    await stock(other, 5, 10);
    await expect(
      produce([[other, 5]], [[fillet, 1]], { kind: "TRIM", trimRecipeId: trimId })
    ).rejects.toBeInstanceOf(TrimRecipeMismatchError);
    const stray = await product("stray", "PREPPED");
    await expect(
      produce([[fish, 1]], [[stray, 1]], { kind: "TRIM", trimRecipeId: trimId })
    ).rejects.toBeInstanceOf(TrimRecipeMismatchError);
  });

  it("P6: a void gives the inputs back and takes the output off — never twice", async () => {
    const bones = await product("bones6");
    const soup = await product("soup6", "PREPPED", "l");
    await stock(bones, 10, 50);
    const doc = await produce([[bones, 8]], [[soup, 16]]);
    const voided = await voidProductionLogic(
      tenant,
      voidProductionInputSchema.parse({ id: doc.id, reason: "บันทึกผิด" }),
      user
    );
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.items.filter((i) => i.reversalOfItemId)).toHaveLength(2);
    expect(await balance(bones)).toBe(10);
    expect(await balance(soup)).toBe(0);
    expect(num((await cost(bones)).inventoryValue)).toBe(500);
    expect(num((await cost(soup)).inventoryValue)).toBe(0);
    await expect(
      voidProductionLogic(tenant, voidProductionInputSchema.parse({ id: doc.id }), user)
    ).rejects.toBeInstanceOf(ProductionAlreadyVoidedError);
  });

  it("P7: a correction to the bones' price reaches the soup — stored nowhere (Q4)", async () => {
    const bones = await product("bones7");
    const soup = await product("soup7", "PREPPED", "l");
    const mv = await stock(bones, 10, 50);
    await produce([[bones, 10]], [[soup, 20]]);
    expect(num((await cost(soup)).inventoryValue)).toBe(500);
    await declareStockCostLogic(
      tenant,
      declareStockCostInputSchema.parse({ movementId: mv.id, unitCost: 60, unitId: unit(bones), note: "แก้ราคา" }),
      user
    );
    expect(num((await cost(soup)).inventoryValue)).toBe(600);
  });

  it("P8: an earlier day posts at that day's START; more than 7 days back is refused", async () => {
    const bones = await product("bones8");
    const soup = await product("soup8", "PREPPED", "l");
    await stock(bones, 10, 50);
    const day = addDays(computeBangkokToday(), -3);
    const doc = await produce([[bones, 1]], [[soup, 2]], { producedOn: day });
    expect(doc.producedAt.getTime()).toBe(bangkokDayStartUtc(day).getTime());

    const tooOld = createProductionInputSchema.safeParse({
      submitKey: randomUUID(),
      branchId: branch,
      kind: "PRODUCE",
      producedOn: addDays(computeBangkokToday(), -8),
      inputs: [{ productId: bones.id, inputQty: 1, inputUnitId: unit(bones) }],
      outputs: [{ productId: soup.id, inputQty: 1, inputUnitId: unit(soup) }],
    });
    expect(tooOld.success).toBe(false);
  });

  it("P9: numbers run per branch", async () => {
    const bones = await product("bones9");
    const soup = await product("soup9", "PREPPED", "l");
    await stock(bones, 10, 50, branch2);
    const a = await produce([[bones, 1]], [[soup, 1]], { branchId: branch2 });
    const b = await produce([[bones, 1]], [[soup, 1]], { branchId: branch2 });
    expect(a.pdNumber.startsWith("ARY-PD-")).toBe(true);
    expect(parseInt(b.pdNumber.slice(-4), 10)).toBe(parseInt(a.pdNumber.slice(-4), 10) + 1);
  });
});
