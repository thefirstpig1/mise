// ============================================================
// Mise — menu merging writes (Part 25 L3a, ADR 0026)
// ============================================================
// What the two writes do, and the four refusals that keep folding answerable.
//
//   M1  a merge writes ONE row and moves no sale
//   M2  the same submitKey twice writes one row
//   M3  no chains — in both directions
//   M4  a menu already merged says which merge, not "constraint violation"
//   M5  many spellings may share one dish (a star is not a chain)
//   M6  backdating over a posted day refuses once, then goes through
//   M7  backdating over days nothing posted does not refuse at all
//   M8  revoke sets the pair, refuses once where stock already moved, and is
//       idempotent
//   M9  a revoked merge frees the menu to be merged somewhere else
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { mergeMenusInputSchema, revokeMergeInputSchema } from "@/lib/validations/menu-merge";
import {
  MenuAlreadyMergedError,
  MergeAffectsPostedDaysError,
  MergeChainError,
  MenuMergeNotFoundError,
  RevokeAffectsPostedDaysError,
  mergeMenusLogic,
  revokeMergeLogic,
} from "@/server/menu-merge";
import { MenuNotFoundError } from "@/server/menu";

describe("menu merging writes (ADR 0026)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let batchA: string;
  let posIntegrationA: string;

  const today = computeBangkokToday();

  const makeMenu = (name: string) =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "POS",
          posIntegrationId: posIntegrationA,
          posMenuId: randomUUID().slice(0, 8),
          name: `${name}-${randomUUID().slice(0, 4)}`,
        },
        select: { id: true, name: true },
      })
    );

  const sell = (businessDate: Date, menuId: string, net = 100) =>
    withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId: branchA, businessDate } },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          currentBatchId: batchA,
        },
        update: {},
        select: { id: true },
      });
      return tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          salesDayId: day.id,
          importBatchId: batchA,
          menuId,
          qty: 1,
          grossAmount: net,
          discountAmount: 0,
          netAmount: net,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
        select: { id: true, menuId: true },
      });
    });

  /** A run that STANDS — what makes a day "already deducted". */
  const post = (businessDate: Date) =>
    withRlsBypass((tx) =>
      tx.salesConsumptionRun.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          postedAt: new Date(),
          postedBy: userA,
          cancelledSalePolicy: "TREAT_AS_COOKED",
          coveredNetAmount: 0,
          totalNetAmount: 100,
          menusPosted: 0,
          menusSkipped: 1,
        },
        select: { id: true },
      })
    );

  const merge = (over: Record<string, unknown>) =>
    mergeMenusLogic(
      tenantA,
      mergeMenusInputSchema.parse({ submitKey: randomUUID(), ...over }),
      userA
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Menu Merge Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: { email: `merge-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
        select: { id: true },
      });
      branchA = b.id;
      const integ = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: b.id, posType: "CUSTOM", name: "POS" },
        select: { id: true },
      });
      posIntegrationA = integ.id;
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId: t.id,
          posIntegrationId: integ.id,
          name: "รายวัน",
          fileKind: "DAILY_SUMMARY",
          dateFormat: "yyyy-MM-dd",
          columnMap: {},
          headerSignature: `x-${randomUUID().slice(0, 6)}`,
          amountsIncludeVat: false,
          amountsIncludeServiceCharge: false,
        },
        select: { id: true },
      });
      const batch = await tx.salesImportBatch.create({
        data: {
          tenantId: t.id,
          branchId: b.id,
          posIntegrationId: integ.id,
          profileId: prof.id,
          status: "COMMITTED",
          fileName: "day.csv",
          uploadedBy: u.id,
          committedAt: new Date(),
        },
        select: { id: true },
      });
      batchA = batch.id;
    });
  }, 120_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.menuMerge.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionRun.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  }, 120_000);

  it("M1: a merge writes one row and moves no sale", async () => {
    const winner = await makeMenu("M1 ข้าวผัดกุ้ง");
    const loser = await makeMenu("M1 ข้าวผัดกุ้ง(อโศก)");
    const line = await sell(addDays(today, -5), loser.id);

    const row = await merge({
      losingMenuId: loser.id,
      winningMenuId: winner.id,
    });

    expect(row.losingMenuId).toBe(loser.id);
    expect(row.winningMenuId).toBe(winner.id);
    expect(row.effectiveFrom.getTime()).toBe(today.getTime());
    expect(row.revokedAt).toBeNull();

    // THE POINT OF THE WHOLE PART: the sale still says what the file said.
    const after = await withRlsBypass((tx) =>
      tx.salesLine.findFirst({
        where: { id: line.id },
        select: { menuId: true, supersededAt: true },
      })
    );
    expect(after?.menuId).toBe(loser.id);
    expect(after?.supersededAt).toBeNull();

    // And the losing menu is still alive — it has to be, it holds its POS code.
    const stillThere = await withRlsBypass((tx) =>
      tx.menu.findFirst({ where: { id: loser.id }, select: { deletedAt: true } })
    );
    expect(stillThere?.deletedAt).toBeNull();
  });

  it("M2: the same submitKey twice writes one row", async () => {
    const winner = await makeMenu("M2 ต้มยำ");
    const loser = await makeMenu("M2 ต้มยำกุ้ง");
    const key = randomUUID();

    const build = () =>
      mergeMenusInputSchema.parse({
        submitKey: key,
        losingMenuId: loser.id,
        winningMenuId: winner.id,
      });

    const first = await mergeMenusLogic(tenantA, build(), userA);
    const second = await mergeMenusLogic(tenantA, build(), userA);
    expect(second.id).toBe(first.id);

    const count = await withRlsBypass((tx) =>
      tx.menuMerge.count({ where: { tenantId: tenantA, losingMenuId: loser.id } })
    );
    expect(count).toBe(1);
  });

  it("M3: no chains, in either direction", async () => {
    const dish = await makeMenu("M3 กะเพรา");
    const spelling = await makeMenu("M3 กะเพราหมู");
    const third = await makeMenu("M3 กระเพรา");

    await merge({ losingMenuId: spelling.id, winningMenuId: dish.id });

    // A → B where B is already somebody's spelling.
    await expect(
      merge({ losingMenuId: third.id, winningMenuId: spelling.id })
    ).rejects.toThrow(MergeChainError);

    // A → B where A already has spellings of its own.
    await expect(
      merge({ losingMenuId: dish.id, winningMenuId: third.id })
    ).rejects.toThrow(MergeChainError);
  });

  it("M4: a menu already merged names the merge that owns it", async () => {
    const first = await makeMenu("M4 ผัดไทย");
    const second = await makeMenu("M4 ผัดไท");
    const other = await makeMenu("M4 ผัดไทยกุ้งสด");

    const existing = await merge({
      losingMenuId: second.id,
      winningMenuId: first.id,
    });

    // `menu_merge_live_losing_unique` would also refuse this; the point is that
    // a person gets the merge id back rather than a constraint violation.
    const err = await merge({
      losingMenuId: second.id,
      winningMenuId: other.id,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MenuAlreadyMergedError);
    expect((err as MenuAlreadyMergedError).existingMergeId).toBe(existing.id);
    expect((err as MenuAlreadyMergedError).existingWinningMenuId).toBe(first.id);
  });

  it("M5: many spellings may share one dish — a star is not a chain", async () => {
    const dish = await makeMenu("M5 ข้าวมันไก่");
    const asoke = await makeMenu("M5 ข้าวมันไก่ (อโศก)");
    const pattaya = await makeMenu("M5 ข้าวมันไก่ พัทยา");

    await merge({ losingMenuId: asoke.id, winningMenuId: dish.id });
    await merge({ losingMenuId: pattaya.id, winningMenuId: dish.id });

    const losers = await withRlsBypass((tx) =>
      tx.menuMerge.count({
        where: { tenantId: tenantA, winningMenuId: dish.id, revokedAt: null },
      })
    );
    expect(losers).toBe(2);
  });

  it("M6: backdating over a posted day refuses once, then goes through", async () => {
    const dish = await makeMenu("M6 คอหมูย่าง");
    const spelling = await makeMenu("M6 คอหมู");
    const day = addDays(today, -7);
    await sell(day, spelling.id, 250);
    await post(day);

    const err = await merge({
      losingMenuId: spelling.id,
      winningMenuId: dish.id,
      effectiveFrom: addDays(today, -30),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MergeAffectsPostedDaysError);
    expect((err as MergeAffectsPostedDaysError).postedDayCount).toBe(1);
    expect(
      (err as MergeAffectsPostedDaysError).earliestBusinessDate.getTime()
    ).toBe(day.getTime());

    // Nothing was written by the refusal.
    const none = await withRlsBypass((tx) =>
      tx.menuMerge.count({ where: { tenantId: tenantA, losingMenuId: spelling.id } })
    );
    expect(none).toBe(0);

    const row = await merge({
      losingMenuId: spelling.id,
      winningMenuId: dish.id,
      effectiveFrom: addDays(today, -30),
      acknowledgeBackdate: "on",
    });
    expect(row.effectiveFrom.getTime()).toBe(addDays(today, -30).getTime());
  });

  it("M7: backdating over days nothing posted does not refuse", async () => {
    const dish = await makeMenu("M7 ส้มตำ");
    const spelling = await makeMenu("M7 ตำไทย");
    // Sales exist, but the day was never posted — so nothing can change under
    // anybody, and demanding an acknowledgement would be a warning about
    // nothing.
    await sell(addDays(today, -9), spelling.id, 80);

    const row = await merge({
      losingMenuId: spelling.id,
      winningMenuId: dish.id,
      effectiveFrom: addDays(today, -60),
    });
    expect(row.effectiveFrom.getTime()).toBe(addDays(today, -60).getTime());
  });

  it("M8: revoke sets the pair, warns once where stock moved, and is idempotent", async () => {
    const dish = await makeMenu("M8 แกงเขียวหวาน");
    const clean = await makeMenu("M8 เขียวหวานไก่");

    // Nothing posted for this one — revoking is unremarkable.
    const plain = await merge({ losingMenuId: clean.id, winningMenuId: dish.id });
    const revoked = await revokeMergeLogic(
      tenantA,
      revokeMergeInputSchema.parse({ mergeId: plain.id }),
      userA
    );
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.revokedBy).toBe(userA);

    // Revoking again returns the same row rather than moving the timestamp.
    const again = await revokeMergeLogic(
      tenantA,
      revokeMergeInputSchema.parse({ mergeId: plain.id }),
      userA
    );
    expect(again.revokedAt?.getTime()).toBe(revoked.revokedAt?.getTime());

    // And one where a day already deducted while merged.
    const dish2 = await makeMenu("M8 พะแนง");
    const spelling2 = await makeMenu("M8 พแนง");
    const day = addDays(today, -2);
    await sell(day, spelling2.id, 150);
    await post(day);
    const risky = await merge({
      losingMenuId: spelling2.id,
      winningMenuId: dish2.id,
      effectiveFrom: addDays(today, -3),
      acknowledgeBackdate: "on",
    });

    await expect(
      revokeMergeLogic(
        tenantA,
        revokeMergeInputSchema.parse({ mergeId: risky.id }),
        userA
      )
    ).rejects.toThrow(RevokeAffectsPostedDaysError);

    const forced = await revokeMergeLogic(
      tenantA,
      revokeMergeInputSchema.parse({ mergeId: risky.id, acknowledgePosted: "on" }),
      userA
    );
    expect(forced.revokedAt).not.toBeNull();
  });

  it("M9: a revoked merge frees the menu to be merged somewhere else", async () => {
    const first = await makeMenu("M9 หมูกรอบ");
    const second = await makeMenu("M9 หมูกรอบพิเศษ");
    const spelling = await makeMenu("M9 หมูกรอบ(ใหม่)");

    const wrong = await merge({
      losingMenuId: spelling.id,
      winningMenuId: first.id,
    });
    await revokeMergeLogic(
      tenantA,
      revokeMergeInputSchema.parse({ mergeId: wrong.id }),
      userA
    );

    // The partial unique is on `revoked_at IS NULL` precisely so this works —
    // a full unique would let the dead merge hold this menu for ever.
    const right = await merge({
      losingMenuId: spelling.id,
      winningMenuId: second.id,
    });
    expect(right.winningMenuId).toBe(second.id);

    const live = await withRlsBypass((tx) =>
      tx.menuMerge.count({
        where: { tenantId: tenantA, losingMenuId: spelling.id, revokedAt: null },
      })
    );
    expect(live).toBe(1);
  });

  it("M10: a menu that is not this tenant's is refused, and a missing merge too", async () => {
    const mine = await makeMenu("M10 ปลาทอด");
    await expect(
      merge({ losingMenuId: randomUUID(), winningMenuId: mine.id })
    ).rejects.toThrow(MenuNotFoundError);

    await expect(
      revokeMergeLogic(
        tenantA,
        revokeMergeInputSchema.parse({ mergeId: randomUUID() }),
        userA
      )
    ).rejects.toThrow(MenuMergeNotFoundError);
  });
});
