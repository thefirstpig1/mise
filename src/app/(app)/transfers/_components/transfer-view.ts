// ============================================================
// Mise — transfer view serializers (Sprint 3 Part 18 L4)
// ============================================================
// Where transfer documents become plain JSON for Client Components. The same two
// rules as waste-view.ts and stock-view.ts:
//
//   - Prisma.Decimal CANNOT cross to a Client Component (Pitfall #20) — every
//     quantity and every baht figure leaves here as a STRING, never a number.
//   - Dates leave as ISO strings, plus a Bangkok-rendered label computed HERE,
//     or a list appended client-side formats page 1 in Node and page 2 in the
//     browser and hydration mismatches on both.
//
// One thing this Part adds to that list, and it is the reason `statusLabel` and
// `statusHint` are computed here rather than in a component: **`SENT` invites
// exactly the wrong guess.** It does not mean the stock is missing from the
// receiving branch — both ledger legs posted at dispatch (ADR 0018 Q1). Any
// screen showing the bare word without the sentence beside it is teaching the
// reader something false, so the sentence travels with the row.
// ============================================================

import type { Prisma, StockTransferStatus } from "@prisma/client";
import type { CostAccess } from "@/lib/permissions/cost-access";
import type { TransferDetail } from "@/server/transfer";
import {
  TRANSFER_STATUS_HINTS_TH,
  TRANSFER_STATUS_LABELS_TH,
} from "@/lib/validations/transfer";
import { COST_SOURCE_LABELS_TH } from "@/lib/validations/stock-cost";
import type { CostSource } from "@/lib/validations/stock-cost";

const str = (d: Prisma.Decimal): string => d.toString();

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * A dispatch is a true INSTANT, not a date (ADR 0018 Q1 / ADR 0013 Q4), so the
 * label carries the time. "18 ส.ค. 2569" alone would make two transfers of the
 * same morning and the same evening indistinguishable on screen, and which came
 * first is exactly what someone chasing a missing crate needs.
 */
const BANGKOK_DATETIME = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export type TransferLineView = {
  id: string;
  lineNo: number;
  product: {
    id: string;
    name: string;
    sku: string;
    baseUnitName: string | null;
  };
  /** As entered, in `inputUnitName` — never the base unit. */
  qtySent: string;
  /**
   * `null` means **nobody has counted yet**, which is a different thing from a
   * counted zero and must stay distinguishable all the way to the screen (Q2).
   */
  qtyReceived: string | null;
  inputUnitName: string;
  /** Dispatched minus received, once there is a count. Positive = went missing. */
  qtyMissing: string | null;
  /** The money frozen at dispatch (Q5), as a string (Pitfall #20). */
  /** Null when the reader may not see cost — never 0, never a dash. */
  costTotal: string | null;
  /** How well the SENDING branch knew that money — 0.00 is not always free. */
  costSource: CostSource;
  costSourceLabel: string;
  notes: string | null;
  /** true when this row IS the correction rather than the thing corrected. */
  isReversal: boolean;
};

export type TransferView = {
  id: string;
  tfNumber: string;
  status: StockTransferStatus;
  statusLabel: string;
  /** The sentence that stops `SENT` being read as "the stock has not moved". */
  statusHint: string;
  fromBranch: { id: string; name: string; code: string };
  toBranch: { id: string; name: string; code: string };
  dispatchedAt: string;
  dispatchedAtLabel: string;
  /** Who the account says, and who actually handed the goods over. */
  dispatchedByAccount: string | null;
  dispatchedByName: string | null;
  /**
   * The driver. `driverAccount` is null on every row until user management ships
   * (ADR 0018 Q3) — the NAME is the record, and the UI must read it that way.
   */
  driverName: string | null;
  driverAccount: string | null;
  driverConfirmedAt: string | null;
  driverConfirmedAtLabel: string | null;
  receivedAt: string | null;
  receivedAtLabel: string | null;
  receivedByAccount: string | null;
  receivedByName: string | null;
  voidedAt: string | null;
  voidedAtLabel: string | null;
  voidReason: string | null;
  notes: string | null;
  lines: TransferLineView[];
  /**
   * Row scale as a COUNT, never a summed quantity — Part 17's UX pass lesson.
   * "3 กระสอบ + 5 kg" is not 8 of anything, and a total that means nothing is
   * worse than no total.
   */
  lineCount: number;
  /** Total money on the move, which IS summable — it is all baht. */
  /** Null when the reader may not see cost (rule A8). */
  totalCost: string | null;
  /** True when the nulls above are about permission, not about the data. */
  costHidden: boolean;
  /** Anything dispatched and never counted, in baht. Null until received. */
  hasShortage: boolean;
};

