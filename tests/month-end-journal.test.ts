// ============================================================
// คิดครัว — the month-end closing journal (Kong 2026-10-29)
// ============================================================
// Pure. The page previews this entry and the file carries it, so these are
// the promises both make: it always balances, a negative figure changes
// side rather than printing a negative debit, and goods moved between the
// shop's own branches cancel out.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  buildMonthEndJournal,
  cogsOf,
  sumFigures,
  type AccountMap,
  type MonthEndFigures,
} from "@/lib/month-end-journal";

const ACC: AccountMap = {
  inventory: { code: "113101", name: "สินค้าคงเหลือ" },
  purchases: { code: "511101", name: "ซื้อวัตถุดิบ" },
  cogs: { code: "510101", name: "ต้นทุนขาย" },
  shrinkage: { code: "510201", name: "สินค้าขาด" },
  interBranch: { code: "119901", name: "พักระหว่างสาขา" },
};

// The demo shop's September, as the page showed it on 2026-10-29.
const ARI: MonthEndFigures = {
  branchName: "อารีย์",
  opening: 171266.58,
  purchases: 390645.36,
  transfersIn: 0,
  transfersOut: 1537.41,
  closing: 315702.21,
  shrinkage: 13829.55,
};
const LAD: MonthEndFigures = {
  branchName: "ลาดพร้าว",
  opening: 0,
  purchases: 0,
  transfersIn: 1537.41,
  transfersOut: 0,
  closing: 1918.4,
  shrinkage: -380.99,
};

const amounts = (j: ReturnType<typeof buildMonthEndJournal>) =>
  j.groups.flatMap((g) => g.lines.map((l) => [l.account, l.debit, l.credit] as const));

describe("month-end journal", () => {
  it("J1 the whole-shop entry is the periodic closing entry, and it balances", () => {
    const j = buildMonthEndJournal({ branches: [ARI, LAD], mode: "full", split: false, scope: "company", accounts: ACC });
    expect(j.groups).toHaveLength(1);
    expect(amounts(j)).toEqual([
      ["inventory", 31762061, 0],
      ["cogs", 24429133, 0],
      ["inventory", 0, 17126658],
      ["purchases", 0, 39064536],
    ]);
    expect(j.totalDebit).toBe(j.totalCredit);
    expect(j.totalDebit).toBe(56191194);
  });

  it("J2 transfers between the shop's own branches cancel in the whole-shop entry", () => {
    const j = buildMonthEndJournal({ branches: [ARI, LAD], mode: "full", split: false, scope: "company", accounts: ACC });
    expect(j.groups[0].lines.some((l) => l.account === "interBranch")).toBe(false);
    expect(sumFigures([ARI, LAD]).transfersIn).toBe(sumFigures([ARI, LAD]).transfersOut);
  });

  it("J3 per branch, each entry balances on its own and the inter-branch lines sum to nothing", () => {
    for (const mode of ["full", "diff"] as const) {
      const j = buildMonthEndJournal({ branches: [ARI, LAD], mode, split: true, scope: "branch", accounts: ACC });
      expect(j.groups.map((g) => g.branchName)).toEqual(["อารีย์", "ลาดพร้าว"]);
      for (const g of j.groups) {
        const dr = g.lines.reduce((s, l) => s + l.debit, 0);
        const cr = g.lines.reduce((s, l) => s + l.credit, 0);
        expect(dr).toBe(cr);
      }
      const inter = j.groups.flatMap((g) => g.lines).filter((l) => l.account === "interBranch");
      expect(inter.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
      expect(inter).toHaveLength(2);
    }
  });

  it("J4 a negative cost of sales changes side — no program accepts a negative debit", () => {
    const j = buildMonthEndJournal({ branches: [LAD], mode: "full", split: false, scope: "branch", accounts: ACC });
    const cogs = j.groups[0].lines.find((l) => l.account === "cogs")!;
    expect(cogsOf(LAD)).toBe(-380.99);
    expect(cogs.debit).toBe(0);
    expect(cogs.credit).toBe(38099);
    for (const l of j.groups[0].lines) {
      expect(l.debit >= 0 && l.credit >= 0).toBe(true);
      expect(l.debit === 0 || l.credit === 0).toBe(true);
    }
  });

  it("J5 splitting the shortage out moves money between two debits and changes no total", () => {
    const whole = buildMonthEndJournal({ branches: [ARI], mode: "full", split: false, scope: "company", accounts: ACC });
    const split = buildMonthEndJournal({ branches: [ARI], mode: "full", split: true, scope: "company", accounts: ACC });
    const of = (j: typeof whole, k: string) => j.groups[0].lines.find((l) => l.account === k)?.debit ?? 0;
    expect(of(split, "cogs") + of(split, "shrinkage")).toBe(of(whole, "cogs"));
    expect(of(split, "shrinkage")).toBe(1382955);
    expect(split.totalDebit).toBe(split.totalCredit);
  });

  it("J6 the difference-only entry moves stock by closing − opening and nothing else", () => {
    const j = buildMonthEndJournal({ branches: [ARI, LAD], mode: "diff", split: false, scope: "company", accounts: ACC });
    expect(amounts(j)).toEqual([
      ["inventory", 14635403, 0],
      ["cogs", 0, 14635403],
    ]);
  });

  it("J7 zero lines are left out, and a month with nothing in it is an empty entry", () => {
    const none: MonthEndFigures = { branchName: "x", opening: 0, purchases: 0, transfersIn: 0, transfersOut: 0, closing: 0, shrinkage: 0 };
    const j = buildMonthEndJournal({ branches: [none], mode: "full", split: true, scope: "company", accounts: ACC });
    expect(j.groups).toHaveLength(0);
    expect(j.totalDebit).toBe(0);
  });

  it("J8 sums in satang: 0.1 + 0.2 never leaves the entry a satang out", () => {
    const f: MonthEndFigures = { branchName: "x", opening: 0.1, purchases: 0.2, transfersIn: 0, transfersOut: 0, closing: 0.15, shrinkage: 0 };
    const j = buildMonthEndJournal({ branches: [f, f, f], mode: "full", split: false, scope: "company", accounts: ACC });
    expect(j.totalDebit).toBe(j.totalCredit);
    expect(cogsOf(sumFigures([f, f, f]))).toBe(0.45);
  });
});
