// ADR 0042 — ปิดร้านประจำวัน: the one required field, nulls stay null, the
// estimate stays an estimate, the window closes, comments only append.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { cashDifference, saveDailyCloseInputSchema } from "@/lib/validations/daily-close";
import {
  DailyCloseDisabledError,
  DailyCloseFutureDateError,
  DailyCloseLockedError,
  PulseRequiredError,
  addCustomerTypeLogic,
  addDailyCommentLogic,
  editableUntil,
  getDailyCloseDayLogic,
  getDailyCloseMonthLogic,
  getDailyCloseSettingsLogic,
  removeCustomerTypeLogic,
  resolveDailyIssueLogic,
  saveDailyCloseLogic,
  setDailyCloseEnabledLogic,
} from "@/server/daily-close";

describe("daily close (ADR 0042)", () => {
  let tenantA: string;
  let branchA: string;
  let userA: string;
  let types: { id: string; name: string }[] = [];
  const today = computeBangkokToday();
  const yesterday = addDays(today, -1);

  const input = (over: Record<string, unknown> = {}) =>
    saveDailyCloseInputSchema.parse({
      branchId: branchA,
      businessDate: today.toISOString().slice(0, 10),
      pulseAmount: "23533.58",
      guestCount: "",
      cashFloat: "",
      cashSales: "",
      cashCounted: "",
      cashNote: "",
      mix: [],
      issues: [],
      ...over,
    });

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Daily Close Tenant" } });
      tenantA = t.id;
      branchA = (await tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARI" } })).id;
      userA = (await tx.user.create({ data: { email: `dc-${randomUUID()}@example.com`, name: "น้องเมย์" } })).id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.dailyComment.deleteMany({ where: { tenantId: tenantA } });
      await tx.dailyIssue.deleteMany({ where: { tenantId: tenantA } });
      await tx.dailyCloseMix.deleteMany({ where: { tenantId: tenantA } });
      await tx.dailyClose.deleteMany({ where: { tenantId: tenantA } });
      await tx.customerType.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  it("DC0: cash short/over exists only when all three figures do", () => {
    expect(cashDifference({ cashFloat: 2000, cashSales: 8450, cashCounted: 10410 })).toBe(-40);
    expect(cashDifference({ cashFloat: 2000, cashSales: null, cashCounted: 10410 })).toBeNull();
    expect(saveDailyCloseInputSchema.safeParse({ ...input(), mix: [{ customerTypeId: randomUUID(), parts: 6 }, { customerTypeId: randomUUID(), parts: 5 }] }).success).toBe(false);
  });

  it("DC1: a shop that has not switched the add-on on cannot close", async () => {
    await expect(saveDailyCloseLogic(tenantA, userA, input())).rejects.toBeInstanceOf(DailyCloseDisabledError);
  });

  it("DC2: switching it on offers starter types; the till total is the one required field", async () => {
    await setDailyCloseEnabledLogic(tenantA, true);
    types = (await getDailyCloseSettingsLogic(tenantA)).types;
    expect(types.map((t) => t.name)).toEqual(["พนักงานออฟฟิศ", "ครอบครัว", "ขาประจำ", "นักท่องเที่ยว"]);

    await expect(saveDailyCloseLogic(tenantA, userA, input({ pulseAmount: "" }))).rejects.toBeInstanceOf(PulseRequiredError);
    await saveDailyCloseLogic(tenantA, userA, input());
    const day = await getDailyCloseDayLogic(tenantA, branchA, today);
    expect(day.pulseAmount).toBe(23533.58);
    // Every blank stays blank — "nobody counted" is not "฿0".
    expect(day.close).toMatchObject({ cashFloat: null, cashSales: null, cashCounted: null, cashNote: null });
    expect(day.guestCount).toBeNull();
    expect(day.editable).toBe(true);
  });

  it("DC3: the estimate is stored in tenths, zero parts dropped; guests and cash saved", async () => {
    const [office, family, regular] = types;
    await saveDailyCloseLogic(
      tenantA,
      userA,
      input({
        guestCount: "142",
        cashFloat: "2,000",
        cashSales: "8450",
        cashCounted: "10410",
        cashNote: "ทอนผิดโต๊ะ 7",
        mix: [
          { customerTypeId: office.id, parts: 4 },
          { customerTypeId: family.id, parts: 3 },
          { customerTypeId: regular.id, parts: 0 },
        ],
      })
    );
    const day = await getDailyCloseDayLogic(tenantA, branchA, today);
    expect(day.guestCount).toBe(142);
    expect(day.guestCountSource).toBe("MANUAL");
    expect(day.close).toMatchObject({ cashFloat: 2000, cashSales: 8450, cashCounted: 10410 });
    expect(day.mix.sort((a, b) => b.parts - a.parts)).toEqual([
      { customerTypeId: office.id, parts: 4 },
      { customerTypeId: family.id, parts: 3 },
    ]);
  });

  it("DC4: the form's issue list IS the list — edits, removals and additions in one save", async () => {
    await saveDailyCloseLogic(
      tenantA,
      userA,
      input({
        issues: [
          { category: "EQUIPMENT", body: "ตู้แช่หลังครัวไม่เย็น", followUp: true },
          { category: "OUT_OF_STOCK", body: "ปลากะพงหมด 19:30", followUp: false },
        ],
      })
    );
    let day = await getDailyCloseDayLogic(tenantA, branchA, today);
    const fridge = day.issues.find((i) => i.category === "EQUIPMENT")!;
    await saveDailyCloseLogic(tenantA, userA, input({ issues: [{ id: fridge.id, category: "EQUIPMENT", body: "ตู้แช่หลังครัว 9°C", followUp: true }] }));
    day = await getDailyCloseDayLogic(tenantA, branchA, today);
    expect(day.issues.map((i) => i.body)).toEqual(["ตู้แช่หลังครัว 9°C"]);
    expect(day.issues[0].id).toBe(fridge.id);
  });

  it("DC5: comments append; resolving records who and is idempotent", async () => {
    const day = await getDailyCloseDayLogic(tenantA, branchA, today);
    await addDailyCommentLogic(tenantA, userA, { dailyCloseId: day.close!.id, body: "โทรช่างแล้ว" });
    await addDailyCommentLogic(tenantA, userA, { dailyCloseId: day.close!.id, body: "ช่างเปลี่ยนคอมเพรสเซอร์แล้ว" });
    await resolveDailyIssueLogic(tenantA, userA, day.issues[0].id);
    const first = (await getDailyCloseDayLogic(tenantA, branchA, today)).issues[0].resolvedAt;
    await resolveDailyIssueLogic(tenantA, userA, day.issues[0].id);
    const after = await getDailyCloseDayLogic(tenantA, branchA, today);
    expect(after.comments.map((c) => c.body)).toEqual(["โทรช่างแล้ว", "ช่างเปลี่ยนคอมเพรสเซอร์แล้ว"]);
    expect(after.issues[0].resolvedAt).toBe(first);
    expect(after.issues[0].resolvedBy).toBe("น้องเมย์");
  });

  it("DC6: editable until 00:00 Bangkok of D+2 — two days back is frozen, tomorrow does not exist yet", async () => {
    expect(editableUntil(yesterday).toISOString()).toBe(new Date(addDays(yesterday, 2).getTime() - 7 * 3_600_000).toISOString());
    const twoBack = addDays(today, -2).toISOString().slice(0, 10);
    await expect(saveDailyCloseLogic(tenantA, userA, input({ businessDate: twoBack }))).rejects.toBeInstanceOf(DailyCloseLockedError);
    const tomorrow = addDays(today, 1).toISOString().slice(0, 10);
    await expect(saveDailyCloseLogic(tenantA, userA, input({ businessDate: tomorrow }))).rejects.toBeInstanceOf(DailyCloseFutureDateError);
  });

  it("DC7: a POS file locks the till total — the close goes through without it and does not touch it", async () => {
    await withRlsBypass(async (tx) => {
      const integ = await tx.posIntegration.create({ data: { tenantId: tenantA, branchId: branchA, posType: "CUSTOM", name: "POS" }, select: { id: true } });
      const prof = await tx.salesImportProfile.create({
        data: { tenantId: tenantA, posIntegrationId: integ.id, name: "x", fileKind: "DAILY_SUMMARY", dateFormat: "yyyy-MM-dd", columnMap: {}, headerSignature: "x", amountsIncludeVat: false, amountsIncludeServiceCharge: false },
        select: { id: true },
      });
      const batch = await tx.salesImportBatch.create({
        data: { tenantId: tenantA, branchId: branchA, posIntegrationId: integ.id, profileId: prof.id, status: "COMMITTED", fileName: "d.csv", uploadedBy: userA, committedAt: new Date() },
        select: { id: true },
      });
      const menu = await tx.menu.create({ data: { tenantId: tenantA, source: "MISE", name: "กะเพรา" }, select: { id: true } });
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId: branchA, businessDate: yesterday } },
        create: { tenantId: tenantA, branchId: branchA, businessDate: yesterday, currentBatchId: batch.id },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: { tenantId: tenantA, branchId: branchA, businessDate: yesterday, salesDayId: day.id, importBatchId: batch.id, menuId: menu.id, qty: 10, grossAmount: 1000, discountAmount: 0, netAmount: 1000, serviceChargeAmount: 0, vatAmount: 70 },
      });
    });
    await saveDailyCloseLogic(tenantA, userA, input({ businessDate: yesterday.toISOString().slice(0, 10), pulseAmount: "", guestCount: "8" }));
    const day = await getDailyCloseDayLogic(tenantA, branchA, yesterday);
    expect(day.pulseLocked).toBe(true);
    expect(day.pulseAmount).toBeNull();
    expect(day.netRevenue).toBe(1000);
    expect(day.guestCount).toBe(8);
  });

  it("DC8: the month — per head, cash only when complete, the mix weighted by each day's guests", async () => {
    const [office, family] = types;
    // Yesterday: 8 guests, all office. Today: 142 guests, 4 office / 3 family.
    await saveDailyCloseLogic(tenantA, userA, input({ businessDate: yesterday.toISOString().slice(0, 10), pulseAmount: "", guestCount: "8", mix: [{ customerTypeId: office.id, parts: 10 }] }));
    // A save sends the whole form (DC4) — today again, with its cash, mix and issue.
    const issues = (await getDailyCloseDayLogic(tenantA, branchA, today)).issues.map((i) => ({ id: i.id, category: i.category, body: i.body, followUp: i.followUp }));
    await saveDailyCloseLogic(
      tenantA,
      userA,
      input({ guestCount: "142", cashFloat: "2000", cashSales: "8450", cashCounted: "10410", issues, mix: [{ customerTypeId: office.id, parts: 4 }, { customerTypeId: family.id, parts: 3 }] })
    );
    const m = await getDailyCloseMonthLogic(tenantA, branchA, yesterday, today);
    const y = m.rows.find((r) => r.date === yesterday.toISOString().slice(0, 10))!;
    expect(y.perHead).toBe(125);
    expect(y.cashDiff).toBeNull();
    const t = m.rows.find((r) => r.date === today.toISOString().slice(0, 10))!;
    expect(t.cashDiff).toBe(-40);
    expect(t.issuesResolved).toBe(1);
    expect(t.comments).toBe(2);
    // office = (0.4×142 + 1.0×8) / (142 + 8) — today's unassigned 3/10 stays "ไม่แน่ใจ"
    const share = (id: string) => m.mix.find((x) => x.customerTypeId === id)!.share;
    expect(share(office.id)).toBeCloseTo(64.8 / 150, 6);
    expect(share(family.id)).toBeCloseTo(42.6 / 150, 6);
    expect(m.mixDays).toBe(2);
  });

  it("DC9: a type used in an estimate is archived, an unused one deleted", async () => {
    const extra = await addCustomerTypeLogic(tenantA, "นักศึกษา");
    await removeCustomerTypeLogic(tenantA, extra.id);
    await removeCustomerTypeLogic(tenantA, types[0].id);
    const left = await withRlsBypass((tx) => tx.customerType.findMany({ where: { tenantId: tenantA }, select: { id: true, archivedAt: true } }));
    expect(left.find((t) => t.id === extra.id)).toBeUndefined();
    expect(left.find((t) => t.id === types[0].id)?.archivedAt).not.toBeNull();
    // The archived type still labels today's sheet, which used it.
    const day = await getDailyCloseDayLogic(tenantA, branchA, today);
    expect(day.customerTypes.find((t) => t.id === types[0].id)?.archived).toBe(true);
  });
});
