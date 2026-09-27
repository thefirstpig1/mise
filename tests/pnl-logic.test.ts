// ============================================================
// Mise — กำไรสุทธิ (Part 35 L3)
// ============================================================
// The P&L owns no cost arithmetic (src/server/pnl.ts header): these pin the
// few things it DOES decide — how branches add up, when a figure is unknown
// rather than zero, and that its expense breakdown is the same money /cost
// counts.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants } from "./support/sweep";
import { consolidate, getPnlLogic, narrowReach } from "@/server/pnl";
import { getBranchCostSummaryLogic, type BranchCostSummary } from "@/server/stock-cost";
import { expenseInputSchema } from "@/lib/validations/expense";
import { createExpenseLogic } from "@/server/expense";

const D = (n: number | string) => new Prisma.Decimal(n);
const FROM = new Date("2026-08-01T00:00:00.000Z");
const TO = new Date("2026-08-31T00:00:00.000Z");

/** A /cost row with only the fields the P&L reads filled in. */
function row(over: Partial<BranchCostSummary> & { branchId: string }): BranchCostSummary {
  return {
    branchName: over.branchId,
    branchCode: null,
    cogsSpend: D(0),
    opexSpend: D(0),
    inventoryValue: D(0),
    wasteValue: D(0),
    varianceValue: D(0),
    excessSpend: D(0),
    negativeStockProducts: 0,
    unpricedProducts: 0,
    revenue: null,
    grossProfit: null,
    grossProfitMethod: "PERIODIC_INVENTORY",
    cogsSold: null,
    consumptionCoveredNetAmount: D(0),
    consumptionDaysPosted: 0,
    salesDaysInPeriod: 0,
    ...over,
  } as BranchCostSummary;
}

describe("consolidate — how branches add up", () => {
  it("net = gross − opex, and cogs = revenue − gross, summed over branches", () => {
    const p = consolidate(
      [
        row({ branchId: "A", revenue: D(100000), grossProfit: D(65000), opexSpend: D(40000) }),
        row({ branchId: "B", revenue: D(50000), grossProfit: D(30000), opexSpend: D(20000) }),
      ],
      [],
      FROM,
      TO
    );
    expect(p.revenue!.toString()).toBe("150000");
    expect(p.cogs!.toString()).toBe("55000");
    expect(p.grossProfit!.toString()).toBe("95000");
    expect(p.opex.toString()).toBe("60000");
    expect(p.netProfit!.toString()).toBe("35000");
    expect(p.unknownReason).toBeNull();
  });

  it("PL5: a branch that SOLD with unknown gross profit makes the total unknown — never a partial sum", () => {
    const p = consolidate(
      [
        row({ branchId: "A", revenue: D(100000), grossProfit: D(65000), opexSpend: D(40000) }),
        row({ branchId: "B", branchName: "สาขาลาดพร้าว", revenue: D(50000), grossProfit: null, opexSpend: D(20000) }),
      ],
      [],
      FROM,
      TO
    );
    expect(p.grossProfit).toBeNull();
    expect(p.netProfit).toBeNull();
    expect(p.unknownReason).toBe("GROSS_PROFIT_UNKNOWN");
    expect(p.branchesMissingGrossProfit).toEqual(["สาขาลาดพร้าว"]);
    // Revenue is still known and still printed.
    expect(p.revenue!.toString()).toBe("150000");
  });

  it("PL6: a branch with no sales adds its rent to opex and nothing to gross profit", () => {
    const p = consolidate(
      [
        row({ branchId: "A", revenue: D(100000), grossProfit: D(65000), opexSpend: D(40000) }),
        row({ branchId: "B", revenue: null, grossProfit: null, opexSpend: D(15000) }),
      ],
      [],
      FROM,
      TO
    );
    expect(p.grossProfit!.toString()).toBe("65000");
    expect(p.opex.toString()).toBe("55000");
    expect(p.netProfit!.toString()).toBe("10000");
  });

  it("no sales anywhere: revenue and profit are null (not 0), expenses still count", () => {
    const p = consolidate([row({ branchId: "A", opexSpend: D(9000) })], [], FROM, TO);
    expect(p.revenue).toBeNull();
    expect(p.netProfit).toBeNull();
    expect(p.unknownReason).toBe("NO_SALES");
    expect(p.opex.toString()).toBe("9000");
  });

  it("recipe method carries its coverage; periodic does not", () => {
    const recipe = consolidate(
      [
        row({
          branchId: "A",
          grossProfitMethod: "RECIPE_CONSUMPTION",
          revenue: D(200),
          grossProfit: D(120),
          consumptionCoveredNetAmount: D(150),
        }),
      ],
      [],
      FROM,
      TO
    );
    expect(recipe.recipeCoverage).toBe(0.75);
    const periodic = consolidate([row({ branchId: "A", revenue: D(200), grossProfit: D(120) })], [], FROM, TO);
    expect(periodic.recipeCoverage).toBeNull();
  });
});

