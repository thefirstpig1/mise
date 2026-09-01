// ============================================================
// Mise — the letter that follows an invitation (Part 31 L4, ADR 0031 Q5)
// ============================================================
// Two halves, and the second is the one that matters.
//
// The first pins the three outcomes: a dev machine with no transport has not
// FAILED to tell anybody, and production with no transport has. Reporting
// either as the other is a lie in one direction or the other.
//
// The second drives the real action against a real database with a transport
// that throws, and asserts the membership row is still there. That is Q5's
// second and third lines expressed as a fact rather than a comment: the send
// happens after the commit, and a failed send is not a failed invitation.
//
// Verified red by making the notifier rethrow AND moving its call inside
// inviteMemberLogic's scoped transaction — the two halves of what Q5 forbids.
// The SMTP error then propagates out of inviteMemberAction and the invitation
// fails outright, which is the observable half; the row's rollback is the
// Prisma behaviour behind it and this test never gets far enough to watch it.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

let sendBehaviour: "ok" | "throw" = "ok";
let configured = true;
const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];

vi.mock("@/lib/email/transport", () => ({
  isEmailConfigured: () => configured,
  sendEmail: async (message: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }) => {
    if (sendBehaviour === "throw") throw new Error("SMTP said no");
    sent.push(message);
  },
}));

let currentUserId: string | null = null;

vi.mock("@/lib/auth", () => ({
  auth: async () =>
    currentUserId === null ? null : { user: { id: currentUserId } },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const { notifyInvitedPerson } = await import("@/server/invite-notify");
const { withRlsBypass } = await import("@/lib/db-admin");
const { inviteMemberAction } = await import("@/app/settings/members/actions");

const SHOP = "ร้านเจ๊แดง";

describe("notifyInvitedPerson — the three honest outcomes (ADR 0031 Q5)", () => {
  const invite = { email: "somchai@example.com", shopName: SHOP, roleLabel: "ผู้จัดการ" };

  it("V1 — with a transport it sends, and the letter names the shop", async () => {
    configured = true;
    sendBehaviour = "ok";
    sent.length = 0;

    expect(await notifyInvitedPerson(invite)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("somchai@example.com");
    expect(sent[0].text).toContain(SHOP);
    expect(sent[0].text).toContain("ผู้จัดการ");
  });

  it("V2 — the letter it hands the transport still carries no credential", async () => {
    // templates.ts is where the rule lives, but this is the seam where a wrong
    // caller could smuggle one in — so the property is checked on the thing
    // that actually went to the wire.
    configured = true;
    sendBehaviour = "ok";
    sent.length = 0;
    await notifyInvitedPerson(invite);

    const everything = `${sent[0].subject}\n${sent[0].text}\n${sent[0].html}`;
    expect(everything).not.toContain("token");
    expect(everything).not.toContain("callback");
    expect(everything).toContain("/login");
  });

  it("V3 — a throwing transport reports failed and never throws", async () => {
    // If this threw, it would unwind into an action whose invitation has
    // already committed, and the owner would be shown a refusal for something
    // that succeeded.
    configured = true;
    sendBehaviour = "throw";
    await expect(notifyInvitedPerson(invite)).resolves.toBe("failed");
  });

  it("V4 — no transport on a dev machine is `skipped`, not `failed`", async () => {
    // Nothing failed here. Saying it did would send an owner chasing a problem
    // that does not exist.
    configured = false;
    sendBehaviour = "ok";
    expect(await notifyInvitedPerson(invite)).toBe("skipped");
  });

  it("V5 — no AUTH_URL means no letter, because its one link would be wrong", async () => {
    // A letter whose only link points nowhere is worse than no letter: the
    // reader cannot tell, and has no reason to try again.
    const saved = process.env.AUTH_URL;
    delete process.env.AUTH_URL;
    try {
      configured = true;
      sendBehaviour = "ok";
      sent.length = 0;
      expect(await notifyInvitedPerson(invite)).toBe("failed");
      expect(sent).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.AUTH_URL = saved;
    }
  });
});

describe("a failed letter is not a failed invitation (ADR 0031 Q5 line 3)", () => {
  let tenantId: string;
  let ownerId: string;
  let branchId: string;
  const invitee = `part31-${randomUUID().slice(0, 8)}@example.com`;

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: SHOP } });
      tenantId = t.id;
      branchId = (
        await tx.branch.create({
          data: { tenantId: t.id, name: "อโศก", code: "P31" },
        })
      ).id;
      ownerId = (
        await tx.user.create({
          data: { email: `part31-owner-${randomUUID().slice(0, 8)}@example.com` },
        })
      ).id;
      await tx.tenantMembership.create({
        data: { tenantId: t.id, userId: ownerId, role: "owner", allBranches: true },
      });
    });
    currentUserId = ownerId;
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.userBranchAccess.deleteMany({
        where: { membership: { tenantId } },
      });
      await tx.tenantMembership.deleteMany({ where: { tenantId } });
      await tx.branch.deleteMany({ where: { tenantId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
      await tx.user.deleteMany({
        where: { email: { in: [invitee] } },
      });
      await tx.user.deleteMany({ where: { id: ownerId } });
    });
    currentUserId = null;
  });

  it("V6 — the row stands, and the owner is told the letter did not go", async () => {
    configured = true;
    sendBehaviour = "throw";

    const fd = new FormData();
    fd.set("email", invitee);
    fd.set("name", "คนใหม่");
    fd.set("role", "kitchen_staff");
    fd.append("branch_id", branchId);

    const state = await inviteMemberAction({ ok: true, message: "" }, fd);

    // The invitation SUCCEEDED. Only the telling failed.
    expect(state.ok).toBe(true);
    // Asserted on the half only this sentence has: every other outcome also
    // starts with "เชิญ … แล้ว".
    expect(state.ok && state.message).toContain("บอกเขาให้เข้าที่หน้าเข้าสู่ระบบ");

    const row = await withRlsBypass((tx) =>
      tx.tenantMembership.findFirst({
        where: { tenantId, user: { email: invitee } },
      }),
    );
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(true);
  });
});
