// ============================================================
// คิดครัว — "one Free shop per owner account" (Kong 2026-11-02)
// ============================================================
// Kong chose option ก: the rule is recorded now and ENFORCED from the day
// Standard can be bought. Until then nothing is refused; the platform page
// shows which owner accounts hold more than one Free shop, so Kong can see
// them and grant Standard himself. Plan code `trial` means Free.
// A plain module: the platform table (a client component) and its test share it.
// ============================================================

export type FreeRuleShop = { id: string; name: string; owners: string[]; plan: string };

/** Owner email → the Free shops it owns, for every owner holding more than one. */
export function ownersOverFreeLimit(shops: readonly FreeRuleShop[]): Map<string, { id: string; name: string }[]> {
  const byOwner = new Map<string, { id: string; name: string }[]>();
  for (const s of shops) {
    if (s.plan !== "trial") continue;
    for (const email of new Set(s.owners.map((o) => o.toLowerCase()))) {
      const list = byOwner.get(email) ?? [];
      list.push({ id: s.id, name: s.name });
      byOwner.set(email, list);
    }
  }
  for (const [email, list] of byOwner) if (list.length < 2) byOwner.delete(email);
  return byOwner;
}
