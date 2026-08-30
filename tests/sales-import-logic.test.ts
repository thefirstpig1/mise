// ============================================================
// Mise — sales import preview/commit *Logic tests (Sprint 4 Part 19 L3c)
// ============================================================
// Real Neon. The invariants:
//   Q5  — the unit of import is branch × sales day, and re-importing REPLACES a
//         day rather than adding to it · replaced rows are kept, marked
//         superseded, never deleted
//   Q8  — an unknown dish becomes a stub, and the preview said so first
//   D.4 — what gets committed is what was previewed, or the commit is refused
//
// The test that matters most is N5: after a re-import, the old rows are still
// there. In Sprint 5 these rows drive CONSUMPTION into an append-only ledger, so
// deleting a sale would leave stock consumed with no document to point at.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { computeHeaderSignature } from "@/lib/sales-file";
import {
  SalesImportAlreadyCommittedError,
  SalesImportFileRejectedError,
  SalesImportPreviewStaleError,
  commitSalesImportLogic,
  previewCounts,
  previewSalesImportLogic,
} from "@/server/sales-import";
import { confirmMenuAliasLogic } from "@/server/menu";

const HEADER = ["วันที่", "หมวด", "เมนู", "จำนวน", "ยอดสุทธิ"];
const SIG = computeHeaderSignature(HEADER);
const COLUMN_MAP = { businessDate: 0, categoryName: 1, menuName: 2, qty: 3, netAmount: 4 };

