// ============================================================
// Mise — menu merging reads (Part 25 L4, ADR 0026)
// ============================================================
// The two reads the merge screen stands on, and the one thing they must NOT do.
//
//   R1  the list carries BOTH ends of every merge, with the branch each came
//       from, and hides revoked rows by default
//   R2  `includeRevoked` shows history, live rows first
//   R3  `winningMenuId` narrows to one dish's spellings
//   R4  a menu is never offered as a candidate to merge with itself
//   R5  a menu already merged into something is not offered — `includeMerged`
//       brings it back, carrying the merge that is in the way
//   R6  a menu that already OWNS spellings is still offered, because a star may
//       grow; it carries the count so the screen can say which role it may take
//   R7  the subject carries its own merge state, so the screen knows before the
//       person presses anything
//   R8  `limit` trims AFTER the exclusions, not before
//   R9  these reads never fold — the merge screen must show both rows, or a
//       merge is something nobody can see or undo
//
// R5 and R8 are the pair that discriminate: a read that filtered nothing would
// pass R8 by accident, and a read that trimmed before filtering would pass R5.
// R9 is verified the way the fold tests are — by folding here on purpose and
// watching it go red.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import {
  menuMergeListQuerySchema,
  mergeCandidatesQuerySchema,
  mergeMenusInputSchema,
  revokeMergeInputSchema,
} from "@/lib/validations/menu-merge";
import { mergeMenusLogic, revokeMergeLogic } from "@/server/menu-merge";
import {
  getMenuMergesLogic,
  getMergeCandidatesLogic,
} from "@/server/menu-merge-read";

