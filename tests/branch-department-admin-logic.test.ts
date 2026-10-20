// ============================================================
// Mise — adding branches and departments (Part 35 L1)
// ============================================================
// Before this Part neither could be created from the app: a demo shop needed
// both written straight into the database. These pin the rules that make the
// two screens safe to hand to a shop owner.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants } from "./support/sweep";
import { branchInputSchema, cutoffToHHMM, salesDayCutoffSchema, updateBranchInputSchema } from "@/lib/validations/branch";
import {
  departmentInputSchema,
  setDepartmentActiveInputSchema,
  updateDepartmentInputSchema,
} from "@/lib/validations/department";
import {
  BranchCodeTakenError,
  BranchNotFoundError,
  createBranchLogic,
  getAllBranchesForAdminLogic,
  updateBranchLogic,
} from "@/server/branch";
import {
  DefaultDepartmentLockedError,
  DepartmentCodeTakenError,
  createDepartmentLogic,
  getDepartmentsForAdminLogic,
  setDepartmentActiveLogic,
  updateDepartmentLogic,
} from "@/server/department";

const ALL = { allBranches: true, allowedBranchIds: [] };
let tenantA: string;
let tenantB: string;
let mainDeptId: string;

beforeAll(async () => {
  const a = await prismaBypass.tenant.create({ data: { name: "P35 branch/dept A" } });
  const b = await prismaBypass.tenant.create({ data: { name: "P35 branch/dept B" } });
  tenantA = a.id;
  tenantB = b.id;
  await prismaBypass.branch.create({ data: { tenantId: tenantA, name: "สาขาหลัก", code: "MAIN" } });
  const main = await prismaBypass.department.create({
    data: { tenantId: tenantA, name: "Main", code: "MAIN" },
  });
  mainDeptId = main.id;
});

afterAll(async () => {
  await sweepTestTenants(prismaBypass, { ids: [tenantA, tenantB] });
});

describe("branch input", () => {
  it("upper-cases the code and refuses Thai or punctuation in it", () => {
    expect(branchInputSchema.parse({ name: "อารีย์", code: " ari ", address: "" }).code).toBe("ARI");
    expect(branchInputSchema.safeParse({ name: "x", code: "อร", address: null }).success).toBe(false);
    expect(branchInputSchema.safeParse({ name: "x", code: "A-1", address: null }).success).toBe(false);
  });

  it("an edit cannot carry a code at all — the numbering prefix is fixed", () => {
    const parsed = updateBranchInputSchema.parse({
      id: crypto.randomUUID(),
      name: "ใหม่",
      code: "ZZZ",
      address: null,
    });
    expect("code" in parsed).toBe(false);
  });
});

describe("sales-day cut-off input (rule P24, Kong 2026-10-20)", () => {
  it("reads HH:MM as minutes after midnight, and back", () => {
    expect(salesDayCutoffSchema.parse("05:00")).toBe(300);
    expect(salesDayCutoffSchema.parse("2:30")).toBe(150);
    expect(salesDayCutoffSchema.parse("00:00")).toBe(0);
    expect(cutoffToHHMM(300)).toBe("05:00");
    expect(cutoffToHHMM(150)).toBe("02:30");
  });

  it("a blank field means 'not given', never midnight", () => {
    expect(salesDayCutoffSchema.parse("")).toBeUndefined();
    expect(salesDayCutoffSchema.parse(null)).toBeUndefined();
  });

  it("refuses an afternoon cut-off and anything that is not a time", () => {
    expect(salesDayCutoffSchema.safeParse("12:30").success).toBe(false);
    expect(salesDayCutoffSchema.safeParse("17:00").success).toBe(false);
    expect(salesDayCutoffSchema.safeParse("5").success).toBe(false);
    expect(salesDayCutoffSchema.safeParse("25:00").success).toBe(false);
  });
});

describe("createBranchLogic", () => {
  it("creates a branch the admin list then shows", async () => {
    const b = await createBranchLogic(tenantA, branchInputSchema.parse({ name: "สาขาลาดพร้าว", code: "LPR", address: "ลาดพร้าว 71" }));
    expect(b.isActive).toBe(true);
    const names = (await getAllBranchesForAdminLogic(tenantA, ALL)).map((x) => x.name);
    expect(names).toEqual(["สาขาหลัก", "สาขาลาดพร้าว"]);
  });

  it("refuses a code already used in the same shop, by name", async () => {
    await expect(
      createBranchLogic(tenantA, branchInputSchema.parse({ name: "ซ้ำ", code: "lpr", address: null }))
    ).rejects.toBeInstanceOf(BranchCodeTakenError);
  });

  it("a new branch takes the 05:00 default, or the cut-off it was given", async () => {
    const plain = await createBranchLogic(tenantA, branchInputSchema.parse({ name: "สาขาตี 5", code: "CUT1", address: null }));
    expect(plain.salesDayCutoffMinutes).toBe(300);
    const late = await createBranchLogic(tenantA, branchInputSchema.parse({ name: "สาขาตี 3", code: "CUT3", address: null, salesDayCutoffMinutes: "03:00" }));
    expect(late.salesDayCutoffMinutes).toBe(180);
  });

  it("the same code in ANOTHER shop is fine", async () => {
    const b = await createBranchLogic(tenantB, branchInputSchema.parse({ name: "อื่น", code: "LPR", address: null }));
    expect(b.tenantId).toBe(tenantB);
  });
});

