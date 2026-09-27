// ============================================================
// Mise — วิเคราะห์รายจ่าย (Part 35 B, after Kong's "Dashboard รายจ่าย")
// ============================================================
// Kong's own expense sheet drilled from account → section → group →
// supplier, showed the top suppliers, a daily trend and an expandable bill
// table. This is that, over the bills Mise already holds.
//
// SPEND, BY BILL LINE. Every figure is `expense_item.total_price` (net of
// VAT, ADR 0016) filtered by the bill's date — the same lines /cost sums.
// A filter narrows the LINES, not the bills: a bill with rice and beer,
// filtered to beverages, counts only the beer (his banner said the same:
// "ไม่ใช่ยอดรวมทั้งบิล"), and says so on screen.
//
// Nothing here is a cost of goods SOLD — that is the P&L's job. This is what
// was bought and paid for.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";

const ZERO = () => new Prisma.Decimal(0);

export interface ExpenseAnalysisFilter {
  from: Date;
  to: Date;
  branchId?: string;
  account?: "COGS" | "OpEx";
  section?: string;
  group?: string;
  /** A supplier id, or "none" for bills with no supplier (rent, utilities). */
  supplier?: string;
}

export interface AnalysisLine {
  expenseId: string;
  billDate: Date;
  billNo: string | null;
  branchName: string;
  supplierId: string | null;
  supplierName: string | null;
  account: string;
  section: string;
  group: string;
  productId: string | null;
  productName: string | null;
  description: string;
  qty: Prisma.Decimal | null;
  unitName: string | null;
  total: Prisma.Decimal;
}

export interface Ranked {
  key: string;
  label: string;
  amount: Prisma.Decimal;
}

export interface ProductRow {
  productId: string;
  name: string;
  unitName: string | null;
  qty: Prisma.Decimal;
  amount: Prisma.Decimal;
  /** Average price per unit bought — null when the lines mix units. */
  avgPrice: Prisma.Decimal | null;
}

export interface BillRow {
  expenseId: string;
  billDate: Date;
  billNo: string | null;
  supplierName: string | null;
  branchName: string;
  amount: Prisma.Decimal;
  lines: AnalysisLine[];
}

export interface ExpenseAnalysis {
  total: Prisma.Decimal;
  billCount: number;
  lineCount: number;
  /** The choices the filter rows offer — computed BEFORE the level's own filter. */
  options: { sections: string[]; groups: string[]; suppliers: { key: string; label: string }[] };
  byAccount: Ranked[];
  bySection: Ranked[];
  byGroup: Ranked[];
  bySupplier: Ranked[];
  byDay: { day: string; amount: Prisma.Decimal }[];
  products: ProductRow[];
  bills: BillRow[];
}

const rank = (m: Map<string, { label: string; amount: Prisma.Decimal }>): Ranked[] =>
  [...m.entries()]
    .map(([key, v]) => ({ key, label: v.label, amount: v.amount }))
    .sort((a, b) => b.amount.comparedTo(a.amount));

function add(m: Map<string, { label: string; amount: Prisma.Decimal }>, key: string, label: string, amt: Prisma.Decimal) {
  const cur = m.get(key) ?? { label, amount: ZERO() };
  cur.amount = cur.amount.plus(amt);
  m.set(key, cur);
}

export const supplierKey = (l: Pick<AnalysisLine, "supplierId">) => l.supplierId ?? "none";

