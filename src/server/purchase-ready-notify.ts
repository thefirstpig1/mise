// ============================================================
// Mise — telling purchasers a branch is ready to order (ADR 0036 Q9)
// ============================================================
// Kong 2026-09-29: "ส่งหาทุกคนโดยไม่ต้องตั้งค่า แต่ตั้งได้". Every active member
// who can cut rounds (purchase:approve) AND reaches the branch is written to,
// unless they turned it off (`tenant_membership.notify_purchase_ready`).
//
// The same three lines as the invitation letter (invite-notify.ts):
//   1. no credential — the link opens the cut sheet, which asks for sign-in
//   2. after the commit — called once the "ready" write has returned
//   3. a failed send fails nothing — the purchaser still sees the dashboard card
// ============================================================

import { withTenantContext } from "@/lib/db";
import { hasCapability } from "@/lib/permissions/service";
import { purchaseReadyEmail } from "@/lib/email/templates";
import { decideEmailDelivery, isProductionRuntime } from "@/lib/email/delivery";
import { isEmailConfigured, sendEmail } from "@/lib/email/transport";

/** Who gets told: can cut rounds, reaches this branch, has not turned it off. */
export async function purchaseReadyRecipientsLogic(tenantId: string, branchId: string): Promise<string[]> {
  return withTenantContext(tenantId, async (tx) => {
    const members = await tx.tenantMembership.findMany({
      where: { tenantId, isActive: true, notifyPurchaseReady: true },
      select: {
        role: true,
        allBranches: true,
        branchAccess: { select: { branchId: true } },
        user: { select: { email: true } },
      },
    });
    return members
      .filter((m) => hasCapability(m.role, "purchase:approve"))
      .filter((m) => m.allBranches || m.branchAccess.some((b) => b.branchId === branchId))
      .map((m) => m.user.email)
      .filter((e): e is string => Boolean(e));
  });
}

/** Turn one's own notice on or off (self-service, on the cut sheet). */
export async function setMyPurchaseNotifyLogic(tenantId: string, userId: string, on: boolean): Promise<void> {
  await withTenantContext(tenantId, (tx) =>
    tx.tenantMembership.updateMany({ where: { tenantId, userId }, data: { notifyPurchaseReady: on } })
  );
}

export async function getMyPurchaseNotifyLogic(tenantId: string, userId: string): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => {
    const m = await tx.tenantMembership.findFirst({ where: { tenantId, userId }, select: { notifyPurchaseReady: true } });
    return m?.notifyPurchaseReady ?? true;
  });
}

/** Never throws (line 3). Returns how many letters left the building. */
export async function notifyPurchaseReady(input: {
  tenantId: string;
  shopName: string;
  branchId: string;
  branchName: string;
  lineCount: number;
}): Promise<number> {
  try {
    const base = process.env.AUTH_URL?.trim();
    if (!base) return 0;
    const url = `${base.replace(/\/+$/, "")}/purchase-requests/cut?b=${input.branchId}`;
    const to = await purchaseReadyRecipientsLogic(input.tenantId, input.branchId);
    if (to.length === 0) return 0;
    const letter = purchaseReadyEmail({ shopName: input.shopName, branchName: input.branchName, lineCount: input.lineCount, url });
    const mode = decideEmailDelivery({ isProduction: isProductionRuntime(), configured: isEmailConfigured() });
    if (mode === "console") {
      console.log(`\n📧 Purchase-ready notice (no SMTP configured) → ${to.join(", ")}\n${letter.text}\n`);
      return 0;
    }
    if (mode === "refuse") return 0;
    let sent = 0;
    for (const address of to) {
      try {
        await sendEmail({ to: address, ...letter });
        sent++;
      } catch (cause) {
        console.error("[purchase-ready] send failed", cause);
      }
    }
    return sent;
  } catch (cause) {
    console.error("[purchase-ready] notice not sent", cause);
    return 0;
  }
}
