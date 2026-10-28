// ============================================================
// Mise — the staff-meal ticket board (ADR 0035), shared by the page and its poll
// ============================================================
// Served by GET /api/staff-meals?what=board (mise-ui-review §5c) — it was
// getTicketBoardAction, handed to the board as a prop. The page builds the
// first board on the server and the poll refreshes it; both call
// readTicketBoard. The client component imports TYPES from here only.
// ============================================================

import { computeBangkokToday, addDays } from "@/lib/bangkok-date";
import type { Reach } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import {
  getMyStaffMealTicketsLogic,
  getPendingStaffMealTicketsLogic,
  getStaffMealQuotaLogic,
  type StaffMealTicket,
} from "@/server/staff-meal-read";

/** A ticket, flattened for the client (Decimals and Dates as strings). */
export type TicketView = {
  id: string;
  ticketNo: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  menuName: string | null;
  servings: string;
  unitPrice: string | null;
  branchName: string;
  eaterName: string | null;
  requestedByName: string | null;
  onBehalf: boolean;
  requestedAtLabel: string;
  businessDateLabel: string;
  approvedByName: string | null;
  rejectedReason: string | null;
  stockPosted: boolean;
  voided: boolean;
  /** Approver's queue: the viewer asked for / will eat this one — no buttons (Q5). */
  isOwn?: boolean;
  /** Approver's view only: this person's quota standing today. */
  quota?: { used: string; quota: string | null; over: boolean; unpriced: number } | null;
};

const timeTh = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
});
const dateTh = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "2-digit",
});

export const toTicketView = (t: StaffMealTicket): TicketView => ({
  id: t.id,
  ticketNo: t.ticketNo,
  status: t.status,
  menuName: t.menuName,
  servings: t.servings.toString(),
  unitPrice: t.unitPrice === null ? null : t.unitPrice.toString(),
  branchName: t.branchName,
  eaterName: t.staffMemberName,
  requestedByName: t.requestedByName,
  onBehalf: t.onBehalf,
  requestedAtLabel: timeTh.format(t.requestedAt),
  businessDateLabel: dateTh.format(t.businessDate),
  approvedByName: t.approvedByName,
  rejectedReason: t.rejectedReason,
  stockPosted: t.stockPosted,
  voided: t.voided,
});

export type TicketBoard = { mine: TicketView[]; pending: TicketView[] | null };

/**
 * What the page polls (ADR 0035): the viewer's own tickets since yesterday, and
 * — for an approver — the queue at the branches they reach, each with the
 * eater's quota standing today.
 */
export async function readTicketBoard(v: {
  tenantId: string;
  userId: string;
  reach: Reach;
  canApprove: boolean;
}): Promise<TicketBoard> {
  const { tenantId, userId } = v;
  const since = addDays(computeBangkokToday(), -1);
  const mine = (await getMyStaffMealTicketsLogic(tenantId, userId, since)).map(toTicketView);
  if (!v.canApprove) return { mine, pending: null };

  const branches = await getBranchesLogic(tenantId, v.reach);
  const queue = await getPendingStaffMealTicketsLogic(tenantId, branches.map((b) => b.id));
  const pending = await Promise.all(
    queue.map(async (t) => {
      const view = {
        ...toTicketView(t),
        isOwn: t.requestedByUserId === userId || t.eaterUserId === userId,
      };
      if (!t.staffMemberId) return { ...view, quota: null };
      const q = await getStaffMealQuotaLogic(tenantId, {
        staffMemberId: t.staffMemberId,
        businessDate: t.businessDate,
      });
      return {
        ...view,
        quota: {
          used: q.used.toString(),
          quota: q.quota === null ? null : q.quota.toString(),
          over: q.over,
          unpriced: q.unpricedCount,
        },
      };
    })
  );
  return { mine, pending };
}
