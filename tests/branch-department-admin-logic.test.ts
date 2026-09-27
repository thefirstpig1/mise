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
import { branchInputSchema, updateBranchInputSchema } from "@/lib/validations/branch";
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
