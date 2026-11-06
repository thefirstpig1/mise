// ============================================================
// คิดครัว — which setup steps a shop has done (ADR 0045 Q4)
// ============================================================
// A plain module, so the shop's checklist (src/server/onboarding.ts) and the
// platform overview (src/lib/platform-overview.ts) read ONE rule — two copies
// would drift apart and nothing would say so. No database here: callers bring
// the facts.
// ============================================================

import type { SetupKey } from "@/lib/setup-steps";

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

/** What a shop has recorded, as `onboardingDone` reads it. */
export type OnboardingFacts = {
  createdAt: Date;
  updatedAt: Date;
  activeMembers: number;
  hasSupplier: boolean;
  hasProduct: boolean;
  hasSalesDay: boolean;
  hasLiveRecipe: boolean;
  hasClosedCount: boolean;
};

/**
 * The one rule for "which setup steps are done" — the shop's checklist and the
 * platform overview's funnel (ADR 0045 Q4) both call it, so the two can never
 * disagree about a shop.
 */
export function onboardingDone(f: OnboardingFacts): Record<SetupKey, boolean> {
  return {
    shop: shopSettingsReviewed(f),
    team: f.activeMembers > 1,
    supplier: f.hasSupplier,
    product: f.hasProduct,
    sales: f.hasSalesDay,
    recipe: f.hasLiveRecipe,
    count: f.hasClosedCount,
  };
}