describe("narrowReach — rule A5 on the dashboard's branch chips", () => {
  it("an owner's selection is used as-is", () => {
    expect(narrowReach({ allBranches: true, allowedBranchIds: [] }, ["x"])).toEqual({
      allBranches: false,
      allowedBranchIds: ["x"],
    });
  });

  it("a manager can never select a branch outside their reach", () => {
    expect(narrowReach({ allBranches: false, allowedBranchIds: ["mine"] }, ["mine", "theirs"])).toEqual({
      allBranches: false,
      allowedBranchIds: ["mine"],
    });
  });

  it("no selection = everything in reach", () => {
    const r = { allBranches: false, allowedBranchIds: ["mine"] };
    expect(narrowReach(r, [])).toBe(r);
  });
});

describe("getPnlLogic against the database", () => {
  let tenantId: string;
  let a: string;
  let b: string;
  let userId: string;

  beforeAll(async () => {
    const t = await prismaBypass.tenant.create({ data: { name: "P35 pnl" } });
    tenantId = t.id;
    a = (await prismaBypass.branch.create({ data: { tenantId, name: "A", code: "A1" } })).id;
    b = (await prismaBypass.branch.create({ data: { tenantId, name: "B", code: "B1" } })).id;
    userId = (await prismaBypass.user.create({ data: { email: `p35-pnl-${Date.now()}@example.com` } })).id;
    const rent = await prismaBypass.category.create({
      data: { tenantId, account: "OpEx", accountingSection: "ค่าเช่า", groupName: "ค่าเช่าร้าน" },
    });
    const power = await prismaBypass.category.create({
      data: { tenantId, account: "OpEx", accountingSection: "สาธารณูปโภค", groupName: "ค่าไฟฟ้า" },
    });
    const bill = (branchId: string, categoryId: string, amount: number) =>
      createExpenseLogic(
        tenantId,
        expenseInputSchema.parse({
          branchId,
          supplierId: null,
          billDate: new Date("2026-08-10T00:00:00.000Z"),
          billNo: null,
          vatInvoiceNo: null,
          vatRatePercent: null,
          isPriceVatInclusive: true,
          subjectToWht: false,
          whtRatePercent: null,
          whtCertificateNo: null,
          paymentMethod: null,
          paidAt: null,
          recurringExpenseId: null,
          period: null,
          notes: null,
          items: [{ categoryId, departmentId: null, productId: null, productUnitId: null, description: "x", qty: null, unitPrice: null, lineTotal: amount }],
        }),
        userId
      );
    await bill(a, rent.id, 30000);
    await bill(a, power.id, 5000);
    await bill(b, rent.id, 20000);
  });

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenantId] });
    await prismaBypass.user.deleteMany({ where: { id: userId } });
  });

  it("the section breakdown is the same money /cost calls opexSpend", async () => {
    const everyone = { allBranches: true, allowedBranchIds: [] };
    const p = await getPnlLogic(tenantId, { from: FROM, to: TO }, everyone);
    const cost = await getBranchCostSummaryLogic(tenantId, { from: FROM, to: TO }, everyone);
    const costOpex = cost.reduce((s, r) => s.plus(r.opexSpend), D(0));
    const sections = p.opexBySection.reduce((s, x) => s.plus(x.amount), D(0));
    expect(p.opex.toString()).toBe(costOpex.toString());
    expect(sections.toString()).toBe(costOpex.toString());
    expect(p.opexBySection.map((s) => s.section)).toEqual(["ค่าเช่า", "สาธารณูปโภค"]);
    expect(p.unknownReason).toBe("NO_SALES");
  });

  it("a manager of branch B sees B's money only, whatever the chips say", async () => {
    const p = await getPnlLogic(tenantId, { from: FROM, to: TO, branchIds: [a, b] }, { allBranches: false, allowedBranchIds: [b] });
    expect(p.branches.map((r) => r.branchId)).toEqual([b]);
    expect(p.opex.toString()).toBe("20000");
  });

  it("switching a branch off takes it out of every figure", async () => {
    const p = await getPnlLogic(tenantId, { from: FROM, to: TO, branchIds: [a] }, { allBranches: true, allowedBranchIds: [] });
    expect(p.opex.toString()).toBe("35000");
    expect(p.opexBySection.find((s) => s.section === "ค่าเช่า")!.amount.toString()).toBe("30000");
  });
});
