// ============================================================
// คิดครัว — what the control page learns from use (ADR 0045 part B)
// ============================================================
// Written by the app's own role, never through a door around row security
// (Q9): a sign-in goes to login_event, whose policy lets the app INSERT and
// nothing else; a day of use goes to user_activity_day inside the shop's own
// tenant context. Both use createMany, which sends no RETURNING — an INSERT
// that returns rows would need a SELECT policy the app does not have.
//
// Neither ever fails or slows what the person was doing: a lost record is a
// gap in a chart, a failed page is a shop that cannot work.
// ============================================================

import { prisma, withTenantContext } from "@/lib/db";
import { deviceOf } from "@/lib/problem-report";

/** "tenant|user|day" already written by this server — once a day, not once a page (Q13). */
const noted = new Set<string>();
const NOTED_MAX = 20_000;

const bangkokDay = (now: Date) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export function noteActivity(tenantId: string, userId: string, now: Date = new Date()): void {
  const day = bangkokDay(now);
  const key = `${tenantId}|${userId}|${day}`;
  if (noted.has(key)) return;
  if (noted.size >= NOTED_MAX) noted.clear();
  noted.add(key);
  void withTenantContext(tenantId, (tx) =>
    tx.userActivityDay.createMany({ data: [{ tenantId, userId, day: new Date(`${day}T00:00:00Z`) }], skipDuplicates: true })
  ).catch((e) => {
    noted.delete(key);
    console.error("[usage] activity day not recorded", e);
  });
}

export async function recordLogin(input: { userId: string; email: string; ip: string | null; userAgent: string | null }): Promise<void> {
  try {
    await prisma.loginEvent.createMany({
      data: [{ userId: input.userId, email: input.email.toLowerCase(), ip: input.ip, userAgent: input.userAgent ? deviceOf(input.userAgent) : null }],
    });
  } catch (e) {
    console.error("[usage] sign-in not recorded", e);
  }
}