const account = (u: { name: string | null; email: string } | null) =>
  u ? (u.name ?? u.email) : null;

export function toTransferLineView(
  l: TransferDetail["items"][number],
  /**
   * A transfer line carries the sending branch's FIFO money FROZEN onto it —
   * the one deliberate exception to "cost is stored nowhere" (ADR 0018). So
   * unlike every other cost on a screen, this one needs no engine call to
   * leak: it arrives with the row. The ticket is checked HERE, at the
   * serializer, because that is the only place it passes through.
   */
  cost: CostAccess | null
): TransferLineView {
  const qtyMissing =
    l.qtyReceived === null ? null : l.qtySent.minus(l.qtyReceived);
  return {
    id: l.id,
    lineNo: l.lineNo,
    product: {
      id: l.product.id,
      name: l.product.name,
      sku: l.product.sku,
      baseUnitName: l.product.productUnits[0]?.unitName ?? null,
    },
    qtySent: str(l.qtySent),
    qtyReceived: l.qtyReceived === null ? null : str(l.qtyReceived),
    inputUnitName: l.inputUnitName,
    qtyMissing: qtyMissing === null ? null : str(qtyMissing),
    costTotal: cost === null ? null : str(l.costTotal),
    costSource: l.costSource,
    costSourceLabel: COST_SOURCE_LABELS_TH[l.costSource],
    notes: l.notes,
    isReversal: l.reversalOfItemId !== null,
  };
}

export function toTransferView(
  t: TransferDetail,
  cost: CostAccess | null
): TransferView {
  // Reversal lines are excluded from the totals but kept in `lines`, so a voided
  // document still reads as what happened AND what undid it — the same choice
  // Part 17 made for a voided waste entry.
  const live = t.items.filter((i) => i.reversalOfItemId === null);
  // Seeded from the first line rather than from a fresh Decimal(0): this file is
  // a serializer and imports Prisma as a TYPE only, the same discipline
  // waste-view.ts keeps so no Prisma runtime is dragged toward the client.
  const totalCost = live.reduce<Prisma.Decimal | null>(
    (sum, l) => (sum ? sum.plus(l.costTotal) : l.costTotal),
    null
  );

  return {
    id: t.id,
    tfNumber: t.tfNumber,
    status: t.status,
    statusLabel: TRANSFER_STATUS_LABELS_TH[t.status],
    statusHint: TRANSFER_STATUS_HINTS_TH[t.status],
    fromBranch: t.fromBranch,
    toBranch: t.toBranch,
    dispatchedAt: t.dispatchedAt.toISOString(),
    dispatchedAtLabel: BANGKOK_DATETIME.format(t.dispatchedAt),
    dispatchedByAccount: account(t.dispatchedByUser),
    dispatchedByName: t.dispatchedByName,
    driverName: t.driverName,
    driverAccount: account(t.driverUser),
    driverConfirmedAt: t.driverConfirmedAt?.toISOString() ?? null,
    driverConfirmedAtLabel: t.driverConfirmedAt
      ? BANGKOK_DATETIME.format(t.driverConfirmedAt)
      : null,
    receivedAt: t.receivedAt?.toISOString() ?? null,
    receivedAtLabel: t.receivedAt ? BANGKOK_DATETIME.format(t.receivedAt) : null,
    receivedByAccount: account(t.receivedByUser),
    receivedByName: t.receivedByName,
    voidedAt: t.voidedAt?.toISOString() ?? null,
    voidedAtLabel: t.voidedAt ? BANGKOK_DATE.format(t.voidedAt) : null,
    voidReason: t.voidReason,
    notes: t.notes,
    lines: t.items.map((l) => toTransferLineView(l, cost)),
    lineCount: live.length,
    totalCost: cost === null ? null : totalCost ? str(totalCost) : "0",
    costHidden: cost === null,
    hasShortage: live.some(
      (l) => l.qtyReceived !== null && l.qtyReceived.lessThan(l.qtySent)
    ),
  };
}
