// ============================================================
// Mise — menu resolution *Logic integration tests (Sprint 4 Part 19 L3b)
// ============================================================
// Real Neon, real pg_trgm. The invariants:
//   Q7 — identity is the POS code, not the name · a confirmed alias outranks an
//        exact name match, because a person looked · a similarity score NEVER
//        resolves anything on its own
//   Q8 — an unknown dish becomes a stub rather than failing the file, and the
//        stub is what the "รอตรวจ" queue is made of
//   Q9 — menu categories belong to Mise and merely mirror the POS's names
//
// The test this file exists for is M7: ผัดกะเพราหมู and ผัดกะเพราไก่ score high
// against each other, so any design that let a score resolve a row would merge
// two real dishes — splitting revenue now and consuming the wrong ingredient in
// Sprint 5.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import {
  MenuNotFoundError,
  confirmMenuAliasLogic,
  createStubMenusLogic,
  ensureMenuCategoriesLogic,
  getMenuCategoriesLogic,
  getMenusLogic,
  menuLookupId,
  planMenuResolutionLogic,
  suggestForUnmatchedLogic,
  suggestMenusLogic,
  updateMenuLogic,
  type MenuLookupKey,
} from "@/server/menu";
import { normalizeMenuName } from "@/lib/sales-file";

const key = (over: Partial<MenuLookupKey> = {}): MenuLookupKey => {
  const rawName = over.rawName !== undefined ? over.rawName : "ผัดกะเพราหมู";
  return {
    code: over.code ?? null,
    rawName,
    matchKey: over.matchKey ?? (rawName ? normalizeMenuName(rawName) : ""),
  };
};

