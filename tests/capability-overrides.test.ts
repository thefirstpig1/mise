// ============================================================
// Mise — what a person may actually do, once the shop has changed things (ADR 0038)
// ============================================================
// E1–E7 pin the arithmetic: role default (as adjusted) + opened − closed, with
// the locked roles and locked capabilities ignored and the price pairs never
// broken. E8–E10 pin the two places that ask about OTHER people — rule 4 and
// the purchase-ready notice — because a role-only check there would let a
// shop close something on screen and leave it open underneath.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import {
  ADJUSTABLE_CAPABILITIES,
  CAPABILITY_NEEDS,
  capabilitiesOf,
  effectiveCapabilities,
} from "@/lib/permissions/service";
import { costAccessFor } from "@/lib/permissions/cost-access";
import { inviteMemberInputSchema } from "@/lib/validations/membership";
import { CannotGrantRoleError, inviteMemberLogic } from "@/server/membership";
import { purchaseReadyRecipientsLogic } from "@/server/purchase-ready-notify";

const off = (capability: string, role?: string) => ({ capability, granted: false, role });
const on = (capability: string, role?: string) => ({ capability, granted: true, role });

describe("effectiveCapabilities", () => {
  it("E1 — with nothing changed, a role carries exactly its default", () => {
    for (const role of ["manager", "purchaser", "kitchen_staff", "cashier", "accountant", "viewer"]) {
      expect([...effectiveCapabilities(role, [], [])].sort()).toEqual([...capabilitiesOf(role)].sort());
    }
  });

  it("E2 — the shop's change to a role applies; another role's row does not", () => {
    const caps = effectiveCapabilities("cashier", [on("sales:view", "cashier"), on("cost:view", "manager")], []);
    expect(caps.has("sales:view")).toBe(true);
    expect(caps.has("cost:view")).toBe(false);
    expect(effectiveCapabilities("manager", [off("expense:view", "manager")], []).has("expense:view")).toBe(false);
  });

  it("E3 — a person's exception beats the role, both ways", () => {
    expect(effectiveCapabilities("cashier", [], [on("sales:view")]).has("sales:view")).toBe(true);
    expect(effectiveCapabilities("manager", [on("expense:view", "manager")], [off("expense:view")]).has("expense:view")).toBe(false);
  });

  it("E4 — owner holds everything whatever is stored; admin ignores the role table but not exceptions", () => {
    const owner = effectiveCapabilities("owner", [off("cost:view", "owner")], [off("cost:view")]);
    expect([...owner].sort()).toEqual([...capabilitiesOf("owner")].sort());
    expect(effectiveCapabilities("admin", [off("cost:view", "admin")], []).has("cost:view")).toBe(true);
    expect(effectiveCapabilities("admin", [], [off("sales:view")]).has("sales:view")).toBe(false);
  });

  it("E5 — a stored row naming a locked or unknown capability grants nothing", () => {
    const caps = effectiveCapabilities("viewer", [on("member:manage", "viewer")], [on("settings:write"), on("cost:veiw")]);
    expect(caps.size).toBe(0);
    expect(ADJUSTABLE_CAPABILITIES.has("member:manage")).toBe(false);
    expect(ADJUSTABLE_CAPABILITIES.size).toBe(16);
  });

  it("E6 — a capability that prints money is dropped when its pair is missing (closed, never open)", () => {
    const purchaser = effectiveCapabilities("purchaser", [off("cost:view", "purchaser")], []);
    for (const [cap, need] of Object.entries(CAPABILITY_NEEDS)) {
      if (need === "cost:view") expect(purchaser.has(cap as never)).toBe(false);
    }
    expect(effectiveCapabilities("kitchen_staff", [], [on("receive:write")]).has("receive:write")).toBe(false);
    expect(effectiveCapabilities("kitchen_staff", [], [on("expense:write")]).has("expense:write")).toBe(false);
    expect(effectiveCapabilities("kitchen_staff", [], [on("expense:write"), on("expense:view")]).has("expense:write")).toBe(true);
  });

  it("E7 — the cost ticket follows the effective set, not the role", () => {
    expect(costAccessFor(effectiveCapabilities("cashier", [], [on("cost:view")]))).not.toBeNull();
    expect(costAccessFor(effectiveCapabilities("manager", [off("cost:view", "manager")], []))).toBeNull();
  });
});

