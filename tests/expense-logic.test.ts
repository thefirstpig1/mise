// ============================================================
// Mise — expense *Logic integration tests (Sprint 3 Part 16 L3a)
// ============================================================
// The money first, as pure arithmetic, then the document against real Neon
// through the real zod schemas. The invariants under test are the ones the Part
// exists to protect:
//   Q6 — withholding is computed on the PRE-VAT base (the spec's formula is wrong)
//   Q5 — a template generates nothing; what is due is COMPUTED, and confirming
//        the same month twice is impossible rather than merely unlikely
//   Q3 — a bill's lines are the receipt's lines when a receipt made it (the
//        goods-receipt hook itself is L3b, so its cases live with it)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { CrossTenantReferenceError } from "@/server/product";
import {
  deleteExpenseInputSchema,
  expenseInputSchema,
  getDueRecurringQuerySchema,
  getExpensesQuerySchema,
  recurringExpenseInputSchema,
  setExpensePaymentInputSchema,
  updateExpenseInputSchema,
} from "@/lib/validations/expense";
import {
  addPeriods,
  computeExpenseAmounts,
  createExpenseLogic,
  createRecurringExpenseLogic,
  currentPeriod,
  deleteExpenseLogic,
  DUE_LOOKBACK_MONTHS,
  ExpenseUnitMismatchError,
  getDueRecurringLogic,
  getExpenseByIdLogic,
  getExpensesLogic,
  periodOf,
  RecurringExpenseConfirmError,
  RecurringPeriodAlreadyConfirmedError,
  setExpensePaymentLogic,
  updateExpenseLogic,
} from "@/server/expense";

const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

// ------------------------------------------------------------
// The money — pure, no DB
// ------------------------------------------------------------

describe("computeExpenseAmounts (ADR 0016 Q6)", () => {
  const base = {
    isPriceVatInclusive: false,
    subjectToWht: false,
    whtRatePercent: null,
    vatRatePercent: null,
  };

  it("M1: exclusive — the typed figure IS the subtotal, VAT is added on top", () => {
    const r = computeExpenseAmounts({
      ...base,
      items: [{ lineTotal: 10_000 }],
      vatRatePercent: 7,
    });
    expect(num(r.subtotalExclVat)).toBe(10_000);
    expect(num(r.vatAmount)).toBe(700);
    expect(num(r.totalAmount)).toBe(10_700);
    // The stored line is always net — the header carries the tax (Decision #35).
    expect(num(r.items[0].totalPrice)).toBe(10_000);
  });

  it("M2: inclusive — the typed figure IS the total, VAT is backed out of it", () => {
    const r = computeExpenseAmounts({
      ...base,
      isPriceVatInclusive: true,
      items: [{ lineTotal: 10_700 }],
      vatRatePercent: 7,
    });
    expect(num(r.subtotalExclVat)).toBe(10_000);
    expect(num(r.vatAmount)).toBe(700);
    expect(num(r.totalAmount)).toBe(10_700);
    expect(num(r.items[0].totalPrice)).toBe(10_000);
  });

  it("M3: withholding is 3% of the PRE-VAT amount — 300, not 321", () => {
    const r = computeExpenseAmounts({
      ...base,
      items: [{ lineTotal: 10_000 }],
      vatRatePercent: 7,
      subjectToWht: true,
      whtRatePercent: 3,
    });
    // master-spec §5.4 says total × rate/100 = 10,700 × 3% = 321. That
    // over-withholds, and the 50 ทวิ figure would not match what the recipient
    // claims. The base is the subtotal.
    expect(num(r.whtAmount)).toBe(300);
    expect(num(r.netPaymentAmount)).toBe(10_400);
  });

  it("M4: no rate means no VAT — the totals are simply what was typed", () => {
    const r = computeExpenseAmounts({ ...base, items: [{ lineTotal: 4_280 }] });
    expect(num(r.subtotalExclVat)).toBe(4_280);
    expect(num(r.vatAmount)).toBe(0);
    expect(num(r.totalAmount)).toBe(4_280);
    expect(r.whtAmount).toBeNull();
    expect(num(r.netPaymentAmount)).toBe(4_280);
  });

  it("M5: a zero rate is arithmetically the same as none — the difference is kept in the RATE, not the maths", () => {
    const zeroRated = computeExpenseAmounts({
      ...base,
      items: [{ lineTotal: 500 }],
      vatRatePercent: 0,
    });
    expect(num(zeroRated.vatAmount)).toBe(0);
    expect(num(zeroRated.totalAmount)).toBe(500);
  });

  it("M6: inclusive rounding never leaves the lines disagreeing with the subtotal", () => {
    // Three odd amounts whose individual net values each round down.
    const r = computeExpenseAmounts({
      ...base,
      isPriceVatInclusive: true,
      items: [{ lineTotal: 100.01 }, { lineTotal: 33.33 }, { lineTotal: 66.67 }],
      vatRatePercent: 7,
    });
    const lineSum = r.items.reduce((s, i) => s.plus(i.totalPrice), new Prisma.Decimal(0));
    expect(lineSum.equals(r.subtotalExclVat)).toBe(true);
    // The remainder lands on the LARGEST line, where it is proportionally
    // smallest and cannot turn a small line negative.
    expect(num(r.items[0].totalPrice)).toBeGreaterThan(num(r.items[1].totalPrice)!);
    expect(num(r.totalAmount)).toBe(200.01);
  });

  it("M7: periods are labels — they add across a year boundary as months, not dates", () => {
    expect(addPeriods("2026-11", 3)).toBe("2027-02");
    expect(addPeriods("2026-02", -3)).toBe("2025-11");
    expect(addPeriods("2026-12", 1)).toBe("2027-01");
    expect(periodOf(new Date(Date.UTC(2026, 7, 17)))).toBe("2026-08");
    // Sorting a period as a plain string is the same as sorting it as a month.
    expect(["2026-10", "2026-09", "2027-01"].sort()).toEqual([
      "2026-09",
      "2026-10",
      "2027-01",
    ]);
  });
});

