// คิดครัว — the words and tones a staff-advance screen uses (ADR 0037 Q5–Q6).
// A plain module, so both the server logic's types and the client screens can
// read it — never a value import from a "use client" file (mise-ui-review §7).

import type { ClaimStatus } from "@/server/staff-advance";

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  NO_BILL: "ขาดรูปบิล",
  NO_SLIP: "ขาดสลิป",
  NEEDS_ENDORSE: "รอบัญชีรับรอง",
  NEEDS_APPROVAL: "รออนุมัติ",
  READY: "รอคืนเงิน",
  REFUNDED: "คืนแล้ว",
};

/** The kit's chip classes: missing proof is the person's job (bad), waiting is the office's (warn). */
export const CLAIM_STATUS_CHIP: Record<ClaimStatus, string> = {
  NO_BILL: "chip chip-bad",
  NO_SLIP: "chip chip-bad",
  NEEDS_ENDORSE: "chip chip-warn",
  NEEDS_APPROVAL: "chip chip-warn",
  READY: "chip",
  REFUNDED: "chip chip-good",
};

export const PAYMENT_METHOD_LABEL = { TRANSFER: "โอน", CASH: "เงินสด", CARD: "บัตร", OTHER: "อื่น ๆ" } as const;

export const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

const MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** "2026-10-28" → "28 ต.ค." — spelled out, so server and browser agree (no ICU drift). */
export const shortDate = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTH[Number(ymd.slice(5, 7)) - 1]}`;
/** "2026-10" → "ต.ค. 69" */
export const monthLabel = (ym: string) => `${MONTH[Number(ym.slice(5, 7)) - 1]} ${(Number(ym.slice(0, 4)) + 543) % 100}`;
