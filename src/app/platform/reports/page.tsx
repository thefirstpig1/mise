// ADR 0044 — "เรื่องที่แจ้งเข้ามา": every shop's problem reports in one inbox
// (mockup 2wtVT94pZjv1EX9xy8YVCp §4). The operator reads the working words
// for a status; the reporter reads plainer ones (lib/problem-report.ts).
// `?r=<id>` opens one report — the link in the new-report e-mail.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { deviceOf } from "@/lib/problem-report";
import { ROLE_LABELS_TH } from "@/lib/validations/membership";
import { listPlatformReportsLogic } from "@/server/platform";
import ReportsInbox from "./_components/ReportsInbox";

export default async function PlatformReportsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const actor = await requirePlatformAdmin();
  const [{ r }, reports] = await Promise.all([searchParams, listPlatformReportsLogic(actor)]);
  return (
    <ReportsInbox
      initialId={r ?? null}
      reports={reports.map((x) => ({
        ...x,
        reporterRole: x.reporterRole ? (ROLE_LABELS_TH[x.reporterRole as keyof typeof ROLE_LABELS_TH] ?? x.reporterRole) : null,
        device: x.userAgent ? deviceOf(x.userAgent) : null,
      }))}
    />
  );
}
