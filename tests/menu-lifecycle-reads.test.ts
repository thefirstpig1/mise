// ============================================================
// Mise — what a retired menu changes, and what it must not (Part 27 L3b)
// ============================================================
// ADR 0027 Q2 is one sentence with a long shadow: `is_active` is a claim about
// the FUTURE. Every test here is either "this read changed" or "this read had
// better not have".
//
//   R1  getMenusLogic hides retired menus by default and shows them when asked
//   R2  a retired row carries its LAST SALE DATE — the fact Q3 chose instead of
//       a `deactivated_at` column
//   R3  the date query is skipped when nothing is retired, and a live row never
//       carries one
//   R4  ★ MATCHING NEVER CHANGES — a retired menu still matches its own POS
//       code, because a code that stopped matching kills the next import
//   R5  ★ a dangling ALIAS cannot match, even written straight past the guard
//       (Q8's second line of defence)
//   R6  coverage COUNTS a retired menu in full and only labels it — dropping it
//       would move last month's percentage
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withAdminContext, prisma } from "@/lib/db";
import { computeBangkokToday, addDays } from "@/lib/bangkok-date";
import { getMenusLogic, planMenuResolutionLogic } from "@/server/menu";
import { normalizeMenuName } from "@/lib/sales-file";
import { setMenuActiveLogic } from "@/server/menu-lifecycle";
import { setMenuActiveInputSchema } from "@/lib/validations/menu-lifecycle";
import { getRecipeCoverageLogic } from "@/server/menu-lab-read";

