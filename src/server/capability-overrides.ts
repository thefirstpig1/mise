// ============================================================
// Mise — effective capabilities read inside a tenant transaction (ADR 0038)
// ============================================================
// `requireTenant` answers this for the person making the request. These answer
// it for OTHER people: whom a notice goes to, and what a role would carry in
// this shop when somebody grants it (rule 4 compares effective sets, Q1.3).
// ============================================================

import type { Prisma } from "@prisma/client";
import { effectiveCapabilities, type Capability } from "@/lib/permissions/service";

type Tx = Prisma.TransactionClient;

/** What `role` carries in this shop, plus one membership's exceptions if given. */
export async function shopCapabilitiesInTx(
  tx: Tx,
  tenantId: string,
  role: string,
  membershipId: string | null
): Promise<ReadonlySet<Capability>> {
  const [roleRows, memberRows] = await Promise.all([
    tx.roleCapabilityOverride.findMany({
      where: { tenantId, role },
      select: { role: true, capability: true, granted: true },
    }),
    membershipId
      ? tx.membershipCapabilityOverride.findMany({
          where: { tenantId, tenantMembershipId: membershipId },
          select: { capability: true, granted: true },
        })
      : Promise.resolve([]),
  ]);
  return effectiveCapabilities(role, roleRows, memberRows);
}

/** Effective capabilities for many members at once — two reads, not 2×N. */
export async function effectiveCapabilitiesForMembersInTx(
  tx: Tx,
  tenantId: string,
  members: readonly { id: string; role: string }[]
): Promise<Map<string, ReadonlySet<Capability>>> {
  const [roleRows, memberRows] = await Promise.all([
    tx.roleCapabilityOverride.findMany({
      where: { tenantId },
      select: { role: true, capability: true, granted: true },
    }),
    tx.membershipCapabilityOverride.findMany({
      where: { tenantId, tenantMembershipId: { in: members.map((m) => m.id) } },
      select: { tenantMembershipId: true, capability: true, granted: true },
    }),
  ]);
  return new Map(
    members.map((m) => [
      m.id,
      effectiveCapabilities(
        m.role,
        roleRows,
        memberRows.filter((r) => r.tenantMembershipId === m.id)
      ),
    ])
  );
}
