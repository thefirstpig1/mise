// ============================================================
// คิดครัว — the two letters a problem report writes (ADR 0044)
// ============================================================
// Kong 2026-11-03: every new report to the operator ("ทุกครั้งได้เลย"), and
// the reporter once their problem is fixed and live ("ได้เลยตามนั้น"). The
// purchase-ready rules: no credential in the link, sent after the commit, and
// a failed send never fails the write that caused it — both functions never
// throw and say how many letters left.
// ============================================================

import { problemReportEmail, reportFixedEmail } from "@/lib/email/templates";
import { decideEmailDelivery, isProductionRuntime } from "@/lib/email/delivery";
import { isEmailConfigured, sendEmail } from "@/lib/email/transport";
import { platformAdminEmails } from "@/lib/platform-admin";
import { KIND_TH, reportNo, type ReportKind } from "@/lib/problem-report";

const baseUrl = () => process.env.AUTH_URL?.trim().replace(/\/+$/, "") || null;

async function deliver(to: string[], letter: { subject: string; text: string; html: string }, tag: string): Promise<number> {
  const mode = decideEmailDelivery({ isProduction: isProductionRuntime(), configured: isEmailConfigured() });
  if (mode === "console") {
    console.log(`\n📧 ${tag} (no SMTP configured) → ${to.join(", ")}\n${letter.text}\n`);
    return 0;
  }
  if (mode === "refuse") return 0;
  let sent = 0;
  for (const address of to) {
    try {
      await sendEmail({ to: address, ...letter });
      sent++;
    } catch (cause) {
      console.error(`[problem-report] ${tag} send failed`, cause);
    }
  }
  return sent;
}

export async function notifyNewReport(input: {
  id: string;
  number: number;
  kind: ReportKind;
  shopName: string;
  branchName: string | null;
  reporter: string;
  pagePath: string;
  message: string;
}): Promise<number> {
  try {
    const base = baseUrl();
    const to = [...platformAdminEmails()];
    if (!base || to.length === 0) return 0;
    const letter = problemReportEmail({
      no: reportNo(input.number),
      kind: KIND_TH[input.kind].label,
      shopName: input.shopName,
      branchName: input.branchName,
      reporter: input.reporter,
      page: input.pagePath,
      message: input.message,
      url: `${base}/platform/reports?r=${input.id}`,
    });
    return await deliver(to, letter, "new report");
  } catch (cause) {
    console.error("[problem-report] new-report notice not sent", cause);
    return 0;
  }
}

export async function notifyReportFixed(input: { to: string; number: number; message: string; reply: string | null }): Promise<number> {
  try {
    const base = baseUrl();
    if (!base) return 0;
    const letter = reportFixedEmail({ no: reportNo(input.number), message: input.message, reply: input.reply, url: `${base}/reports` });
    return await deliver([input.to], letter, "report fixed");
  } catch (cause) {
    console.error("[problem-report] fixed notice not sent", cause);
    return 0;
  }
}