describe("what retiring a menu changes (ADR 0027 L3b)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let batchA: string;
  let posIntegrationA: string;

  const today = computeBangkokToday();

  const makePosMenu = (
    name: string
  ): Promise<{ id: string; name: string; posMenuId: string }> =>
    withAdminContext(async (tx) => {
      const code = `C-${randomUUID().slice(0, 8)}`;
      const m = await tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "POS",
          posIntegrationId: posIntegrationA,
          posMenuId: code,
          name: `${name}-${randomUUID().slice(0, 4)}`,
        },
        select: { id: true, name: true },
      });
      return { ...m, posMenuId: code };
    });

  const retire = (menuId: string) =>
    setMenuActiveLogic(
      tenantA,
      setMenuActiveInputSchema.parse({ menuId, isActive: false })
    );

  const sell = (menuId: string, businessDate: Date, net = 100) =>
    withAdminContext(async (tx) => {
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
        select: { id: true },
      });
    });

  const list = (includeRetired: boolean, search?: string) =>
    getMenusLogic(tenantA, { stubsOnly: false, includeRetired, search });

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Menu Retire Reads Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: { email: `retire-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "อโศก", code: "ASK" },
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
    await withAdminContext(async (tx) => {
      await tx.menuAlias.deleteMany({ where: { tenantId: tenantA } });
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

  // ------------------------------------------------------------
  // The list
  // ------------------------------------------------------------

  it("R1 hides retired menus by default and shows them when asked", async () => {
    const menu = await makePosMenu("R1 ข้าวผัดปู");
    expect((await list(false, menu.name)).map((m) => m.id)).toEqual([menu.id]);

    await retire(menu.id);

    // Hidden by default — safe only because R4 keeps it matching and the
    // preview says so out loud.
    expect(await list(false, menu.name)).toEqual([]);
    // And the merge screen's answer (Q9): every row, always.
    expect((await list(true, menu.name)).map((m) => m.id)).toEqual([menu.id]);
  });

  it("R2 a retired row carries its last sale date", async () => {
    const menu = await makePosMenu("R2 หมูสามชั้น");
    await sell(menu.id, addDays(today, -9));
    await sell(menu.id, addDays(today, -2));
    await retire(menu.id);

    const [row] = await list(true, menu.name);
    // The newest, not the first — "if that date is yesterday, the POS never got
    // the message" only works if it is the LAST one.
    expect(row?.lastSoldAt?.getTime()).toBe(addDays(today, -2).getTime());
  });

  it("R3 a live row never carries a date, and a retired one that never sold is null", async () => {
    const live = await makePosMenu("R3 ปลาทอด");
    await sell(live.id, today);
    // Live rows never print it, so they are never asked — the query is skipped
    // outright when nothing in the page is retired.
    expect((await list(true, live.name))[0]?.lastSoldAt).toBeNull();

    const neverSold = await makePosMenu("R3 ปลานึ่ง");
    await retire(neverSold.id);
    expect((await list(true, neverSold.name))[0]?.lastSoldAt).toBeNull();
  });

  // ------------------------------------------------------------
  // ★ The two that must NOT change
  // ------------------------------------------------------------

  it("R4 a retired menu still matches its own POS code", async () => {
    const menu = await makePosMenu("R4 ต้มข่าไก่");
    await retire(menu.id);

    const plan = await planMenuResolutionLogic(tenantA, posIntegrationA, [
      { code: menu.posMenuId, rawName: menu.name, matchKey: normalizeMenuName(menu.name) },
    ]);

    // If this ever went the other way, the code would fall through to
    // `createStubMenusLogic`'s bare create and collide with
    // `menu_pos_identity_unique` — a P2002 in the middle of the commit, taking
    // down a file with nothing wrong in it. Identity is not lifecycle.
    expect([...plan.matched.values()]).toEqual([menu.id]);
    expect([...plan.matchedVia.values()]).toEqual(["CODE"]);
    expect(plan.unmatched).toEqual([]);
  });

  it("R5 an alias pointing at a deleted menu cannot match", async () => {
    const menu = await makePosMenu("R5 ยำวุ้นเส้น");
    const spelling = `yum-${randomUUID().slice(0, 8)}`;
    await withAdminContext((tx) =>
      tx.menuAlias.create({
        data: {
          tenantId: tenantA,
          posIntegrationId: posIntegrationA,
          normalizedName: spelling,
          rawName: "ยำ วุ้นเส้น",
          menuId: menu.id,
          confirmedBy: userA,
        },
      })
    );

    // Alive: the alias matches, and it outranks NAME.
    const before = await planMenuResolutionLogic(tenantA, posIntegrationA, [
      { code: null, rawName: "ยำ วุ้นเส้น", matchKey: spelling },
    ]);
    expect([...before.matchedVia.values()]).toEqual(["ALIAS"]);

    // Straight past blocker 5, which is the only way to reach this state — the
    // point of a second line of defence is that it holds when the first is gone.
    await withAdminContext((tx) =>
      tx.menu.update({ where: { id: menu.id }, data: { deletedAt: new Date() } })
    );

    const after = await planMenuResolutionLogic(tenantA, posIntegrationA, [
      { code: null, rawName: "ยำ วุ้นเส้น", matchKey: spelling },
    ]);
    // Unmatched becomes a stub, which is recoverable. Matching a dead row would
    // file real money against something no screen will ever show.
    expect(after.matched.size).toBe(0);
    expect(after.unmatched).toHaveLength(1);
  });

  // ------------------------------------------------------------
  // Coverage
  // ------------------------------------------------------------

  it("R6 coverage counts a retired menu in full and only labels it", async () => {
    const kept = await makePosMenu("R6 ขาหมู");
    const retired = await makePosMenu("R6 ขาหมูพะโล้");
    await sell(kept.id, addDays(today, -3), 400);
    await sell(retired.id, addDays(today, -3), 600);

    const before = await getRecipeCoverageLogic(tenantA, {
      branchId: branchA,
      from: addDays(today, -5),
      to: today,
      limit: 50,
      hideWithDrafts: false,
    });

    await retire(retired.id);

    const after = await getRecipeCoverageLogic(tenantA, {
      branchId: branchA,
      from: addDays(today, -5),
      to: today,
      limit: 50,
      hideWithDrafts: false,
    });

    // Pressing เลิกขาย today must not move last month's figure. Dropping the
    // row would shrink the denominator, and the dish somebody just retired is
    // very often the one that sold hardest.
    expect(after.totalRevenue.toString()).toBe(before.totalRevenue.toString());
    expect(after.uncoveredRevenue.toString()).toBe(before.uncoveredRevenue.toString());

    const row = after.rows.find((r) => r.menuId === retired.id);
    expect(row).toBeDefined();
    expect(row?.isRetired).toBe(true);
    expect(after.rows.find((r) => r.menuId === kept.id)?.isRetired).toBe(false);
    // Ranked by revenue exactly as rule M3 says — the label changes nothing.
    expect(after.rows[0]?.menuId).toBe(retired.id);
  });
});
