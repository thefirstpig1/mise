// ============================================================
// Mise — เริ่มต้นใช้งาน: the new shop's setup checklist (Kong 2026-10-28)
// ============================================================
// Mockup GG5e43SSLmNFxEHfa5RQJH. Six steps, each ticked by what the shop has
// actually DONE in the system — never by a box somebody clicked — so the
// checklist cannot say "done" about something that is not:
//   shop     — settings saved at least once after signup (tenant.updated_at
//              moved past created_at; signup itself writes both together)
//   supplier — a live supplier exists
//   product  — a live product exists
//   sales    — a POS file has been imported for any day
//   count    — a stock count has been closed
//   team     — someone besides the founder belongs to the shop
// Hiding it is per membership (onboarding_dismissed_at), and it disappears by
// itself once all six are done.
// ============================================================

import { withTenantContext } from "@/lib/db";

export const ONBOARDING_STEPS = ["shop", "supplier", "product", "sales", "count", "team"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type Onboarding = {
  done: Record<OnboardingStep, boolean>;
  doneCount: number;
  dismissed: boolean;
};

/** Signup writes created_at and updated_at in the same instant; a save later moves updated_at. */
const SAVED_AFTER_SIGNUP_MS = 60_000;

export async function getOnboardingLogic(tenantId: string, membershipId: string): Promise<Onboarding> {
  return withTenantContext(tenantId, async (tx) => {
    const [tenant, membership, supplier, product, sales, count, members] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { createdAt: true, updatedAt: true } }),
      tx.tenantMembership.findUniqueOrThrow({ where: { id: membershipId }, select: { onboardingDismissedAt: true } }),
      tx.supplier.findFirst({ where: { tenantId, deletedAt: null }, select: { id: true } }),
      tx.product.findFirst({ where: { tenantId, deletedAt: null }, select: { id: true } }),
      tx.salesDay.findFirst({ where: { tenantId }, select: { id: true } }),
      tx.stockCount.findFirst({ where: { tenantId, status: "CLOSED", deletedAt: null }, select: { id: true } }),
      tx.tenantMembership.count({ where: { tenantId, isActive: true } }),
    ]);
    const done: Record<OnboardingStep, boolean> = {
      shop: tenant.updatedAt.getTime() - tenant.createdAt.getTime() > SAVED_AFTER_SIGNUP_MS,
      supplier: supplier !== null,
      product: product !== null,
      sales: sales !== null,
      count: count !== null,
      team: members > 1,
    };
    return {
      done,
      doneCount: ONBOARDING_STEPS.filter((s) => done[s]).length,
      dismissed: membership.onboardingDismissedAt !== null,
    };
  });
}

export async function setOnboardingDismissedLogic(tenantId: string, membershipId: string, dismissed: boolean) {
  await withTenantContext(tenantId, (tx) =>
    tx.tenantMembership.update({
      where: { id: membershipId },
      data: { onboardingDismissedAt: dismissed ? new Date() : null },
      select: { id: true },
    })
  );
}