describe("menu merging reads (ADR 0026 Q6/Q7)", () => {
  let tenantA: string;
  let userA: string;
  let branchAsok: string;
  let branchPattaya: string;
  let posAsok: string;
  let posPattaya: string;

  const makeMenu = (name: string, posIntegrationId?: string) =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "POS",
          posIntegrationId: posIntegrationId ?? posAsok,
          posMenuId: randomUUID().slice(0, 8),
          name,
        },
        select: { id: true, name: true },
      })
    );

  const merge = (loser: string, winner: string) =>
    mergeMenusLogic(
      tenantA,
      mergeMenusInputSchema.parse({
        submitKey: randomUUID(),
        losingMenuId: loser,
        winningMenuId: winner,
      }),
      userA
    );

  const revoke = (mergeId: string) =>
    revokeMergeLogic(
      tenantA,
      revokeMergeInputSchema.parse({ mergeId, acknowledgePosted: "on" }),
      userA
    );

  const listMerges = (over: Record<string, unknown> = {}) =>
    getMenuMergesLogic(tenantA, menuMergeListQuerySchema.parse(over));

  const candidatesFor = (menuId: string, over: Record<string, unknown> = {}) =>
    getMergeCandidatesLogic(
      tenantA,
      mergeCandidatesQuerySchema.parse({ menuId, ...over })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Merge Read Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: { email: `merge-read-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;

      const asok = await tx.branch.create({
        data: { tenantId: t.id, name: "อโศก", code: "ASK" },
        select: { id: true },
      });
      branchAsok = asok.id;
      const pattaya = await tx.branch.create({
        data: { tenantId: t.id, name: "พัทยา", code: "PTY" },
        select: { id: true },
      });
      branchPattaya = pattaya.id;

      // Two branches, two POS integrations — the shape that makes duplicate
      // menus the DEFAULT rather than an accident (ADR 0026 Context 1).
      const integA = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: asok.id, posType: "CUSTOM", name: "POS อโศก" },
        select: { id: true },
      });
      posAsok = integA.id;
      const integB = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: pattaya.id, posType: "CUSTOM", name: "POS พัทยา" },
        select: { id: true },
      });
      posPattaya = integB.id;
    });
  }, 180_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.menuMerge.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  }, 180_000);

  // ------------------------------------------------------------
  // The list
  // ------------------------------------------------------------

  it("R1: both ends, both branches, and revoked rows hidden", async () => {
    const tag = randomUUID().slice(0, 6);
    const dish = await makeMenu(`ข้าวหมูกรอบ ${tag}`, posAsok);
    const spelling = await makeMenu(`ขาวหมูกรอบ ${tag}`, posPattaya);
    const written = await merge(spelling.id, dish.id);

    const rows = (await listMerges()).filter((m) => m.id === written.id);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.winningMenu.id).toBe(dish.id);
    expect(row.losingMenu.id).toBe(spelling.id);
    // The branch is the reason a multi-branch shop has the duplicate at all
    // (Q7), so it travels with both ends and not just with one.
    expect(row.winningMenu.posIntegration?.branchId).toBe(branchAsok);
    expect(row.losingMenu.posIntegration?.branch.name).toBe("พัทยา");
    expect(row.revokedAt).toBeNull();

    await revoke(written.id);
    const afterRevoke = (await listMerges()).filter((m) => m.id === written.id);
    expect(afterRevoke).toHaveLength(0);
  });

  it("R2: includeRevoked shows history, live rows first", async () => {
    const tag = randomUUID().slice(0, 6);
    const dish = await makeMenu(`ก๋วยเตี๋ยวเรือ ${tag}`);
    const first = await makeMenu(`ก๋วยเตี๋ยวเรีอ ${tag}`);
    const second = await makeMenu(`ก๊วยเตี๋ยวเรือ ${tag}`);

    const revoked = await merge(first.id, dish.id);
    await revoke(revoked.id);
    const live = await merge(second.id, dish.id);

    const mine = (await listMerges({ includeRevoked: "on" })).filter(
      (m) => m.winningMenuId === dish.id
    );
    expect(mine.map((m) => m.id)).toEqual([live.id, revoked.id]);
    // The row is kept, never deleted — that is the whole reason last month's
    // report stays explainable.
    expect(mine[1].revokedBy).toBe(userA);
  });

  it("R3: winningMenuId narrows to one dish's spellings", async () => {
    const tag = randomUUID().slice(0, 6);
    const curry = await makeMenu(`แกงเขียวหวานไก่ ${tag}`);
    const currySpelling = await makeMenu(`แกงเขียวหวาน ไก่ ${tag}`);
    const soup = await makeMenu(`ต้มข่าไก่ ${tag}`);
    const soupSpelling = await makeMenu(`ต้มข่า ไก่ ${tag}`);

    await merge(currySpelling.id, curry.id);
    await merge(soupSpelling.id, soup.id);

    const rows = await listMerges({ winningMenuId: curry.id });
    expect(rows.map((m) => m.losingMenuId)).toEqual([currySpelling.id]);
  });

  // ------------------------------------------------------------
  // Candidates
  // ------------------------------------------------------------

  it("R4: a menu is never offered as a candidate to merge with itself", async () => {
    const tag = randomUUID().slice(0, 6);
    const dish = await makeMenu(`ผัดซีอิ๊วหมู ${tag}`);
    const spelling = await makeMenu(`ผัดชีอิ๊วหมู ${tag}`);

    const { subject, candidates } = await candidatesFor(dish.id);
    expect(subject.id).toBe(dish.id);
    expect(subject.branchName).toBe("อโศก");
    // It scores 1.0 against its own name and would otherwise sit at the top of
    // every list.
    expect(candidates.map((c) => c.id)).not.toContain(dish.id);
    expect(candidates.map((c) => c.id)).toContain(spelling.id);
  });

  it("R5: a menu already merged is not offered; includeMerged brings it back", async () => {
    const tag = randomUUID().slice(0, 6);
    const dish = await makeMenu(`ข้าวขาหมู ${tag}`);
    const spelling = await makeMenu(`ขาวขาหมู ${tag}`);
    const third = await makeMenu(`ข้าวขาหมู พิเศษ ${tag}`);

    await merge(spelling.id, dish.id);

    const plain = await candidatesFor(third.id);
    expect(plain.candidates.map((c) => c.id)).toContain(dish.id);
    // Offering it would invite the chain Q4 forbids, and picking it would
    // collide with `menu_merge_live_losing_unique` anyway.
    expect(plain.candidates.map((c) => c.id)).not.toContain(spelling.id);

    const withMerged = await candidatesFor(third.id, { includeMerged: "on" });
    const shown = withMerged.candidates.find((c) => c.id === spelling.id);
    expect(shown).toBeDefined();
    expect(shown!.mergedIntoMenuId).toBe(dish.id);
  });

  it("R6: a menu that already owns spellings is still offered, and says so", async () => {
    const tag = randomUUID().slice(0, 6);
    const dish = await makeMenu(`หมูสะเต๊ะ ${tag}`);
    const spellingOne = await makeMenu(`หมูสเต๊ะ ${tag}`);
    const spellingTwo = await makeMenu(`หมูสะเต๊ะย่าง ${tag}`);

    await merge(spellingOne.id, dish.id);

    // Merging the third branch in is the ordinary case; hiding the winner would
    // push people into starting a second star for the same dish.
    const { candidates } = await candidatesFor(spellingTwo.id);
    const winner = candidates.find((c) => c.id === dish.id);
    expect(winner).toBeDefined();
    expect(winner!.spellingCount).toBe(1);
    expect(winner!.mergedIntoMenuId).toBeNull();
  });

  it("R7: the subject carries its own merge state", async () => {
    const tag = randomUUID().slice(0, 6);
    const dish = await makeMenu(`ปลาทอดน้ำปลา ${tag}`);
    const spelling = await makeMenu(`ปลาทอดนํ้าปลา ${tag}`);
    await merge(spelling.id, dish.id);

    const asLoser = await candidatesFor(spelling.id);
    expect(asLoser.subject.mergedIntoMenuId).toBe(dish.id);
    expect(asLoser.subject.spellingCount).toBe(0);

    const asWinner = await candidatesFor(dish.id);
    expect(asWinner.subject.mergedIntoMenuId).toBeNull();
    expect(asWinner.subject.spellingCount).toBe(1);
  });

  it("R8: limit trims AFTER the exclusions, not before", async () => {
    const tag = randomUUID().slice(0, 6);
    const subject = await makeMenu(`ยำวุ้นเส้นทะเล ${tag}`);
    const a = await makeMenu(`ยำวุ้นเส้นทะเล พิเศษ ${tag}`);
    const b = await makeMenu(`ยำวุ้นเส้นทะเลรวม ${tag}`);
    const alreadyMerged = await makeMenu(`ยำวุ้นเส้น ทะเล ${tag}`);

    await merge(alreadyMerged.id, a.id);

    const { candidates } = await candidatesFor(subject.id, { limit: 2 });
    // Two rows, not one: the excluded menu must not have eaten a slot, and the
    // subject itself must not have eaten the other.
    expect(candidates).toHaveLength(2);
    const ids = candidates.map((c) => c.id);
    expect(ids).not.toContain(subject.id);
    expect(ids).not.toContain(alreadyMerged.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  it("R9: the merge screen's reads never fold — both rows stay two rows", async () => {
    const tag = randomUUID().slice(0, 6);
    const dish = await makeMenu(`ไก่ทอดกระเทียม ${tag}`);
    const spelling = await makeMenu(`ไก่ทอดกระเทียมพริกไทย ${tag}`);
    await merge(spelling.id, dish.id);

    // Asked about the LOSER, the answer is still about the loser. A fold here
    // would silently answer about the winner instead — and the row the person
    // came to un-merge would be the one row they could not see.
    const { subject } = await candidatesFor(spelling.id);
    expect(subject.id).toBe(spelling.id);
    expect(subject.name).toBe(spelling.name);

    // And the list still has two distinct menu ids on the one row.
    const rows = await listMerges({ winningMenuId: dish.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].losingMenu.id).not.toBe(rows[0].winningMenu.id);
  });
});