/** Pure: the whole page from the period's lines and the filter. Tested alone. */
export function analyse(all: AnalysisLine[], f: Omit<ExpenseAnalysisFilter, "from" | "to" | "branchId">): ExpenseAnalysis {
  const byAcc = all.filter((l) => !f.account || l.account === f.account);
  const bySec = byAcc.filter((l) => !f.section || l.section === f.section);
  const byGrp = bySec.filter((l) => !f.group || l.group === f.group);
  const lines = byGrp.filter((l) => !f.supplier || supplierKey(l) === f.supplier);

  const acc = new Map<string, { label: string; amount: Prisma.Decimal }>();
  const sec = new Map<string, { label: string; amount: Prisma.Decimal }>();
  const grp = new Map<string, { label: string; amount: Prisma.Decimal }>();
  const sup = new Map<string, { label: string; amount: Prisma.Decimal }>();
  const day = new Map<string, Prisma.Decimal>();
  const prod = new Map<string, ProductRow & { units: Set<string> }>();
  const bills = new Map<string, BillRow>();
  let total = ZERO();

  for (const l of lines) {
    total = total.plus(l.total);
    add(acc, l.account, l.account === "COGS" ? "ต้นทุน (ของที่ซื้อเข้าครัว)" : "ค่าใช้จ่ายดำเนินงาน", l.total);
    add(sec, l.section, l.section, l.total);
    add(grp, l.group, l.group, l.total);
    add(sup, supplierKey(l), l.supplierName ?? "ไม่มีผู้ขาย (เช่น ค่าเช่า ค่าน้ำไฟ)", l.total);
    const d = l.billDate.toISOString().slice(0, 10);
    day.set(d, (day.get(d) ?? ZERO()).plus(l.total));
    if (l.productId) {
      const p = prod.get(l.productId) ?? {
        productId: l.productId,
        name: l.productName ?? l.description,
        unitName: l.unitName,
        qty: ZERO(),
        amount: ZERO(),
        avgPrice: null,
        units: new Set<string>(),
      };
      p.amount = p.amount.plus(l.total);
      if (l.qty) p.qty = p.qty.plus(l.qty);
      p.units.add(l.unitName ?? "");
      prod.set(l.productId, p);
    }
    const b = bills.get(l.expenseId) ?? {
      expenseId: l.expenseId,
      billDate: l.billDate,
      billNo: l.billNo,
      supplierName: l.supplierName,
      branchName: l.branchName,
      amount: ZERO(),
      lines: [],
    };
    b.amount = b.amount.plus(l.total);
    b.lines.push(l);
    bills.set(l.expenseId, b);
  }

  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, "th"));
  const supOpts = new Map<string, string>();
  for (const l of byGrp) supOpts.set(supplierKey(l), l.supplierName ?? "ไม่มีผู้ขาย");

  return {
    total,
    billCount: bills.size,
    lineCount: lines.length,
    options: {
      sections: uniq(byAcc.map((l) => l.section)),
      groups: uniq(bySec.map((l) => l.group)),
      suppliers: [...supOpts.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "th")),
    },
    byAccount: rank(acc),
    bySection: rank(sec),
    byGroup: rank(grp),
    bySupplier: rank(sup),
    byDay: [...day.entries()].map(([d, amount]) => ({ day: d, amount })).sort((a, b) => a.day.localeCompare(b.day)),
    products: [...prod.values()]
      .map(({ units, ...p }) => ({
        ...p,
        // One unit across every line, or the average price is meaningless.
        unitName: units.size === 1 ? p.unitName : null,
        avgPrice: units.size === 1 && p.qty.gt(0) ? p.amount.div(p.qty) : null,
      }))
      .sort((a, b) => b.amount.comparedTo(a.amount)),
    bills: [...bills.values()].sort((a, b) => b.billDate.getTime() - a.billDate.getTime() || b.amount.comparedTo(a.amount)),
  };
}

export async function getExpenseAnalysisLogic(
  tenantId: string,
  filter: ExpenseAnalysisFilter,
  reach: BranchReach
): Promise<ExpenseAnalysis> {
  const rows = await withTenantContext(tenantId, async (tx) => {
    const branches = await tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach), ...(filter.branchId ? { id: filter.branchId } : {}) },
      select: { id: true },
    });
    return tx.expenseItem.findMany({
      where: {
        tenantId,
        expense: {
          tenantId,
          deletedAt: null,
          branchId: { in: branches.map((b) => b.id) },
          billDate: { gte: filter.from, lte: filter.to },
        },
      },
      select: {
        description: true,
        qty: true,
        totalPrice: true,
        productId: true,
        product: { select: { name: true } },
        productUnit: { select: { unitName: true } },
        category: { select: { account: true, accountingSection: true, groupName: true } },
        expense: {
          select: {
            id: true,
            billDate: true,
            billNo: true,
            supplierId: true,
            supplier: { select: { nameShort: true, nameFull: true } },
            branch: { select: { name: true } },
          },
        },
      },
    });
  });

  const lines: AnalysisLine[] = rows.map((r) => ({
    expenseId: r.expense.id,
    billDate: r.expense.billDate,
    billNo: r.expense.billNo,
    branchName: r.expense.branch.name,
    supplierId: r.expense.supplierId,
    supplierName: r.expense.supplier ? r.expense.supplier.nameShort || r.expense.supplier.nameFull : null,
    account: r.category.account,
    section: r.category.accountingSection,
    group: r.category.groupName,
    productId: r.productId,
    productName: r.product?.name ?? null,
    description: r.description,
    qty: r.qty,
    unitName: r.productUnit?.unitName ?? null,
    total: r.totalPrice,
  }));
  return analyse(lines, filter);
}
