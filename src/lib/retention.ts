// ============================================================
// คิดครัว — how long the control page keeps what it records (ADR 0045 Q11)
// ============================================================
// One place for the numbers. The privacy draft's §5 table states the same
// periods, and tests/platform-part-b.test.ts reads that table and fails if the
// two ever disagree — a promise to delete is only kept if the code deletes.
// ============================================================

export const RETENTION = {
  /** login_event — security and the traffic-data duty. */
  loginDays: 90,
  /** user_activity_day — aggregate usage analysis. */
  activityMonths: 12,
  /** data_request, counted from when it was done — the proof it was done. */
  requestYears: 3,
  /** problem_report and its screenshots, counted from when it was closed. */
  reportClosedYears: 1,
} as const;

const DAY = 86_400_000;

/** Rows older than these instants are past their keep date. */
export function retentionCutoffs(now: Date): { login: Date; activityDay: Date; requestDone: Date; reportClosed: Date } {
  const activity = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETENTION.activityMonths, now.getUTCDate()));
  const request = new Date(now);
  request.setUTCFullYear(request.getUTCFullYear() - RETENTION.requestYears);
  const report = new Date(now);
  report.setUTCFullYear(report.getUTCFullYear() - RETENTION.reportClosedYears);
  return { login: new Date(now.getTime() - RETENTION.loginDays * DAY), activityDay: activity, requestDone: request, reportClosed: report };
}
