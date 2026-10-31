// ============================================================
// Mise — เริ่มต้นใช้งาน: the new shop's setup checklist (Kong 2026-10-28)
// ============================================================
// Mockup GG5e43SSLmNFxEHfa5RQJH. Each step is ticked by what the shop has
// actually DONE in the system — never by a box somebody clicked — so the
// checklist cannot say "done" about something that is not:
//   shop     — settings saved, or confirmed as they are, after signup
//              (tenant.updated_at moved past created_at)
//   team     — someone besides the founder belongs to the shop
//   supplier — a live supplier exists
//   product  — a live product exists
//   sales    — a POS file has been imported for any day
//   recipe   — a live recipe exists (สูตรอาหาร shops only)
//   count    — a stock count has been closed
// 2026-10-30 (proposal CuT6DJRf5X7A6N2h8BfuKG D): ordered as the setup flow
// runs — the list complete BEFORE the first count, the count last, on the
// month's last night, because that count is the next month's opening.
// Hiding it is per membership (onboarding_dismissed_at), and it disappears by
// itself once every step is done.
//
// 2026-10-31 (friend's-shop feedback, mockup 1wgaH9Jfx8L7CxqfNHtdn3): sales
// moved up to second — it needs nothing before it and is the first thing that
// puts numbers on the dashboard — and `team` left the count: a one-person shop
// was told setup was unfinished for ever, and inviting people blocks nothing.
// It is still reported in `done`, as the "ทำเมื่อไรก็ได้" row. The words for
// each step live in src/lib/setup-steps.ts.
// ============================================================

import { cache } from "react";
import { withTenantContext } from "@/lib/db";
import { SETUP_STEPS, type SetupKey, type SetupStep } from "@/lib/setup-steps";

// Kong 2026-10-30: ingredients come before suppliers — the bill import (the
// supplier step's door) matches each bill line against the ingredient list.
export const ONBOARDING_STEPS = SETUP_STEPS;
export type OnboardingStep = SetupKey;

export type Onboarding = {
  /** The steps that count, in order — `recipe` only under สูตรอาหาร; `team` never. */
  steps: SetupStep[];
  done: Record<OnboardingStep, boolean>;
  doneCount: number;
  dismissed: boolean;
  method: "PERIODIC_INVENTORY" | "RECIPE_CONSUMPTION";
};

/**
 * Signup writes created_at and updated_at in the same instant; a save later moves
 * updated_at. Was 60 s — the setup trial (2026-10-30) saved settings 52 s after
 * signing up and the step stayed unticked. Signup's own writes land within a few
 * seconds; nobody opens settings and saves inside 15.
 */
const SAVED_AFTER_SIGNUP_MS = 15_000;

/**
 * The updated_at a settings save writes. Never inside the signup window: a
 * shop that signs up and presses "ใช้ค่าตามนี้" within seconds (the setup walk
 * 2026-10-31 did it in 8) has still been through its settings, and without
 * this the step stayed unticked and the button did nothing visible.
 */
export function settingsSavedAt(createdAt: Date, now: Date = new Date()): Date {
  return new Date(Math.max(now.getTime(), createdAt.getTime() + SAVED_AFTER_SIGNUP_MS + 1000));
}

/** Has the owner been through ตั้งค่าร้าน since signing up? (step "shop") */
export function shopSettingsReviewed(t: { createdAt: Date; updatedAt: Date }): boolean {
  return t.updatedAt.getTime() - t.createdAt.getTime() > SAVED_AFTER_SIGNUP_MS;
}

export async function getOnboardingLogic(tenantId: string, membershipId: string): Promise<Onboarding> {
  return withTenantContext(tenantId, async (tx) => {
    const [tenant, membership, supplier, product, sales, count, members, recipe] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { createdAt: true, updatedAt: true, grossProfitMethod: true } }),
      tx.tenantMembership.findUniqueOrThrow({ where: { id: membershipId }, select: { onboardingDismissedAt: true } }),
      tx.supplier.findFirst({ where: { tenantId, deletedAt: null }, select: { id: true } }),
      tx.product.findFirst({ where: { tenantId, deletedAt: null }, select: { id: true } }),
      tx.salesDay.findFirst({ where: { tenantId }, select: { id: true } }),
      tx.stockCount.findFirst({ where: { tenantId, status: "CLOSED", deletedAt: null }, select: { id: true } }),
      tx.tenantMembership.count({ where: { tenantId, isActive: true } }),
      tx.recipe.findFirst({ where: { tenantId, menuId: { not: null }, isDraft: false, supersededAt: null }, select: { id: true } }),
    ]);
    const done: Record<OnboardingStep, boolean> = {
      shop: shopSettingsReviewed(tenant),
      team: members > 1,
      supplier: supplier !== null,
      product: product !== null,
      sales: sales !== null,
      recipe: recipe !== null,
      count: count !== null,
    };
    const steps = ONBOARDING_STEPS.filter((s) => s !== "recipe" || tenant.grossProfitMethod === "RECIPE_CONSUMPTION");
    return {
      steps,
      done,
      doneCount: steps.filter((s) => done[s]).length,
      dismissed: membership.onboardingDismissedAt !== null,
      method: tenant.grossProfitMethod,
    };
  });
}

/** Once per request: the frame's setup bar and the dashboard's checklist share it. */
export const getOnboardingForRequest = cache(getOnboardingLogic);

export async function setOnboardingDismissedLogic(tenantId: string, membershipId: string, dismissed: boolean) {
  await withTenantContext(tenantId, (tx) =>
    tx.tenantMembership.update({
      where: { id: membershipId },
      data: { onboardingDismissedAt: dismissed ? new Date() : null },
      select: { id: true },
    })
  );
}
