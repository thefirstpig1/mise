// ============================================================
// คิดครัว — later imports find their format from the file's header (Kong 2026-11-02, คิวข้อ 11)
// ============================================================
// "หลังจากนั้นก็คืออัปโหลดไฟล์ได้เลย". The import screen no longer asks which
// format: the branch's formats are tried, each with ITS OWN encoding, and
// only one whose header signature IS the file's is used. Pinned against the
// real database because the scoping (this branch, not deleted) lives in the
// query.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withRlsBypass } from "@/lib/db-admin";
import { computeHeaderSignature } from "@/lib/sales-file";
import { matchSalesProfilesLogic } from "@/server/sales-setup";

const HEADER = ["วันที่", "เมนู", "จำนวน", "ยอดสุทธิ"];
const SIG = computeHeaderSignature(HEADER);
const ROW = ["01/10/2569", "ผัดกะเพรา", "1", "60"];

const utf8 = (rows: string[][]) => new TextEncoder().encode(rows.map((r) => r.join(",")).join("\n") + "\n");
/** Thai Excel's TIS-620: U+0E01–U+0E5B are one byte each at 0xA1–0xFB. */
const tis620 = (rows: string[][]) => {
  const text = rows.map((r) => r.join(",")).join("\n") + "\n";
  return Uint8Array.from([...text].map((ch) => {
    const c = ch.codePointAt(0)!;
    return c >= 0x0e01 && c <= 0x0e5b ? c - 0x0e01 + 0xa1 : c;
  }));
};

describe("matchSalesProfilesLogic", () => {
  let tenantId: string;
  let branchA: string;
  let branchB: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Profile Match Test Tenant" } });
      tenantId = t.id;
      const [a, b] = await Promise.all([
        tx.branch.create({ data: { tenantId, name: "สาขาเอ", code: "PMA" } }),
        tx.branch.create({ data: { tenantId, name: "สาขาบี", code: "PMB" } }),
      ]);
      branchA = a.id;
      branchB = b.id;
      const [posA, posB] = await Promise.all([
        tx.posIntegration.create({ data: { tenantId, branchId: a.id, posType: "FOODSTORY", name: "FoodStory" } }),
        tx.posIntegration.create({ data: { tenantId, branchId: b.id, posType: "OCHA", name: "Ocha" } }),
      ]);
      const make = (key: string, posIntegrationId: string, encoding: "UTF8" | "TIS620", createdAt: string, deleted = false) =>
        tx.salesImportProfile
          .create({
            data: {
              tenantId,
              posIntegrationId,
              name: key,
              fileKind: "DAILY_SUMMARY",
              encoding,
              dateFormat: "dd/MM/yyyy",
              isBuddhistYear: true,
              headerSignature: SIG,
              columnMap: { businessDate: 0, menuName: 1, qty: 2, netAmount: 3 },
              amountsIncludeVat: false,
              amountsIncludeServiceCharge: false,
              createdAt: new Date(createdAt),
              deletedAt: deleted ? new Date() : null,
            },
          })
          .then((p) => (ids[key] = p.id));
      await make("a-old", posA.id, "UTF8", "2026-10-01T00:00:00Z");
      await make("a-new", posA.id, "UTF8", "2026-10-20T00:00:00Z");
      await make("a-deleted", posA.id, "UTF8", "2026-10-25T00:00:00Z", true);
      await make("b-tis", posB.id, "TIS620", "2026-10-05T00:00:00Z");
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.salesImportProfile.deleteMany({ where: { tenantId } });
      await tx.posIntegration.deleteMany({ where: { tenantId } });
      await tx.branch.deleteMany({ where: { tenantId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    });
  });

  it("PM1: this branch's live formats with the file's header, newest first — never a deleted one", async () => {
    expect(await matchSalesProfilesLogic(tenantId, branchA, utf8([HEADER, ROW]))).toEqual([ids["a-new"], ids["a-old"]]);
  });

  it("PM2: another branch's format is never offered, even with the same header", async () => {
    // Branch B's format reads TIS-620; these UTF-8 bytes do not decode to the same header there.
    expect(await matchSalesProfilesLogic(tenantId, branchB, utf8([HEADER, ROW]))).toEqual([]);
  });

  it("PM3: a TIS-620 file is compared as TIS-620", async () => {
    expect(await matchSalesProfilesLogic(tenantId, branchB, tis620([HEADER, ROW]))).toEqual([ids["b-tis"]]);
  });

  it("PM4: a header with one more column matches nothing", async () => {
    expect(await matchSalesProfilesLogic(tenantId, branchA, utf8([[...HEADER, "ส่วนลด"], [...ROW, "0"]]))).toEqual([]);
  });

  it("PM5: an empty file matches nothing", async () => {
    expect(await matchSalesProfilesLogic(tenantId, branchA, new Uint8Array())).toEqual([]);
  });
});
