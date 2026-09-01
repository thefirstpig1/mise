// ============================================================
// Mise — telling the person they were invited (Part 31 L4, ADR 0031 Q5)
// ============================================================
// For 29 Parts an invitation was silent to the one person it concerned.
// `inviteMemberLogic` wrote the row and the screen said "เชิญ … แล้ว" — to the
// OWNER. The invitee learned about it only if somebody walked over and said so,
// which works in a shop and does not work for the outside bookkeeper CONTEXT.md
// names in its own definition of [Active shop].
//
// ── THREE LINES ROUND IT (ADR 0031 Q5) ─────────────────────────────────────
// 1. NO CREDENTIAL. The letter points at /login and nothing else. Following it
//    signs nobody in; the reader types their own address and asks for a link,
//    and that request IS the acceptance step ADR 0029 Q2 says the magic link
//    already performs. templates.ts holds the rule and a test pins it.
// 2. AFTER THE COMMIT, NEVER INSIDE IT. This module is called by the action
//    once inviteMemberLogic has returned, so its transaction is closed. An SMTP
//    failure inside that transaction would roll back an invitation that was
//    correct — the lesson this project has already paid for once.
// 3. A FAILED SEND IS NOT A FAILED INVITATION. Nothing here throws. The row is
//    real either way; what changes is which sentence the owner is shown.
//
// ── AND ONE MORE, FROM Q8 ──────────────────────────────────────────────────
// A mistyped address reaches a stranger, and this letter is what tells them.
// It does not CREATE that hole — the membership row keyed on an email string
// does, which is a property ADR 0029 accepted deliberately — but it does
// publicise it. The mitigation is in the letter's own words ("ถ้าคุณไม่รู้จัก
// ร้านนี้ ไม่ต้องทำอะไร") and in the `neverSignedIn` column Part 29 already
// shows the owner.
// ============================================================

import { invitationEmail } from "@/lib/email/templates";
import { decideEmailDelivery, isProductionRuntime } from "@/lib/email/delivery";
import { isEmailConfigured, sendEmail } from "@/lib/email/transport";

/**
 * `sent`    — it left the building.
 * `failed`  — it should have and did not. The owner has to tell them by hand.
 * `skipped` — there is no transport at all (a dev machine). Nothing failed,
 *             and saying "ส่งไม่สำเร็จ" there would be a lie in the other
 *             direction.
 */
export type NotifyOutcome = "sent" | "failed" | "skipped";

export type InviteNotification = {
  email: string;
  shopName: string;
  roleLabel: string;
};

/**
 * The address of the sign-in page, which is the ONLY link this letter carries.
 *
 * Returns null rather than guessing a host: a letter whose one link points
 * somewhere wrong is worse than a letter that was never sent, because the
 * reader has no way to tell the difference and no reason to try again.
 */
function loginUrl(): string | null {
  const base = process.env.AUTH_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/login`;
}

export async function notifyInvitedPerson(
  invite: InviteNotification,
): Promise<NotifyOutcome> {
  const mode = decideEmailDelivery({
    isProduction: isProductionRuntime(),
    configured: isEmailConfigured(),
  });

  const url = loginUrl();
  if (!url) {
    console.error("[invite] AUTH_URL is not set — cannot address the letter");
    return "failed";
  }

  const letter = invitationEmail({
    shopName: invite.shopName,
    roleLabel: invite.roleLabel,
    loginUrl: url,
  });

  if (mode === "console") {
    console.log("\n" + "=".repeat(60));
    console.log("📧 Invitation notice (no SMTP configured)");
    console.log("=".repeat(60));
    console.log(`To: ${invite.email}`);
    console.log(letter.text);
    console.log("=".repeat(60) + "\n");
    return "skipped";
  }

  if (mode === "refuse") {
    // Production with no transport. Unlike the magic link this does not throw,
    // because the invitation already happened and undoing it would be wrong —
    // but the owner must be told nobody was informed.
    console.error(
      "[invite] no SMTP configuration in production — invitee was not told",
    );
    return "failed";
  }

  try {
    await sendEmail({ to: invite.email, ...letter });
    return "sent";
  } catch (cause) {
    console.error("[invite] notification send failed", cause);
    return "failed";
  }
}
