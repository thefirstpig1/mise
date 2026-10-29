// ============================================================
// คิดครัว — is this entry ready for the program that will read it?
// ============================================================
// Shared by the export dialog (to disable the button and say why) and the
// download route (to refuse the same file). A keyed or generic file never
// needs codes: a person reads it, and the account NAME is on every line.
// ============================================================

import type { ProgramSpec } from "@/lib/accounting-formats";
import { accountsUsed, type AccountKey, type Journal } from "@/lib/month-end-journal";

/** The accounts this entry uses whose code the program cannot read. */
export function missingCodes(spec: ProgramSpec, journal: Journal): AccountKey[] {
  if (!spec.needsCodes) return [];
  const used = accountsUsed(journal);
  const codeOf = new Map<AccountKey, string>();
  for (const g of journal.groups) for (const l of g.lines) codeOf.set(l.account, l.code);
  return used.filter((a) => {
    const code = codeOf.get(a) ?? "";
    return code === "" || (spec.codePattern !== undefined && !spec.codePattern.test(code));
  });
}