describe("the settings list obeys reach (rule A5)", () => {
  it("an admin given one branch lists only that branch", async () => {
    const all = await getAllBranchesForAdminLogic(tenantA, ALL);
    const one = await getAllBranchesForAdminLogic(tenantA, { allBranches: false, allowedBranchIds: [all[0].id] });
    expect(one.map((b) => b.id)).toEqual([all[0].id]);
  });
});

describe("updateBranchLogic", () => {
  it("renames and leaves the code alone", async () => {
    const [, lpr] = await getAllBranchesForAdminLogic(tenantA, ALL);
    const after = await updateBranchLogic(
      tenantA,
      updateBranchInputSchema.parse({ id: lpr.id, name: "สาขาลาดพร้าว 71", address: null })
    );
    expect(after.name).toBe("สาขาลาดพร้าว 71");
    expect(after.code).toBe("LPR");
  });

  it("changes the cut-off, and an edit that leaves it out keeps it", async () => {
    const [, lpr] = await getAllBranchesForAdminLogic(tenantA, ALL);
    const set = await updateBranchLogic(tenantA, updateBranchInputSchema.parse({ id: lpr.id, name: lpr.name, address: null, salesDayCutoffMinutes: "04:30" }));
    expect(set.salesDayCutoffMinutes).toBe(270);
    const kept = await updateBranchLogic(tenantA, updateBranchInputSchema.parse({ id: lpr.id, name: lpr.name, address: null }));
    expect(kept.salesDayCutoffMinutes).toBe(270);
  });

  it("cannot reach another shop's branch", async () => {
    const [other] = await getAllBranchesForAdminLogic(tenantB, ALL);
    await expect(
      updateBranchLogic(tenantA, updateBranchInputSchema.parse({ id: other.id, name: "hijack", address: null }))
    ).rejects.toBeInstanceOf(BranchNotFoundError);
    const [still] = await getAllBranchesForAdminLogic(tenantB, ALL);
    expect(still.name).toBe("อื่น");
  });
});

describe("departments", () => {
  it("creates ครัว and บาร์ after Main, in order", async () => {
    await createDepartmentLogic(tenantA, departmentInputSchema.parse({ name: "ครัว", code: "kit", description: "" }));
    await createDepartmentLogic(tenantA, departmentInputSchema.parse({ name: "บาร์", code: "BAR", description: null }));
    const names = (await getDepartmentsForAdminLogic(tenantA)).map((d) => d.name);
    expect(names).toEqual(["Main", "ครัว", "บาร์"]);
  });

  it("refuses a duplicate code — the only guard, since the table has no unique", async () => {
    await expect(
      createDepartmentLogic(tenantA, departmentInputSchema.parse({ name: "ครัว 2", code: "KIT", description: null }))
    ).rejects.toBeInstanceOf(DepartmentCodeTakenError);
  });

  it("Main can be renamed, keeps its code, and can never be closed", async () => {
    const renamed = await updateDepartmentLogic(
      tenantA,
      updateDepartmentInputSchema.parse({ id: mainDeptId, name: "ส่วนกลาง", description: null })
    );
    expect(renamed.code).toBe("MAIN");
    await expect(
      setDepartmentActiveLogic(tenantA, setDepartmentActiveInputSchema.parse({ id: mainDeptId, isActive: false }))
    ).rejects.toBeInstanceOf(DefaultDepartmentLockedError);
  });

  it("any other department closes and reopens", async () => {
    const bar = (await getDepartmentsForAdminLogic(tenantA)).find((d) => d.code === "BAR")!;
    const closed = await setDepartmentActiveLogic(
      tenantA,
      setDepartmentActiveInputSchema.parse({ id: bar.id, isActive: "false" })
    );
    expect(closed.isActive).toBe(false);
    const open = await setDepartmentActiveLogic(
      tenantA,
      setDepartmentActiveInputSchema.parse({ id: bar.id, isActive: "on" })
    );
    expect(open.isActive).toBe(true);
  });
});
