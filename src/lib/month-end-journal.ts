// ============================================================
// คิดครัว — the month-end closing journal (Kong 2026-10-29)
// ============================================================
// One adjusting entry per month, the one an accountant posts for a shop on
// the periodic inventory system (PEAK's own guide: debit closing stock and
// cost of sales, credit purchases and opening stock). Pure, so the page's
// preview and the downloaded file are built by the same function and cannot
// disagree.
//
// Money is handled in SATANG (integers) from the moment it arrives: the
// figures were rounded to the satang upstream (rule ME3), and summing floats
// is how a balanced entry ends up 0.01 out.
//
// Every line is a SIGNED amount, + debit / − credit, and the cost-of-sales
// line is whatever balances the entry. That makes "debit = credit" true by
// construction and keeps the one rule in one place: a negative figure (a
// branch whose count found more than it held) flips side instead of printing
// a negative debit, which no accounting program accepts.
// ============================================================

export type JournalMode = "full" | "diff";
export type JournalScope = "company" | "branch";
export type AccountKey = "inventory" | "purchases" | "cogs" | "shrinkage" | "interBranch";
export type AccountRef = { code: string; name: string };
export type AccountMap = Record<AccountKey, AccountRef>;

/** One branch's month, already rounded to the satang (baht with 2 decimals). */
export type MonthEndFigures = {
  branchName: string;
  opening: number;
  purchases: number;
  transfersIn: number;
  transfersOut: number;
  closing: number;
  /** The part a shop may book on its own account when `split` is on. */
  shrinkage: number;
};

export type JournalLine = {
  account: AccountKey;
  code: string;
  name: string;
  /** Satang. Exactly one of debit / credit is non-zero. */
  debit: number;
  credit: number;
  memo: string;
};

export type JournalGroup = {
  /** 1-based — PEAK's ลำดับที่, QuickBooks' Journal No. */
  no: number;
  /** null for the whole-shop entry. */
  branchName: string | null;
  lines: JournalLine[];
};

export type Journal = {
  groups: JournalGroup[];
  totalDebit: number;
  totalCredit: number;
};

export const toSatang = (baht: number): number => Math.round(baht * 100);
export const fromSatang = (satang: number): number => satang / 100;

const MEMO = {
  closing: "สต๊อกสิ้นเดือน",
  opening: "กลับยอดสต๊อกต้นเดือน",
  purchases: "ปิดบัญชีซื้อของเดือน",
  cogs: "ต้นทุนขายของเดือน",
  cogsSplit: "ต้นทุนขายของเดือน (ไม่รวมของขาด)",
  shrinkage: "ของขาดจากการนับ สุทธิ",
  diffInventory: "ปรับสต๊อกให้ตรงกับยอดสิ้นเดือน",
  diffCogs: "ปรับต้นทุนขายตามสต๊อกที่เปลี่ยนไป",
  interBranch: "โอนของระหว่างสาขา",
} as const;

/** The whole shop as one row: transfers between its own branches cancel out. */
export function sumFigures(rows: readonly MonthEndFigures[]): MonthEndFigures {
  const s = (pick: (r: MonthEndFigures) => number) => fromSatang(rows.reduce((t, r) => t + toSatang(pick(r)), 0));
  return {
    branchName: "",
    opening: s((r) => r.opening),
    purchases: s((r) => r.purchases),
    transfersIn: s((r) => r.transfersIn),
    transfersOut: s((r) => r.transfersOut),
    closing: s((r) => r.closing),
    shrinkage: s((r) => r.shrinkage),
  };
}

/** Cost of goods sold by the identity: opening + purchases + in − out − closing. */
export function cogsOf(f: MonthEndFigures): number {
  return fromSatang(
    toSatang(f.opening) + toSatang(f.purchases) + toSatang(f.transfersIn) - toSatang(f.transfersOut) - toSatang(f.closing)
  );
}

function linesFor(f: MonthEndFigures, mode: JournalMode, split: boolean, accounts: AccountMap): JournalLine[] {
  const o = toSatang(f.opening);
  const p = toSatang(f.purchases);
  const tin = toSatang(f.transfersIn);
  const tout = toSatang(f.transfersOut);
  const c = toSatang(f.closing);
  const shr = split ? toSatang(f.shrinkage) : 0;

  const signed: [AccountKey, number, string][] =
    mode === "full"
      ? [
          ["inventory", c, MEMO.closing],
          ["cogs", o + p + tin - tout - c - shr, split ? MEMO.cogsSplit : MEMO.cogs],
          ["shrinkage", shr, MEMO.shrinkage],
          ["inventory", -o, MEMO.opening],
          ["purchases", -p, MEMO.purchases],
          ["interBranch", tout - tin, MEMO.interBranch],
        ]
      : [
          ["inventory", c - o, MEMO.diffInventory],
          ["cogs", o - c + tin - tout - shr, MEMO.diffCogs],
          ["shrinkage", shr, MEMO.shrinkage],
          ["interBranch", tout - tin, MEMO.interBranch],
        ];

  return signed
    .filter(([, amount]) => amount !== 0)
    .map(([account, amount, memo]) => ({
      account,
      code: accounts[account].code,
      name: accounts[account].name,
      debit: amount > 0 ? amount : 0,
      credit: amount < 0 ? -amount : 0,
      memo,
    }));
}

/**
 * The entry for a month: one group for the whole shop, or one per branch.
 * Per branch, goods one branch sent another sit on the inter-branch account,
 * and across all branches those lines sum to nothing.
 */
export function buildMonthEndJournal(input: {
  branches: readonly MonthEndFigures[];
  mode: JournalMode;
  split: boolean;
  scope: JournalScope;
  accounts: AccountMap;
}): Journal {
  const { branches, mode, split, scope, accounts } = input;
  const sources: { branchName: string | null; f: MonthEndFigures }[] =
    scope === "company"
      ? [{ branchName: null, f: sumFigures(branches) }]
      : branches.map((f) => ({ branchName: f.branchName, f }));

  const groups: JournalGroup[] = [];
  for (const { branchName, f } of sources) {
    const lines = linesFor(f, mode, split, accounts);
    if (lines.length > 0) groups.push({ no: groups.length + 1, branchName, lines });
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const g of groups) for (const l of g.lines) {
    totalDebit += l.debit;
    totalCredit += l.credit;
  }
  return { groups, totalDebit, totalCredit };
}

/** Which accounts an entry actually uses — what must have a code before an import. */
export function accountsUsed(journal: Journal): AccountKey[] {
  const used = new Set<AccountKey>();
  for (const g of journal.groups) for (const l of g.lines) used.add(l.account);
  return [...used];
}
