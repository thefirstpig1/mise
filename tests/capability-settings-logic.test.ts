// ============================================================
// Mise — the two writes behind ตั้งสิทธิ์ของร้าน (ADR 0038)
// ============================================================
// S1–S4 the role table: owner only, only the difference stored, a pair cannot
// be broken, reset deletes the rows. S5–S9 one person's exception: never an
// owner or yourself, the pair completed, you open only what you hold, and
// "ตามบทบาท" removes the row. Every effective change is logged.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { ADJUSTABLE_CAPABILITIES, capabilitiesOf, effectiveCapabilities } from "@/lib/permissions/service";
import {
  setMemberCapabilityInputSchema,
  setRoleCapabilitiesInputSchema,
} from "@/lib/validations/permissions";
import {
  CannotGrantCapabilityError,
  ExceptionTargetError,
  OwnerOnlyError,
  PairBrokenError,
  setMemberCapabilityLogic,
  setRoleCapabilitiesLogic,
} from "@/server/capability-settings";

describe("capability settings writes (ADR 0038)", () => {
  let tenantId: string;
  let ownerUser: string;
  let managerUser: string;
  let ownerMembership: string;
  let managerMembership: string;
  let cashierMembership: string;
  const users: string[] = [];
  const email = (t: string) => `cset-${t}-${randomUUID().slice(0, 8)}@example.com`;

  const OWNER = () => ({ userId: ownerUser, role: "owner", capabilities: capabilitiesOf("owner") });
  const MANAGER = (closed: string[] = []) => ({
    userId: managerUser,
    role: "manager",
    capabilities: effectiveCapabilities("manager", closed.map((c) => ({ capability: c, granted: false })), []),
  });
  const roleInput = (role: string, caps: string[], reset = false) =>
    setRoleCapabilitiesInputSchema.parse({ role, capabilities: caps, reset });
  const memberInput = (membershipId: string, capability: string, state: "inherit" | "grant" | "revoke") =>
    setMemberCapabilityInputSchema.parse({ membershipId, capability, state });

  const rows = () =>
    withRlsBypass(async (tx) => ({
      role: await tx.roleCapabilityOverride.findMany({ where: { tenantId } }),
      member: await tx.membershipCapabilityOverride.findMany({ where: { tenantId } }),
      log: await tx.permissionChangeLog.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
    }));

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenantId = (await tx.tenant.create({ data: { name: "Capability Settings Tenant" } })).id;
      const mk = async (t: string) => {
        const id = (await tx.user.create({ data: { email: email(t), name: t } })).id;
        users.push(id);
        return id;
      };
      ownerUser = await mk("owner");
      managerUser = await mk("manager");
      const cashierUser = await mk("cashier");
      ownerMembership = (await tx.tenantMembership.create({ data: { tenantId, userId: ownerUser, role: "owner", allBranches: true } })).id;
      managerMembership = (await tx.tenantMembership.create({ data: { tenantId, userId: managerUser, role: "manager", allBranches: true } })).id;
      cashierMembership = (await tx.tenantMembership.create({ data: { tenantId, userId: cashierUser, role: "cashier", allBranches: true } })).id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.permissionChangeLog.deleteMany({ where: { tenantId } });
      await tx.roleCapabilityOverride.deleteMany({ where: { tenantId } });
      await tx.membershipCapabilityOverride.deleteMany({ where: { tenantId } });
      await tx.tenantMembership.deleteMany({ where: { tenantId } });
      await tx.tenant.delete({ where: { id: tenantId } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
  });

  it("S1 — only an owner changes the role table; owner and admin rows are not on offer", async () => {
    await expect(setRoleCapabilitiesLogic(tenantId, MANAGER(), roleInput("cashier", []))).rejects.toBeInstanceOf(OwnerOnlyError);
    expect(() => roleInput("admin", [])).toThrow();
    expect(() => roleInput("cashier", ["member:manage"])).toThrow();
  });

  it("S2 — only the difference is stored, and each effective change is logged", async () => {
    // cashier default: sales:import, consumption:post, waste:write. Add sales:view.
    const res = await setRoleCapabilitiesLogic(
      tenantId,
      OWNER(),
      roleInput("cashier", ["sales:import", "consumption:post", "waste:write", "sales:view"])
    );
    expect(res.changed).toBe(1);
    const r = await rows();
    expect(r.role.map((x) => [x.role, x.capability, x.granted])).toEqual([["cashier", "sales:view", true]]);
    expect(r.log.map((x) => [x.role, x.capability, x.change])).toEqual([["cashier", "sales:view", "grant"]]);
  });

  it("S3 — a capability that prints money cannot be kept without its money view", async () => {
    const purchaser = [...capabilitiesOf("purchaser")].filter((c) => ADJUSTABLE_CAPABILITIES.has(c) && c !== "cost:view");
    await expect(setRoleCapabilitiesLogic(tenantId, OWNER(), roleInput("purchaser", purchaser))).rejects.toBeInstanceOf(PairBrokenError);
  });

  it("S4 — reset puts a role back to its default by deleting its rows", async () => {
    await setRoleCapabilitiesLogic(tenantId, OWNER(), roleInput("cashier", [], true));
    const r = await rows();
    expect(r.role).toEqual([]);
    expect(r.log.at(-1)?.change).toBe("reset");
  });

  it("S5 — no exception for an owner or for yourself", async () => {
    await expect(setMemberCapabilityLogic(tenantId, MANAGER(), memberInput(ownerMembership, "cost:view", "revoke"))).rejects.toBeInstanceOf(ExceptionTargetError);
    await expect(setMemberCapabilityLogic(tenantId, MANAGER(), memberInput(managerMembership, "cost:view", "revoke"))).rejects.toBeInstanceOf(ExceptionTargetError);
  });

  it("S6 — opening receiving for a cashier opens cost too", async () => {
    const res = await setMemberCapabilityLogic(tenantId, OWNER(), memberInput(cashierMembership, "receive:write", "grant"));
    expect(res.capabilities).toEqual(expect.arrayContaining(["receive:write", "cost:view"]));
    const r = await rows();
    expect(r.member.map((x) => x.capability).sort()).toEqual(["cost:view", "receive:write"]);
  });

  it("S7 — closing cost closes what prints it, explicitly", async () => {
    const res = await setMemberCapabilityLogic(tenantId, OWNER(), memberInput(cashierMembership, "cost:view", "revoke"));
    expect(res.capabilities).not.toContain("receive:write");
    const r = await rows();
    // Both exceptions fall back to the role (a cashier holds neither), so no row remains.
    expect(r.member).toEqual([]);
  });

  it("S8 — you open only what you hold: a manager without overheads cannot give them", async () => {
    await expect(
      setMemberCapabilityLogic(tenantId, MANAGER(["expense:view"]), memberInput(cashierMembership, "expense:view", "grant"))
    ).rejects.toBeInstanceOf(CannotGrantCapabilityError);
    // Closing is always allowed — it only takes away.
    await expect(
      setMemberCapabilityLogic(tenantId, MANAGER(["expense:view"]), memberInput(cashierMembership, "waste:write", "revoke"))
    ).resolves.toBeTruthy();
  });

  it("S9 — ตามบทบาท removes the exception; the log records what actually changed (waste comes back)", async () => {
    await setMemberCapabilityLogic(tenantId, OWNER(), memberInput(cashierMembership, "waste:write", "inherit"));
    const r = await rows();
    expect(r.member).toEqual([]);
    expect(r.log.at(-1)).toMatchObject({ capability: "waste:write", change: "grant" });
  });
});