const file = (rows: string[][]) =>
  new TextEncoder().encode([HEADER, ...rows].map((r) => r.join(",")).join("\n") + "\n");

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("sales import preview + commit *Logic (a day has one source)", () => {
  let tenantA: string;
  let branchA: string;
  let branchB: string;
  let userA: string;
  let posA: string;
  let profileA: string;

  const preview = (rows: string[][], batchId = randomUUID()) =>
    previewSalesImportLogic(
      tenantA,
      userA,
      { batchId, profileId: profileA, fileName: `sales-${batchId.slice(0, 6)}.csv` },
      file(rows)
    );

  /** Preview then commit, acknowledging exactly what the preview showed. */
  const importFile = async (rows: string[][]) => {
    const batchId = randomUUID();
    const p = await preview(rows, batchId);
    const counts = previewCounts(p);
    const result = await commitSalesImportLogic(
      tenantA,
      userA,
      {
        batchId,
        acknowledgedReplacedDays: counts.days,
        acknowledgedNewMenus: counts.menus,
        acknowledgedNewCategories: counts.categories,
      },
      file(rows)
    );
    return { preview: p, result, batchId };
  };

  const liveLines = (branchId = branchA) =>
    withRlsBypass((tx) =>
      tx.salesLine.findMany({
        where: { tenantId: tenantA, branchId, supersededAt: null },
        orderBy: { businessDate: "asc" },
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Sales Import Test Tenant" } });
      tenantA = t.id;
      const [b1, b2] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } }),
      ]);
      branchA = b1.id;
      branchB = b2.id;
      const u = await tx.user.create({
        data: { email: `imp-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const pos = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: b1.id, posType: "FOODSTORY", name: "เครื่องหน้าร้าน" },
      });
      posA = pos.id;
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId: t.id,
          posIntegrationId: pos.id,
          name: "สรุปรายวัน",
          fileKind: "DAILY_SUMMARY",
          encoding: "UTF8",
          dateFormat: "dd/MM/yyyy",
          isBuddhistYear: true,
          headerSignature: SIG,
          columnMap: COLUMN_MAP,
          amountsIncludeVat: false,
          amountsIncludeServiceCharge: false,
        },
      });
      profileA = prof.id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
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
  // First import
  // ------------------------------------------------------------

  it("N1: a first import writes the day, the dishes and the money", async () => {
    const tag = randomUUID().slice(0, 6);
    const { preview: p, result } = await importFile([
      ["01/01/2568", `อาหาร-${tag}`, `กะเพรา-${tag}`, "3", "300"],
      ["01/01/2568", `อาหาร-${tag}`, `ข้าวผัด-${tag}`, "2", "180"],
    ]);

    expect(p.replacedDays).toHaveLength(0);
    expect(p.newDays).toEqual([day("2025-01-01")]);
    expect(p.newMenus).toHaveLength(2);
    expect(p.newCategories).toEqual([`อาหาร-${tag}`]);
    expect(p.totalNet.toNumber()).toBe(480);

    expect(result.rowsWritten).toBe(2);
    expect(result.daysAdded).toBe(1);
    expect(result.daysReplaced).toBe(0);
    expect(result.stubMenusCreated).toBe(2);
    expect(result.rowsSuperseded).toBe(0);
  });

  it("N2: the batch is marked committed, and the POS records its last sync", async () => {
    const tag = randomUUID().slice(0, 6);
    const { batchId } = await importFile([["02/01/2568", `อาหาร-${tag}`, `ต้มยำ-${tag}`, "1", "150"]]);

    const [batch, pos] = await withRlsBypass(async (tx) => [
      await tx.salesImportBatch.findUniqueOrThrow({ where: { id: batchId } }),
      await tx.posIntegration.findUniqueOrThrow({ where: { id: posA } }),
    ]);
    expect(batch.status).toBe("COMMITTED");
    expect(batch.committedAt).not.toBeNull();
    expect(batch.rowCount).toBe(1);
    expect(batch.coveredFrom).toEqual(day("2025-01-02"));
    expect(pos.lastImportAt).not.toBeNull();
  });

  it("N3: a stub carries the category the file put it in", async () => {
    const tag = randomUUID().slice(0, 6);
    await importFile([["03/01/2568", `ของหวาน-${tag}`, `บัวลอย-${tag}`, "1", "60"]]);

    const menu = await withRlsBypass((tx) =>
      tx.menu.findFirstOrThrow({
        where: { tenantId: tenantA, posMenuName: `บัวลอย-${tag}` },
        include: { menuCategory: true },
      })
    );
    expect(menu.isPosStub).toBe(true);
    expect(menu.menuCategory?.name).toBe(`ของหวาน-${tag}`);
  });

  // ------------------------------------------------------------
  // Re-import replaces the day
  // ------------------------------------------------------------

  it("N4: re-importing a day warns which day, how much, and from which file", async () => {
    const tag = randomUUID().slice(0, 6);
    const first = [["10/01/2568", `อาหาร-${tag}`, `ผัดซีอิ๊ว-${tag}`, "2", "200"]];
    const { batchId } = await importFile(first);

    const second = await preview([["10/01/2568", `อาหาร-${tag}`, `ผัดซีอิ๊ว-${tag}`, "5", "500"]]);
    expect(second.replacedDays).toHaveLength(1);
    expect(second.replacedDays[0].businessDate).toEqual(day("2025-01-10"));
    expect(second.replacedDays[0].existingRows).toBe(1);
    expect(second.replacedDays[0].existingNet.toNumber()).toBe(200);
    expect(second.replacedDays[0].currentFileName).toBe(`sales-${batchId.slice(0, 6)}.csv`);
  });

  it("N5: the replaced rows are KEPT and marked superseded — never deleted", async () => {
    // Sprint 5 posts CONSUMPTION from these rows into an append-only ledger. A
    // deleted sale would leave stock consumed with nothing to point at.
    const tag = randomUUID().slice(0, 6);
    await importFile([["11/01/2568", `อาหาร-${tag}`, `หมูกรอบ-${tag}`, "2", "200"]]);
    const { batchId: secondBatch } = await importFile([
      ["11/01/2568", `อาหาร-${tag}`, `หมูกรอบ-${tag}`, "5", "500"],
    ]);

    const all = await withRlsBypass((tx) =>
      tx.salesLine.findMany({
        where: { tenantId: tenantA, businessDate: day("2025-01-11") },
        orderBy: { createdAt: "asc" },
      })
    );
    expect(all).toHaveLength(2);

    const old = all.find((l) => l.supersededAt !== null);
    const live = all.find((l) => l.supersededAt === null);
    expect(old?.netAmount.toNumber()).toBe(200);
    expect(old?.supersededByBatchId).toBe(secondBatch);
    expect(live?.netAmount.toNumber()).toBe(500);
  });

  it("N6: the day now points at the batch that owns it", async () => {
    const tag = randomUUID().slice(0, 6);
    await importFile([["12/01/2568", `อาหาร-${tag}`, `ยำ-${tag}`, "1", "100"]]);
    const { batchId } = await importFile([["12/01/2568", `อาหาร-${tag}`, `ยำ-${tag}`, "2", "200"]]);

    const salesDay = await withRlsBypass((tx) =>
      tx.salesDay.findFirstOrThrow({
        where: { tenantId: tenantA, branchId: branchA, businessDate: day("2025-01-12") },
      })
    );
    expect(salesDay.currentBatchId).toBe(batchId);
  });

  it("N7: a file spanning known and unknown days replaces only the known ones", async () => {
    const tag = randomUUID().slice(0, 6);
    await importFile([["20/01/2568", `อาหาร-${tag}`, `ลาบ-${tag}`, "1", "100"]]);

    const { preview: p, result } = await importFile([
      ["20/01/2568", `อาหาร-${tag}`, `ลาบ-${tag}`, "2", "200"],
      ["21/01/2568", `อาหาร-${tag}`, `ลาบ-${tag}`, "3", "300"],
      ["22/01/2568", `อาหาร-${tag}`, `ลาบ-${tag}`, "4", "400"],
    ]);

    expect(p.replacedDays.map((d) => d.businessDate)).toEqual([day("2025-01-20")]);
    expect(p.newDays).toEqual([day("2025-01-21"), day("2025-01-22")]);
    expect(result.daysReplaced).toBe(1);
    expect(result.daysAdded).toBe(2);
    expect(result.rowsSuperseded).toBe(1);
  });

  it("N8: a second import of a KNOWN dish creates no new stub", async () => {
    const tag = randomUUID().slice(0, 6);
    await importFile([["23/01/2568", `อาหาร-${tag}`, `แกงเขียวหวาน-${tag}`, "1", "120"]]);
    const { result } = await importFile([
      ["24/01/2568", `อาหาร-${tag}`, `แกงเขียวหวาน-${tag}`, "1", "120"],
    ]);
    expect(result.stubMenusCreated).toBe(0);
    expect(result.categoriesCreated).toBe(0);
  });

  it("N9: a spelling pointed at an existing dish by hand never becomes a stub", async () => {
    const tag = randomUUID().slice(0, 6);
    await importFile([["25/01/2568", `อาหาร-${tag}`, `ปลาทอด-${tag}`, "1", "200"]]);
    const menu = await withRlsBypass((tx) =>
      tx.menu.findFirstOrThrow({ where: { tenantId: tenantA, posMenuName: `ปลาทอด-${tag}` } })
    );

    const oddSpelling = `ปลาทอดราดพริก-${tag}`;
    await confirmMenuAliasLogic(tenantA, userA, {
      posIntegrationId: posA,
      rawName: oddSpelling,
      menuId: menu.id,
    });

    const { preview: p, result } = await importFile([
      ["26/01/2568", `อาหาร-${tag}`, oddSpelling, "1", "200"],
    ]);
    expect(p.newMenus).toHaveLength(0);
    expect(result.stubMenusCreated).toBe(0);

    const lines = await withRlsBypass((tx) =>
      tx.salesLine.findMany({
        where: { tenantId: tenantA, businessDate: day("2025-01-26"), supersededAt: null },
      })
    );
    expect(lines[0].menuId).toBe(menu.id);
    expect(lines[0].posMenuName).toBe(oddSpelling);
  });

  // ------------------------------------------------------------
  // What is committed is what was previewed
  // ------------------------------------------------------------

  it("N10: acknowledging the wrong counts refuses the commit and writes nothing", async () => {
    const tag = randomUUID().slice(0, 6);
    const rows = [["27/01/2568", `อาหาร-${tag}`, `ข้าวหมูแดง-${tag}`, "1", "90"]];
    const batchId = randomUUID();
    await preview(rows, batchId);

    await expect(
      commitSalesImportLogic(
        tenantA,
        userA,
        {
          batchId,
          acknowledgedReplacedDays: 0,
          acknowledgedNewMenus: 99, // the preview said 1
          acknowledgedNewCategories: 1,
        },
        file(rows)
      )
    ).rejects.toBeInstanceOf(SalesImportPreviewStaleError);

    const lines = await withRlsBypass((tx) =>
      tx.salesLine.count({ where: { tenantId: tenantA, businessDate: day("2025-01-27") } })
    );
    expect(lines).toBe(0);
  });

  it("N11: a committed batch cannot be committed again", async () => {
    const tag = randomUUID().slice(0, 6);
    const rows = [["28/01/2568", `อาหาร-${tag}`, `ก๋วยเตี๋ยว-${tag}`, "1", "60"]];
    const { batchId } = await importFile(rows);

    await expect(
      commitSalesImportLogic(
        tenantA,
        userA,
        {
          batchId,
          acknowledgedReplacedDays: 0,
          acknowledgedNewMenus: 0,
          acknowledgedNewCategories: 0,
        },
        file(rows)
      )
    ).rejects.toBeInstanceOf(SalesImportAlreadyCommittedError);
  });

  // ------------------------------------------------------------
  // Failures are recorded
  // ------------------------------------------------------------

  it("N12: a rejected file leaves a FAILED batch carrying its reasons in Thai", async () => {
    // "Why is Tuesday missing" has to be answerable. The previous system's only
    // record of a failure was a status cell a human could overwrite.
    const batchId = randomUUID();
    const rows = [["29/01/2568", "อาหาร", "ข้าวผัด", "", "100"]];
    await expect(preview(rows, batchId)).rejects.toBeInstanceOf(SalesImportFileRejectedError);

    const batch = await withRlsBypass((tx) =>
      tx.salesImportBatch.findUniqueOrThrow({ where: { id: batchId } })
    );
    expect(batch.status).toBe("FAILED");
    expect(batch.committedAt).toBeNull();
    expect(JSON.stringify(batch.errorLog)).toContain("ระบบไม่เดาว่าเป็น 0");
  });

  it("N13: a fixed file can be re-previewed onto the same batch and then committed", async () => {
    const tag = randomUUID().slice(0, 6);
    const batchId = randomUUID();
    await expect(
      preview([["30/01/2568", `อาหาร-${tag}`, `ผัดไทย-${tag}`, "", "100"]], batchId)
    ).rejects.toBeInstanceOf(SalesImportFileRejectedError);

    const fixed = [["30/01/2568", `อาหาร-${tag}`, `ผัดไทย-${tag}`, "2", "100"]];
    const p = await preview(fixed, batchId);
    const counts = previewCounts(p);
    const result = await commitSalesImportLogic(
      tenantA,
      userA,
      {
        batchId,
        acknowledgedReplacedDays: counts.days,
        acknowledgedNewMenus: counts.menus,
        acknowledgedNewCategories: counts.categories,
      },
      file(fixed)
    );
    expect(result.rowsWritten).toBe(1);
  });

  // ------------------------------------------------------------
  // Money and branches
  // ------------------------------------------------------------

  it("N14: refunds and giveaways import with their own signs intact", async () => {
    const tag = randomUUID().slice(0, 6);
    await importFile([
      ["05/02/2568", `อาหาร-${tag}`, `หมูสะเต๊ะ-${tag}`, "2", "0"],
      ["05/02/2568", `อาหาร-${tag}`, `หมูสะเต๊ะ-${tag}`, "-1", "-90"],
    ]);
    const lines = await withRlsBypass((tx) =>
      tx.salesLine.findMany({
        where: { tenantId: tenantA, businessDate: day("2025-02-05"), supersededAt: null },
        orderBy: { netAmount: "desc" },
      })
    );
    expect(lines.map((l) => l.netAmount.toNumber())).toEqual([0, -90]);
    expect(lines.map((l) => l.qty.toNumber())).toEqual([2, -1]);
  });

  it("N15: two branches keep their own day, even on the same date", async () => {
    // sales_day is UNIQUE(branch_id, business_date), so one branch's re-import
    // can never touch another's figures.
    const tag = randomUUID().slice(0, 6);
    const posB = await withRlsBypass((tx) =>
      tx.posIntegration.create({
        data: { tenantId: tenantA, branchId: branchB, posType: "CUSTOM", name: "อารีย์ POS" },
      })
    );
    const profB = await withRlsBypass((tx) =>
      tx.salesImportProfile.create({
        data: {
          tenantId: tenantA,
          posIntegrationId: posB.id,
          name: "สรุปรายวัน (อารีย์)",
          fileKind: "DAILY_SUMMARY",
          encoding: "UTF8",
          dateFormat: "dd/MM/yyyy",
          isBuddhistYear: true,
          headerSignature: SIG,
          columnMap: COLUMN_MAP,
          amountsIncludeVat: false,
          amountsIncludeServiceCharge: false,
        },
      })
    );

    await importFile([["10/02/2568", `อาหาร-${tag}`, `ข้าวขาหมู-${tag}`, "1", "100"]]);

    const rowsB = [["10/02/2568", `อาหาร-${tag}`, `ข้าวขาหมู-${tag}`, "9", "900"]];
    const batchB = randomUUID();
    const pB = await previewSalesImportLogic(
      tenantA,
      userA,
      { batchId: batchB, profileId: profB.id, fileName: "aree.csv" },
      file(rowsB)
    );
    expect(pB.replacedDays).toHaveLength(0);
    const cB = previewCounts(pB);
    await commitSalesImportLogic(
      tenantA,
      userA,
      {
        batchId: batchB,
        acknowledgedReplacedDays: cB.days,
        acknowledgedNewMenus: cB.menus,
        acknowledgedNewCategories: cB.categories,
      },
      file(rowsB)
    );

    const a = (await liveLines(branchA)).filter(
      (l) => l.businessDate.getTime() === day("2025-02-10").getTime()
    );
    const b = (await liveLines(branchB)).filter(
      (l) => l.businessDate.getTime() === day("2025-02-10").getTime()
    );
    expect(a.map((l) => l.netAmount.toNumber())).toEqual([100]);
    expect(b.map((l) => l.netAmount.toNumber())).toEqual([900]);
  });
});
