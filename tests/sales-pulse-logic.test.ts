// ============================================================
// Mise — daily pulse *Logic tests (Sprint 4 Part 20a L3)
// ============================================================
// Real Neon. The invariants:
//   Q1 — the pulse is what the customer PAID, so reconciliation compares it
//        against net + vat + service charge, never against revenue alone
//   Q2 — editable until a detail file lands for that day, then FROZEN
//   Q3 — a rounding difference is silent; a file that covered only part of a day
//        is not, and that is the one thing no Part 19 defence can see
//   Q4 — every dashboard figure says whether it came from detail or from a pulse
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withAdminContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import {
  SalesPulseLockedError,
  BranchNotFoundError,
  getPulseDashboardLogic,
  recordSalesPulseLogic,
  reconcilePulsesLogic,
} from "@/server/sales-pulse";

const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

describe("daily pulse *Logic (one number, and what it catches)", () => {
  let tenantA: string;
  let branchA: string;
  let branchB: string;
  let userA: string;
  let menuA: string;
  let posA: string;

  const today = computeBangkokToday();
  const yesterday = addDays(today, -1);
  const twoDaysAgo = addDays(today, -2);

  /** Write imported sales straight in — the import path itself is Part 19's. */
  const seedDetail = async (
    branchId: string,
    businessDate: Date,
    lines: { net: number; vat: number; sc: number }[]
  ) =>
    withAdminContext(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId, businessDate } },
        create: { tenantId: tenantA, branchId, businessDate },
        update: {},
        select: { id: true },
      });
      const batch = await tx.salesImportBatch.create({
        data: {
          tenantId: tenantA,
          branchId,
          posIntegrationId: posA,
          profileId: (
            await tx.salesImportProfile.findFirstOrThrow({ where: { tenantId: tenantA } })
          ).id,
          fileName: "seed.csv",
          status: "COMMITTED",
          committedAt: new Date(),
          rowCount: lines.length,
          coveredFrom: businessDate,
          coveredTo: businessDate,
          uploadedBy: userA,
        },
        select: { id: true },
      });
      await tx.salesLine.createMany({
        data: lines.map((l) => ({
          tenantId: tenantA,
          branchId,
          businessDate,
          salesDayId: day.id,
          importBatchId: batch.id,
          menuId: menuA,
          qty: new Prisma.Decimal(1),
          grossAmount: new Prisma.Decimal(l.net),
          discountAmount: new Prisma.Decimal(0),
          netAmount: new Prisma.Decimal(l.net),
          serviceChargeAmount: new Prisma.Decimal(l.sc),
          vatAmount: new Prisma.Decimal(l.vat),
        })),
      });
      await tx.salesDay.update({ where: { id: day.id }, data: { currentBatchId: batch.id } });
      return day.id;
    });

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Pulse Test Tenant" } });
      tenantA = t.id;
      const [b1, b2] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } }),
      ]);
      branchA = b1.id;
      branchB = b2.id;
      const u = await tx.user.create({
        data: { email: `pulse-${randomUUID()}@example.com`, name: "แคชเชียร์" },
      });
      userA = u.id;
      const pos = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: b1.id, posType: "CUSTOM", name: "POS" },
      });
      posA = pos.id;
      await tx.salesImportProfile.create({
        data: {
          tenantId: t.id,
          posIntegrationId: pos.id,
          name: "seed",
          fileKind: "DAILY_SUMMARY",
          encoding: "UTF8",
          dateFormat: "dd/MM/yyyy",
          isBuddhistYear: true,
          headerSignature: "seedsig",
          columnMap: { businessDate: 0, menuName: 1, qty: 2, netAmount: 3 },
          amountsIncludeVat: false,
          amountsIncludeServiceCharge: false,
        },
      });
      const m = await tx.menu.create({
        data: { tenantId: t.id, source: "POS", posIntegrationId: pos.id, name: "ผัดกะเพรา" },
      });
      menuA = m.id;
    });
  });

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  // ------------------------------------------------------------
  // Recording
  // ------------------------------------------------------------

  it("P1: a pulse creates the day it belongs to, before any file exists for it", async () => {
    const r = await recordSalesPulseLogic(tenantA, userA, {
      branchId: branchB,
      businessDate: twoDaysAgo,
      amount: 42800,
      note: null,
    });
    expect(num(r.amount)).toBe(42800);
    expect(r.replacedPrevious).toBe(false);

    const day = await withAdminContext((tx) =>
      tx.salesDay.findUniqueOrThrow({
        where: { branchId_businessDate: { branchId: branchB, businessDate: twoDaysAgo } },
      })
    );
    expect(day.pulseSource).toBe("MANUAL");
    expect(day.pulseRecordedBy).toBe(userA);
    // The day exists with no detail at all — ordinary, not missing data.
    expect(day.currentBatchId).toBeNull();
  });

  it("P2: a typo is correctable while the day is still only a pulse", async () => {
    await recordSalesPulseLogic(tenantA, userA, {
      branchId: branchB,
      businessDate: yesterday,
      amount: 4000,
      note: null,
    });
    const fixed = await recordSalesPulseLogic(tenantA, userA, {
      branchId: branchB,
      businessDate: yesterday,
      amount: 40000,
      note: "คีย์ผิด แก้แล้ว",
    });
    expect(num(fixed.amount)).toBe(40000);
    expect(fixed.replacedPrevious).toBe(true);
  });

  it("P3: the note survives — the explanation is worth more than the detection", async () => {
    const day = await withAdminContext((tx) =>
      tx.salesDay.findUniqueOrThrow({
        where: { branchId_businessDate: { branchId: branchB, businessDate: yesterday } },
      })
    );
    expect(day.pulseNote).toBe("คีย์ผิด แก้แล้ว");
  });

  it("P4: a branch that is not this tenant's is refused", async () => {
    await expect(
      recordSalesPulseLogic(tenantA, userA, {
        branchId: randomUUID(),
        businessDate: today,
        amount: 100,
        note: null,
      })
    ).rejects.toBeInstanceOf(BranchNotFoundError);
  });

  // ------------------------------------------------------------
  // The lock
  // ------------------------------------------------------------

  it("P5: once a detail file lands, the pulse FREEZES — it is evidence now", async () => {
    await recordSalesPulseLogic(tenantA, userA, {
      branchId: branchA,
      businessDate: twoDaysAgo,
      amount: 40000,
      note: null,
    });
    await seedDetail(branchA, twoDaysAgo, [{ net: 35000, vat: 2450, sc: 2550 }]);

    // If this were editable, the fastest way to clear a mismatch warning would be
    // to edit the pulse until it agreed — which destroys the only reason to keep it.
    await expect(
      recordSalesPulseLogic(tenantA, userA, {
        branchId: branchA,
        businessDate: twoDaysAgo,
        amount: 40000,
        note: null,
      })
    ).rejects.toBeInstanceOf(SalesPulseLockedError);
  });

  it("P6: the refusal carries both numbers, because that is the actual answer", async () => {
    try {
      await recordSalesPulseLogic(tenantA, userA, {
        branchId: branchA,
        businessDate: twoDaysAgo,
        amount: 1,
        note: null,
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SalesPulseLockedError);
      const err = e as SalesPulseLockedError;
      expect(num(err.pulseAmount)).toBe(40000);
      expect(num(err.detailAmount)).toBe(40000); // 35000 + 2450 + 2550
    }
  });

  // ------------------------------------------------------------
  // Reconciliation
  // ------------------------------------------------------------

  it("P7: the comparison uses what the CUSTOMER PAID, not revenue", async () => {
    // Revenue for that day is 35,000; the till said 40,000. Comparing against
    // revenue would show a 5,000 gap on a day that reconciles perfectly.
    const r = await reconcilePulsesLogic(tenantA, branchA, [twoDaysAgo]);
    expect(r).toHaveLength(1);
    expect(num(r[0].detailAmount)).toBe(40000);
    expect(num(r[0].difference)).toBe(0);
    expect(r[0].isMismatch).toBe(false);
  });

  it("P8: a file that covered only part of the day is caught — nothing else can see it", async () => {
    // Every row in such a file is real, the header matches, no cell is blank and
    // every menu resolves. It is merely missing the evening.
    await recordSalesPulseLogic(tenantA, userA, {
      branchId: branchA,
      businessDate: yesterday,
      amount: 40000,
      note: null,
    });
    await seedDetail(branchA, yesterday, [{ net: 26000, vat: 1820, sc: 1900 }]); // ~29,720

    const r = await reconcilePulsesLogic(tenantA, branchA, [yesterday]);
    expect(r[0].isMismatch).toBe(true);
    expect(num(r[0].difference)).toBeLessThan(0); // the file is SHORT of the till
  });

  it("P9: a day with no pulse is absent from the result, not a mismatch", async () => {
    // Inventing a zero to compare against would manufacture a mismatch out of an
    // ordinary gap.
    const noPulseDay = addDays(today, -3);
    await seedDetail(branchA, noPulseDay, [{ net: 1000, vat: 70, sc: 0 }]);
    const r = await reconcilePulsesLogic(tenantA, branchA, [noPulseDay]);
    expect(r).toHaveLength(0);
  });

  // ------------------------------------------------------------
  // The dashboard
  // ------------------------------------------------------------

  it("P10: detail wins where it exists, the pulse fills the gap, and both say which", async () => {
    const d = await getPulseDashboardLogic(tenantA);
    const a = d.branches.find((b) => b.branchId === branchA)!;
    const b = d.branches.find((b) => b.branchId === branchB)!;

    // branchA has an imported file for yesterday.
    expect(a.yesterday.source).toBe("DETAIL");
    // branchB has only a typed number.
    expect(b.yesterday.source).toBe("PULSE");
    expect(num(b.yesterday.amount)).toBe(40000);
  });

  it("P11: a day with neither says so rather than showing a zero", async () => {
    const d = await getPulseDashboardLogic(tenantA);
    const b = d.branches.find((x) => x.branchId === branchB)!;
    expect(b.today.amount).toBeNull();
    expect(b.today.source).toBeNull();
    expect(b.todayNeedsPulse).toBe(true);
  });

  it("P12: the business-wide line is an explicit roll-up, and says what it is missing", async () => {
    const d = await getPulseDashboardLogic(tenantA);
    const expected = d.branches.reduce(
      (sum, r) => sum + (r.yesterday.amount?.toNumber() ?? 0),
      0
    );
    expect(d.yesterdayTotal.toNumber()).toBe(expected);
    expect(d.branchesMissingToday).toBe(d.branches.filter((r) => r.today.amount === null).length);
  });

  it("P13: the seven-day window counts only the days that have a figure", async () => {
    const d = await getPulseDashboardLogic(tenantA, { branchId: branchB });
    const b = d.branches[0];
    // branchB has yesterday and two days ago, and nothing else in the window.
    expect(b.last7DaysWithFigure).toBe(2);
    expect(b.last7Total.toNumber()).toBe(40000 + 42800);
  });

  it("P14: asking about one branch returns one branch", async () => {
    const d = await getPulseDashboardLogic(tenantA, { branchId: branchA });
    expect(d.branches).toHaveLength(1);
    expect(d.branches[0].branchId).toBe(branchA);
  });
});