describe("other people's capabilities, read from the database", () => {
  let tenantId: string;
  let branchId: string;
  let ownerUser: string;
  let managerMembership: string;
  let purchaserMembership: string;
  const users: string[] = [];
  const email = (tag: string) => `cap-${tag}-${randomUUID().slice(0, 8)}@example.com`;

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenantId = (await tx.tenant.create({ data: { name: "Capability Tenant" } })).id;
      branchId = (await tx.branch.create({ data: { tenantId, name: "อโศก", code: "CPA" } })).id;
      const mk = async (tag: string) => {
        const id = (await tx.user.create({ data: { email: email(tag), name: tag } })).id;
        users.push(id);
        return id;
      };
      ownerUser = await mk("owner");
      await tx.tenantMembership.create({ data: { tenantId, userId: ownerUser, role: "owner", allBranches: true } });
      managerMembership = (
        await tx.tenantMembership.create({ data: { tenantId, userId: await mk("manager"), role: "manager", allBranches: true } })
      ).id;
      purchaserMembership = (
        await tx.tenantMembership.create({ data: { tenantId, userId: await mk("purchaser"), role: "purchaser", allBranches: true } })
      ).id;
      // The shop stopped managers seeing overheads.
      await tx.roleCapabilityOverride.create({
        data: { tenantId, role: "manager", capability: "expense:view", granted: false, changedBy: ownerUser },
      });
    });
  });

  afterAll(async () => {
    const members = await withRlsBypass((tx) =>
      tx.tenantMembership.findMany({ where: { tenantId }, select: { userId: true } })
    );
    await withRlsBypass(async (tx) => {
      await tx.roleCapabilityOverride.deleteMany({ where: { tenantId } });
      await tx.membershipCapabilityOverride.deleteMany({ where: { tenantId } });
      await tx.userBranchAccess.deleteMany({ where: { membership: { tenantId } } });
      await tx.tenantMembership.deleteMany({ where: { tenantId } });
      await tx.branch.deleteMany({ where: { tenantId } });
      await tx.tenant.delete({ where: { id: tenantId } });
      await tx.user.deleteMany({ where: { id: { in: [...users, ...members.map((m) => m.userId)] } } });
    });
  });

  const managerActor = () => ({
    userId: users[1],
    role: "manager",
    capabilities: effectiveCapabilities("manager", [off("expense:view", "manager")], []),
    reach: { allBranches: true, allowedBranchIds: [] as string[] },
  });

  it("E8 — rule 4 asks what the manager ACTUALLY holds: no overheads, so no accountant", async () => {
    await expect(
      inviteMemberLogic(
        tenantId,
        inviteMemberInputSchema.parse({ email: email("acc"), name: "บัญชี", role: "accountant", allBranches: true, branchIds: [] }),
        managerActor()
      )
    ).rejects.toBeInstanceOf(CannotGrantRoleError);
  });

  it("E9 — rule 4 asks what the role carries IN THIS SHOP: once accountants lose overheads too, the manager may", async () => {
    await withRlsBypass((tx) =>
      tx.roleCapabilityOverride.create({
        data: { tenantId, role: "accountant", capability: "expense:view", granted: false, changedBy: ownerUser },
      })
    );
    // expense:write pairs with expense:view, so the accountant loses it as well.
    const res = await inviteMemberLogic(
      tenantId,
      inviteMemberInputSchema.parse({ email: email("acc2"), name: "บัญชี", role: "accountant", allBranches: true, branchIds: [] }),
      managerActor()
    );
    users.push(res.userId);
    expect(res.membershipId).toBeTruthy();
  });

  it("E10 — the purchase-ready notice skips a purchaser whose approving was taken away", async () => {
    const before = await purchaseReadyRecipientsLogic(tenantId, branchId);
    await withRlsBypass((tx) =>
      tx.membershipCapabilityOverride.create({
        data: { tenantId, tenantMembershipId: purchaserMembership, capability: "purchase:approve", granted: false, changedBy: ownerUser },
      })
    );
    const after = await purchaseReadyRecipientsLogic(tenantId, branchId);
    expect(after.length).toBe(before.length - 1);
    expect(managerMembership).toBeTruthy();
  });
});
