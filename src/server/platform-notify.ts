// ============================================================
// คิดครัว — letters the control page sends (ADR 0045 part B)
// ============================================================
// Same rules as the problem-report letters: no credential, sent after the
// change committed, and a failed send never undoes the change. Returns how
// many letters left.
// ============================================================

import { emailChangedEmail } from "@/lib/email/templates";
import { decideEmailDelivery, isProductionRuntime } from "@/lib/email/delivery";
import { isEmailConfigured, sendEmail } from "@/lib/email/transport";
import type { EmailChange } from "@/server/platform";

const baseUrl = () => process.env.AUTH_URL?.trim().replace(/\/+$/, "") || null;

export async function notifyEmailChanged(change: EmailChange): Promise<number> {
  try {
    const base = baseUrl();
    if (!base) return 0;
    const mode = decideEmailDelivery({ isProduction: isProductionRuntime(), configured: isEmailConfigured() });
    let sent = 0;
    for (const to of ["old", "new"] as const) {
      const letter = emailChangedEmail({ ...change, loginUrl: `${base}/login`, to });
      const address = to === "old" ? change.oldEmail : change.newEmail;
      if (mode === "console") {
        console.log(`\n📧 email changed (no SMTP configured) → ${address}\n${letter.text}\n`);
        continue;
      }
      if (mode === "refuse") continue;
      try {
        await sendEmail({ to: address, ...letter });
        sent++;
      } catch (cause) {
        console.error("[platform] email-changed notice send failed", cause);
      }
    }
    return sent;
  } catch (cause) {
    console.error("[platform] email-changed notice not sent", cause);
    return 0;
  }
}
