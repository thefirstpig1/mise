// ============================================================
// Mise — how the expense screens say a month and a category (2026-10-27)
// ============================================================
// Plain module on purpose: Server Components import these, and a value
// imported from a "use client" file arrives as a client reference instead
// (mise-ui-review §7).
// ============================================================

import { periodLabelTh } from "@/lib/sales-insight";

/** "2026-09" → "ก.ย. 69". Anything that is not YYYY-MM is returned as it came. */
export function monthLabelTh(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return periodLabelTh(`${period}-01`, `${period}-${String(last).padStart(2, "0")}`);
}

/** The account a category books to, in the shop's words (the /categories boxes). */
export const ACCOUNT_TH: Record<string, string> = {
  COGS: "ต้นทุนขาย",
  OpEx: "ค่าใช้จ่ายดำเนินงาน",
};

/** "ค่าใช้จ่ายดำเนินงาน · สาธารณูปโภค · ค่าไฟฟ้า" — never "OpEx · …". */
export function categoryLabelTh(c: { account: string; accountingSection: string; groupName: string }): string {
  return [ACCOUNT_TH[c.account] ?? c.account, c.accountingSection, c.groupName].join(" · ");
}

/** The three ways a shop pays, as chips. Free text stays readable for old bills. */
export const PAYMENT_METHODS = ["เงินสด", "โอน", "บัตร"] as const;