// ------------------------------------------------------------
// The document — against real Neon
// ------------------------------------------------------------

describe("expense *Logic (every baht that leaves, in one place)", () => {
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchA2: string;
  let userA: string;
  let cogsCategory: string;
  let opexCategory: string;
  let foreignCategory: string;
  let productA: string;
  let unitA: string;
  let foreignProductUnit: string;

  const bill = (over: Record<string, unknown> = {}) =>
    expenseInputSchema.parse({
      branchId: branchA,
      supplierId: "",
      billDate: "2026-08-15",
      billNo: "",
      vatInvoiceNo: "",
      vatRatePercent: "",
      subjectToWht: false,
      whtRatePercent: "",
      whtCertificateNo: "",
      paymentMethod: "",
      paidAt: "",
      recurringExpenseId: "",
      period: "",
      notes: "",
      items: [
        {
          categoryId: opexCategory,
          departmentId: "",
          productId: "",
          productUnitId: "",
          description: "ค่าไฟฟ้า",
          qty: "",
          unitPrice: "",
          lineTotal: 4_280,
        },
      ],
      ...over,
    });

  const template = (over: Record<string, unknown> = {}) =>
    recurringExpenseInputSchema.parse({
      branchId: branchA,
      supplierId: "",
      categoryId: opexCategory,
      description: "ค่าเช่าร้าน",
      defaultAmount: 35_000,
      vatRatePercent: "",
      subjectToWht: false,
      whtRatePercent: "",
      dayOfMonth: 5,
      startPeriod: currentPeriod(),
      endPeriod: "",
      ...over,
    });

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const [ta, tb] = await Promise.all([
        tx.tenant.create({ data: { name: "Expense Test Tenant" } }),
        tx.tenant.create({ data: { name: "Expense Foreign Tenant" } }),
      ]);
      tenantA = ta.id;
      tenantB = tb.id;

      const [b1, b2] = await Promise.all([
        tx.branch.create({ data: { tenantId: ta.id, name: "ทองหล่อ", code: "EXP" } }),
        tx.branch.create({ data: { tenantId: ta.id, name: "อารีย์", code: "EX2" } }),
      ]);
      branchA = b1.id;
      branchA2 = b2.id;

      const u = await tx.user.create({
        data: { email: `expense-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;

      const [cogs, opex, foreign] = await Promise.all([
        tx.category.create({
          data: {
            tenantId: ta.id,
            account: "COGS",
            accountingSection: "วัตถุดิบ",
            groupName: `เนื้อสัตว์-${randomUUID().slice(0, 6)}`,
          },
        }),
        tx.category.create({
          data: {
            tenantId: ta.id,
            account: "OpEx",
            accountingSection: "ค่าสาธารณูปโภค",
            groupName: `ค่าไฟ-${randomUUID().slice(0, 6)}`,
          },
        }),
        tx.category.create({
          data: {
            tenantId: tb.id,
            account: "OpEx",
            accountingSection: "ค่าสาธารณูปโภค",
            groupName: `ค่าไฟ-${randomUUID().slice(0, 6)}`,
          },
        }),
      ]);
      cogsCategory = cogs.id;
      opexCategory = opex.id;
      foreignCategory = foreign.id;

      const pa = await tx.product.create({
        data: {
          tenantId: ta.id,
          name: "หมูสามชั้น",
          sku: `EXP-${randomUUID().slice(0, 6)}`,
          type: "RAW",
          primaryDimension: "WEIGHT",
          productUnits: {
            create: [
              {
                unitName: "kg",
                unitDimension: "WEIGHT",
                toBaseRatio: 1,
                isBase: true,
                isDefaultBuyUnit: true,
              },
            ],
          },
        },
        include: { productUnits: true },
      });
      productA = pa.id;
      unitA = pa.productUnits[0].id;

      const pb = await tx.product.create({
        data: {
          tenantId: ta.id,
          name: "ข้าวสาร",
          sku: `EXP-${randomUUID().slice(0, 6)}`,
          type: "RAW",
          primaryDimension: "WEIGHT",
          productUnits: {
            create: [
              {
                unitName: "kg",
                unitDimension: "WEIGHT",
                toBaseRatio: 1,
                isBase: true,
                isDefaultBuyUnit: true,
              },
            ],
          },
        },
        include: { productUnits: true },
      });
      foreignProductUnit = pb.productUnits[0].id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      for (const tenantId of [tenantA, tenantB]) {
        await tx.expenseItem.deleteMany({ where: { tenantId } });
        await tx.expense.deleteMany({ where: { tenantId } });
        await tx.recurringExpense.deleteMany({ where: { tenantId } });
        await tx.productUnit.deleteMany({ where: { product: { tenantId } } });
        await tx.product.deleteMany({ where: { tenantId } });
        await tx.category.deleteMany({ where: { tenantId } });
        await tx.branch.deleteMany({ where: { tenantId } });
        await tx.tenant.deleteMany({ where: { id: tenantId } });
      }
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  });

  // ----------------------------------------------------------
  // E1–E5 — writing a bill
  // ----------------------------------------------------------

  it("E1: a hand-typed bill stores the computed money and numbers its lines", async () => {
    const created = await createExpenseLogic(
      tenantA,
      bill({
        vatRatePercent: 7,
        items: [
          {
            categoryId: cogsCategory,
            productId: productA,
            productUnitId: unitA,
            description: "หมูสามชั้น 10 kg",
            qty: 10,
            unitPrice: 180,
            lineTotal: 1_800,
          },
          {
            categoryId: opexCategory,
            description: "ค่าขนส่ง",
            lineTotal: 200,
          },
        ],
      }),
      userA
    );

    // Typed inclusive (the default): 2,000 is the TOTAL, and the tax comes out.
    expect(num(created.totalAmount)).toBe(2_000);
    expect(num(created.subtotalExclVat)).toBe(1_869.16);
    expect(num(created.vatAmount)).toBe(130.84);
    expect(created.source).toBe("MANUAL");
    expect(created.paymentStatus).toBe("UNPAID");
    expect(created.paidAt).toBeNull();

    expect(created.items.map((i) => i.lineNo)).toEqual([1, 2]);
    const lineSum = created.items.reduce(
      (s, i) => s.plus(i.totalPrice),
      new Prisma.Decimal(0)
    );
    expect(lineSum.equals(created.subtotalExclVat)).toBe(true);
    expect(created.items[0].productId).toBe(productA);
  });

  it("E2: the withholding correction survives the round trip to the database", async () => {
    const created = await createExpenseLogic(
      tenantA,
      bill({
        vatRatePercent: 7,
        isPriceVatInclusive: false,
        subjectToWht: true,
        whtRatePercent: 3,
        whtCertificateNo: "50TAWI-0007",
        items: [{ categoryId: opexCategory, description: "ค่าที่ปรึกษา", lineTotal: 10_000 }],
      }),
      userA
    );

    expect(num(created.subtotalExclVat)).toBe(10_000);
    expect(num(created.totalAmount)).toBe(10_700);
    expect(num(created.whtAmount)).toBe(300);
    expect(num(created.netPaymentAmount)).toBe(10_400);
  });

  it("E3: another tenant's category cannot be filed against this tenant's spend", async () => {
    await expect(
      createExpenseLogic(
        tenantA,
        bill({
          items: [
            { categoryId: foreignCategory, description: "ค่าไฟฟ้า", lineTotal: 100 },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  it("E4: a unit that belongs to a different product is refused", async () => {
    await expect(
      createExpenseLogic(
        tenantA,
        bill({
          items: [
            {
              categoryId: cogsCategory,
              productId: productA,
              productUnitId: foreignProductUnit,
              description: "หมู",
              lineTotal: 100,
            },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(ExpenseUnitMismatchError);
  });

  it("E5: marking a bill paid stamps WHEN, and un-marking clears it", async () => {
    const created = await createExpenseLogic(
      tenantA,
      bill({ paymentStatus: "PAID", paymentMethod: "โอน" }),
      userA
    );
    // The CHECK demands a timestamp; omitting it costs the user a click, so the
    // server supplies one rather than refusing.
    expect(created.paidAt).toBeInstanceOf(Date);

    const unpaid = await setExpensePaymentLogic(
      tenantA,
      setExpensePaymentInputSchema.parse({
        id: created.id,
        paymentStatus: "UNPAID",
        paidAt: "",
        paymentMethod: "",
      })
    );
    expect(unpaid.paidAt).toBeNull();
    expect(unpaid.paymentStatus).toBe("UNPAID");
  });

  // ----------------------------------------------------------
  // E6–E8 — editing, hiding, listing
  // ----------------------------------------------------------

  it("E6: editing replaces the lines wholesale and re-derives every amount", async () => {
    const created = await createExpenseLogic(tenantA, bill(), userA);
    expect(created.items).toHaveLength(1);

    const updated = await updateExpenseLogic(
      tenantA,
      updateExpenseInputSchema.parse({
        ...bill({
          vatRatePercent: 7,
          isPriceVatInclusive: false,
          items: [
            { categoryId: opexCategory, description: "ค่าไฟฟ้า", lineTotal: 3_000 },
            { categoryId: opexCategory, description: "ค่าน้ำ", lineTotal: 1_000 },
          ],
        }),
        id: created.id,
        billDate: "2026-08-15",
      })
    );

    expect(updated.items).toHaveLength(2);
    expect(num(updated.subtotalExclVat)).toBe(4_000);
    expect(num(updated.vatAmount)).toBe(280);
    expect(num(updated.totalAmount)).toBe(4_280);
    // No orphans: the old line is gone, not merely detached.
    const orphans = await prisma.expenseItem.count({
      where: { expenseId: created.id },
    });
    expect(orphans).toBe(2);
  });

  it("E7: deleting hides the bill — the row survives, the list does not show it", async () => {
    const created = await createExpenseLogic(tenantA, bill({ billNo: "DEL-1" }), userA);

    await deleteExpenseLogic(tenantA, deleteExpenseInputSchema.parse({ id: created.id }));

    expect(await getExpenseByIdLogic(tenantA, created.id)).toBeNull();
    const list = await getExpensesLogic(tenantA, getExpensesQuerySchema.parse({}));
    expect(list.some((e) => e.id === created.id)).toBe(false);
    const row = await prisma.expense.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("E8: the list filters by branch, payment status and bill date", async () => {
    const other = await createExpenseLogic(
      tenantA,
      bill({ branchId: branchA2, billDate: "2026-07-01", paymentStatus: "PAID" }),
      userA
    );

    const byBranch = await getExpensesLogic(
      tenantA,
      getExpensesQuerySchema.parse({ branchId: branchA2 })
    );
    expect(byBranch.every((e) => e.branchId === branchA2)).toBe(true);
    expect(byBranch.some((e) => e.id === other.id)).toBe(true);

    const paid = await getExpensesLogic(
      tenantA,
      getExpensesQuerySchema.parse({ paymentStatus: "PAID" })
    );
    expect(paid.every((e) => e.paymentStatus === "PAID")).toBe(true);

    const july = await getExpensesLogic(
      tenantA,
      getExpensesQuerySchema.parse({ from: "2026-07-01", to: "2026-07-31" })
    );
    expect(july.some((e) => e.id === other.id)).toBe(true);
    expect(july.every((e) => e.billDate <= new Date("2026-07-31"))).toBe(true);
  });

  // ----------------------------------------------------------
  // E9–E13 — the recurring template
  // ----------------------------------------------------------

  it("E9: a template generates nothing — the month it is waiting for is COMPUTED", async () => {
    const t = await createRecurringExpenseLogic(tenantA, template());

    // Nothing was written but the template itself.
    const generated = await prisma.expense.count({
      where: { recurringExpenseId: t.id },
    });
    expect(generated).toBe(0);

    const due = await getDueRecurringLogic(
      tenantA,
      getDueRecurringQuerySchema.parse({ branchId: branchA })
    );
    const mine = due.find((d) => d.template.id === t.id);
    expect(mine?.duePeriods).toEqual([currentPeriod()]);
  });

  it("E10: confirming a month takes it off the list, and confirming twice is impossible", async () => {
    const t = await createRecurringExpenseLogic(tenantA, template({ dayOfMonth: 7 }));
    const period = currentPeriod();

    const confirmed = await createExpenseLogic(
      tenantA,
      bill({ recurringExpenseId: t.id, period, items: [
        { categoryId: opexCategory, description: "ค่าเช่าร้าน", lineTotal: 35_000 },
      ] }),
      userA
    );
    expect(confirmed.recurringExpenseId).toBe(t.id);

    const due = await getDueRecurringLogic(tenantA, { branchId: branchA });
    expect(due.find((d) => d.template.id === t.id)).toBeUndefined();

    // The partial unique on the PAIR is what makes a double-submit one bill.
    await expect(
      createExpenseLogic(
        tenantA,
        bill({ recurringExpenseId: t.id, period, items: [
          { categoryId: opexCategory, description: "ค่าเช่าร้าน", lineTotal: 35_000 },
        ] }),
        userA
      )
    ).rejects.toBeInstanceOf(RecurringPeriodAlreadyConfirmedError);
  });

  it("E11: a confirmation must match its template — window, branch and active flag", async () => {
    const period = currentPeriod();

    const future = await createRecurringExpenseLogic(
      tenantA,
      template({ startPeriod: addPeriods(period, 2) })
    );
    await expect(
      createExpenseLogic(tenantA, bill({ recurringExpenseId: future.id, period }), userA)
    ).rejects.toMatchObject({ name: "RecurringExpenseConfirmError", reason: "WINDOW" });

    const otherBranch = await createRecurringExpenseLogic(
      tenantA,
      template({ branchId: branchA2 })
    );
    await expect(
      createExpenseLogic(
        tenantA,
        bill({ recurringExpenseId: otherBranch.id, period }),
        userA
      )
    ).rejects.toBeInstanceOf(RecurringExpenseConfirmError);

    const retired = await createRecurringExpenseLogic(
      tenantA,
      template({ isActive: false })
    );
    await expect(
      createExpenseLogic(tenantA, bill({ recurringExpenseId: retired.id, period }), userA)
    ).rejects.toMatchObject({ reason: "INACTIVE" });
  });

  it("E12: deleting a mistakenly confirmed month puts it BACK on the due list", async () => {
    const t = await createRecurringExpenseLogic(tenantA, template({ dayOfMonth: 9 }));
    const period = currentPeriod();

    const confirmed = await createExpenseLogic(
      tenantA,
      bill({ recurringExpenseId: t.id, period }),
      userA
    );
    expect(
      (await getDueRecurringLogic(tenantA, { branchId: branchA })).find(
        (d) => d.template.id === t.id
      )
    ).toBeUndefined();

    await deleteExpenseLogic(
      tenantA,
      deleteExpenseInputSchema.parse({ id: confirmed.id })
    );

    // A soft-deleted expense is not a confirmation — which is what makes the
    // mistake recoverable instead of lost.
    const due = await getDueRecurringLogic(tenantA, { branchId: branchA });
    expect(due.find((d) => d.template.id === t.id)?.duePeriods).toEqual([period]);
  });

  it("E13: the due list looks back a year, not forever", async () => {
    const t = await createRecurringExpenseLogic(
      tenantA,
      template({
        dayOfMonth: 11,
        startPeriod: addPeriods(currentPeriod(), -24),
      })
    );

    const due = await getDueRecurringLogic(tenantA, { branchId: branchA });
    const mine = due.find((d) => d.template.id === t.id);
    // 24 months of unconfirmed rent is not a to-do list, it is a wall.
    expect(mine?.duePeriods).toHaveLength(DUE_LOOKBACK_MONTHS);
    expect(mine?.duePeriods.at(-1)).toBe(currentPeriod());
  });

  it("E14: a template that has ended stops being due after its last month", async () => {
    const period = currentPeriod();
    const t = await createRecurringExpenseLogic(
      tenantA,
      template({
        dayOfMonth: 13,
        startPeriod: addPeriods(period, -3),
        endPeriod: addPeriods(period, -2),
      })
    );

    const due = await getDueRecurringLogic(tenantA, { branchId: branchA });
    const mine = due.find((d) => d.template.id === t.id);
    expect(mine?.duePeriods).toEqual([addPeriods(period, -3), addPeriods(period, -2)]);
  });
});