describe("menu resolution *Logic (which dish is this row about?)", () => {
  let tenantA: string;
  let branchA: string;
  let userA: string;
  let posA: string;
  let posB: string;

  const makeMenu = (over: {
    name: string;
    posMenuId?: string | null;
    posMenuName?: string | null;
    source?: "POS" | "MISE";
    isPosStub?: boolean;
    deleted?: boolean;
    integrationId?: string;
  }) =>
    withRlsBypass(async (tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: over.source ?? "POS",
          posIntegrationId: (over.source ?? "POS") === "MISE" ? null : (over.integrationId ?? posA),
          posMenuId: (over.source ?? "POS") === "MISE" ? null : (over.posMenuId ?? null),
          name: over.name,
          posMenuName: over.posMenuName ?? null,
          isPosStub: over.isPosStub ?? false,
          deletedAt: over.deleted ? new Date() : null,
        },
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Menu Test Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
      });
      branchA = b.id;
      const u = await tx.user.create({
        data: { email: `menu-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const [p1, p2] = await Promise.all([
        tx.posIntegration.create({
          data: { tenantId: t.id, branchId: b.id, posType: "FOODSTORY", name: "เครื่องหน้าร้าน" },
        }),
        tx.posIntegration.create({
          data: { tenantId: t.id, branchId: b.id, posType: "CUSTOM", name: "ไฟล์ Grab" },
        }),
      ]);
      posA = p1.id;
      posB = p2.id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.menuAlias.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.menuCategory.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  // ------------------------------------------------------------
  // Identity is the code
  // ------------------------------------------------------------

  it("M1: a dish renamed in the POS still resolves, because identity is the code", async () => {
    const m = await makeMenu({
      name: "ผัดกะเพราหมู",
      posMenuId: `M1-${randomUUID().slice(0, 6)}`,
      posMenuName: "ผัดกะเพราหมู",
    });
    const plan = await planMenuResolutionLogic(tenantA, posA, [
      key({ code: m.posMenuId, rawName: "กะเพราหมู (สูตรใหม่)" }),
    ]);
    const id = menuLookupId({ code: m.posMenuId, matchKey: normalizeMenuName("กะเพราหมู (สูตรใหม่)") });
    expect(plan.matched.get(id)).toBe(m.id);
    expect(plan.matchedVia.get(id)).toBe("CODE");
    expect(plan.unmatched).toHaveLength(0);
  });

  it("M2: a stray space resolves by exact name, with no guessing at all", async () => {
    const name = `ข้าวมันไก่-${randomUUID().slice(0, 6)}`;
    const m = await makeMenu({ name });
    const plan = await planMenuResolutionLogic(tenantA, posA, [
      key({ rawName: `  ${name}   ` }),
    ]);
    expect([...plan.matched.values()]).toContain(m.id);
    expect([...plan.matchedVia.values()]).toContain("NAME");
  });

  it("M3: the POS's own last-sent name is also matched, as a fallback", async () => {
    const posName = `ต้มยำกุ้ง-${randomUUID().slice(0, 6)}`;
    const m = await makeMenu({ name: "ต้มยำกุ้ง (ชื่อร้านตั้งเอง)", posMenuName: posName });
    const plan = await planMenuResolutionLogic(tenantA, posA, [key({ rawName: posName })]);
    expect([...plan.matched.values()]).toContain(m.id);
  });

  // ------------------------------------------------------------
  // Aliases
  // ------------------------------------------------------------

  it("M4: an alias resolves a spelling that matches nothing at all", async () => {
    const m = await makeMenu({ name: `หมูกรอบ-${randomUUID().slice(0, 6)}` });
    const raw = `หมูกรอบพิเศษจานใหญ่-${randomUUID().slice(0, 6)}`;
    await confirmMenuAliasLogic(tenantA, userA, {
      posIntegrationId: posA,
      rawName: raw,
      menuId: m.id,
    });
    const plan = await planMenuResolutionLogic(tenantA, posA, [key({ rawName: raw })]);
    expect([...plan.matched.values()]).toContain(m.id);
    expect([...plan.matchedVia.values()]).toContain("ALIAS");
  });

  it("M5: an alias OUTRANKS an exact name match — a person looked, the name is an inference", async () => {
    const shared = `ยำวุ้นเส้น-${randomUUID().slice(0, 6)}`;
    const decoy = await makeMenu({ name: shared });
    const real = await makeMenu({ name: `${shared} (ของจริง)` });
    await confirmMenuAliasLogic(tenantA, userA, {
      posIntegrationId: posA,
      rawName: shared,
      menuId: real.id,
    });

    const plan = await planMenuResolutionLogic(tenantA, posA, [key({ rawName: shared })]);
    const id = menuLookupId({ code: null, matchKey: normalizeMenuName(shared) });
    expect(plan.matched.get(id)).toBe(real.id);
    expect(plan.matched.get(id)).not.toBe(decoy.id);
  });

  it("M6: an alias belongs to ONE POS — the same spelling from another means nothing", async () => {
    const m = await makeMenu({ name: `ปลาทอด-${randomUUID().slice(0, 6)}` });
    const raw = `ปลาทอดน้ำปลาซอสพิเศษ-${randomUUID().slice(0, 6)}`;
    await confirmMenuAliasLogic(tenantA, userA, {
      posIntegrationId: posA,
      rawName: raw,
      menuId: m.id,
    });
    const plan = await planMenuResolutionLogic(tenantA, posB, [key({ rawName: raw })]);
    expect(plan.unmatched.map((u) => u.rawName)).toContain(raw);
  });

  it("M7: re-confirming a spelling onto a different dish overwrites the older decision", async () => {
    const first = await makeMenu({ name: `ไก่ทอด-A-${randomUUID().slice(0, 6)}` });
    const second = await makeMenu({ name: `ไก่ทอด-B-${randomUUID().slice(0, 6)}` });
    const raw = `ไก่ทอดหาดใหญ่พิเศษ-${randomUUID().slice(0, 6)}`;

    await confirmMenuAliasLogic(tenantA, userA, { posIntegrationId: posA, rawName: raw, menuId: first.id });
    await confirmMenuAliasLogic(tenantA, userA, { posIntegrationId: posA, rawName: raw, menuId: second.id });

    const plan = await planMenuResolutionLogic(tenantA, posA, [key({ rawName: raw })]);
    expect([...plan.matched.values()]).toContain(second.id);
    expect([...plan.matched.values()]).not.toContain(first.id);
  });

  it("M8: an alias cannot point at a menu that does not exist", async () => {
    await expect(
      confirmMenuAliasLogic(tenantA, userA, {
        posIntegrationId: posA,
        rawName: "อะไรก็ได้",
        menuId: randomUUID(),
      })
    ).rejects.toBeInstanceOf(MenuNotFoundError);
  });

  // ------------------------------------------------------------
  // ⚠️ The one that the whole matching design exists for
  // ------------------------------------------------------------

  it("M9: two dishes one word apart both suggest, and NEITHER resolves on its own", async () => {
    const tag = randomUUID().slice(0, 6);
    const pork = await makeMenu({ name: `ผัดกะเพราหมูสับ ${tag}` });
    const chicken = await makeMenu({ name: `ผัดกะเพราไก่สับ ${tag}` });

    // They are similar enough that a threshold catching a typo would merge them.
    const hits = await suggestMenusLogic(tenantA, `ผัดกะเพราหมูสับ ${tag}`);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain(pork.id);
    expect(ids).toContain(chicken.id);

    // And resolution still refuses to choose: the spelling below matches neither
    // exactly, so it stays unmatched and a person decides.
    const raw = `ผัดกะเพรา หมูสับ พิเศษ ${tag}`;
    const plan = await planMenuResolutionLogic(tenantA, posA, [key({ rawName: raw })]);
    expect(plan.matched.size).toBe(0);
    expect(plan.unmatched.map((u) => u.rawName)).toEqual([raw]);
  });

  it("M10: an exact match on one of them is still exact — normalising never merges", async () => {
    const tag = randomUUID().slice(0, 6);
    const pork = await makeMenu({ name: `กะเพราหมู ${tag}` });
    await makeMenu({ name: `กะเพราไก่ ${tag}` });
    const plan = await planMenuResolutionLogic(tenantA, posA, [
      key({ rawName: `  กะเพราหมู   ${tag} ` }),
    ]);
    expect([...plan.matched.values()]).toEqual([pork.id]);
  });

  it("M11: a term shorter than three characters suggests nothing", async () => {
    expect(await suggestMenusLogic(tenantA, "ไก")).toEqual([]);
  });

  // ------------------------------------------------------------
  // Unmatched, stubs and categories
  // ------------------------------------------------------------

  it("M12: an unknown dish comes back unmatched, carrying what the file said", async () => {
    const raw = `เมนูใหม่เอี่ยม-${randomUUID().slice(0, 8)}`;
    const plan = await planMenuResolutionLogic(tenantA, posA, [key({ code: "NEW-1", rawName: raw })]);
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.unmatched[0]).toMatchObject({ code: "NEW-1", rawName: raw });
  });

  it("M13: distinct dishes are resolved once, however many rows named them", async () => {
    const m = await makeMenu({ name: `ข้าวผัด-${randomUUID().slice(0, 6)}` });
    const keys = Array.from({ length: 200 }, () => key({ rawName: m.name }));
    const plan = await planMenuResolutionLogic(tenantA, posA, keys);
    expect(plan.matched.size).toBe(1);
  });

  it("M14: a code and a name cannot collide into the same lookup id", async () => {
    expect(menuLookupId({ code: "A", matchKey: "B" })).not.toBe(
      menuLookupId({ code: "AB", matchKey: "" })
    );
  });

  it("M15: stub menus are created with the file's name and marked for the queue", async () => {
    const raw = `ลาบทอด-${randomUUID().slice(0, 8)}`;
    const created = await withRlsBypass(async (tx) => {
      const cats = await ensureMenuCategoriesLogic(tx, tenantA, ["ของทอด"]);
      return createStubMenusLogic(tx, tenantA, posA, [
        {
          code: "STUB-1",
          rawName: raw,
          matchKey: normalizeMenuName(raw),
          menuCategoryId: cats.get("ของทอด") ?? null,
        },
      ]);
    });
    const id = [...created.values()][0];

    const menus = await getMenusLogic(tenantA, { stubsOnly: true, includeRetired: false });
    const stub = menus.find((m) => m.id === id);
    expect(stub).toBeDefined();
    expect(stub?.isPosStub).toBe(true);
    expect(stub?.posMenuName).toBe(raw);
    expect(stub?.name).toBe(raw);
    expect(stub?.menuCategory?.name).toBe("ของทอด");
  });

  it("M16: a stub, once identified, leaves the queue", async () => {
    const raw = `ปีกไก่ทอด-${randomUUID().slice(0, 8)}`;
    const created = await withRlsBypass((tx) =>
      createStubMenusLogic(tx, tenantA, posA, [
        { code: null, rawName: raw, matchKey: normalizeMenuName(raw), menuCategoryId: null },
      ])
    );
    const id = [...created.values()][0];

    const updated = await updateMenuLogic(tenantA, {
      menuId: id,
      name: "ปีกไก่ทอดน้ำปลา",
      menuCategoryId: null,
      primaryDepartmentId: null,
    });
    expect(updated.isPosStub).toBe(false);

    const stubs = await getMenusLogic(tenantA, { stubsOnly: true, includeRetired: false });
    expect(stubs.map((m) => m.id)).not.toContain(id);
  });

  it("M17: categories are created once and reused, matching the POS's name too", async () => {
    const name = `หมวดทดสอบ-${randomUUID().slice(0, 6)}`;
    const first = await withRlsBypass((tx) => ensureMenuCategoriesLogic(tx, tenantA, [name]));
    const second = await withRlsBypass((tx) =>
      ensureMenuCategoriesLogic(tx, tenantA, [`  ${name}  `, name])
    );
    expect(second.get(normalizeMenuName(name))).toBe(first.get(name));

    const all = await getMenuCategoriesLogic(tenantA);
    expect(all.filter((c) => normalizeMenuName(c.name) === normalizeMenuName(name))).toHaveLength(1);
  });

  it("M18: a first import has nothing to suggest against, and does not go looking", async () => {
    const empty = await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Menu Empty Tenant" } });
      return t.id;
    });
    try {
      const out = await suggestForUnmatchedLogic(empty, [
        { code: null, rawName: "ผัดกะเพรา", matchKey: "ผัดกะเพรา" },
      ]);
      expect(out.size).toBe(0);
    } finally {
      await withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: empty } }));
    }
  });

  it("M19: a soft-deleted dish is never matched, and never suggested", async () => {
    const name = `เมนูที่ถูกลบ-${randomUUID().slice(0, 8)}`;
    await makeMenu({ name, deleted: true });
    const plan = await planMenuResolutionLogic(tenantA, posA, [key({ rawName: name })]);
    expect(plan.matched.size).toBe(0);
    const hits = await suggestMenusLogic(tenantA, name);
    expect(hits.map((h) => h.name)).not.toContain(name);
  });

  it("M20: a menu typed into Mise, with no POS at all, still resolves a file's row", async () => {
    // A shop can run without any POS integration; its menus must still match the
    // day a file finally arrives.
    const name = `เมนูสั่งเอง-${randomUUID().slice(0, 8)}`;
    const m = await makeMenu({ name, source: "MISE" });
    const plan = await planMenuResolutionLogic(tenantA, posA, [key({ rawName: name })]);
    expect([...plan.matched.values()]).toContain(m.id);
  });

  it("M21: stubs sort to the top of the menu list — a queue nobody sees is a queue nobody works", async () => {
    const menus = await getMenusLogic(tenantA, { stubsOnly: false, includeRetired: false });
    const firstNonStub = menus.findIndex((m) => !m.isPosStub);
    const lastStub = menus.map((m) => m.isPosStub).lastIndexOf(true);
    if (firstNonStub !== -1 && lastStub !== -1) {
      expect(lastStub).toBeLessThan(firstNonStub);
    }
  });
});
