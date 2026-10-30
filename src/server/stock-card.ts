// ============================================================
// Mise — the stock card (บัตรสต๊อก) of one product at one branch
// (Kong 2026-10-25, stock mockup XYYyUgNP18V4HL3vUwrUf1)
// ============================================================
// The kardex every stock system has: the balance brought forward, each
// movement in time order with in / out / balance after it, and the balance at
// the end — which must equal what /products shows, or something is wrong.
// Each row names the document it came from and links to it.
//
// Rule SC-BAL: the running balance is built from EVERY movement of the product
// at the branch, in the ledger's own order (occurred_at, then created_at);
// filtering what is shown never changes the balance printed beside a row.
// Rule SC-VALUE: the baht beside an outgoing row is what the FIFO walk says
// that movement cost — the same walk /cost reads. Incoming rows carry no baht
// here (their money is on the document they link to).
// ============================================================

import { movementDocumentsInTx } from "@/server/movement-documents";
import type { PrismaClient, SourceType } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { replayPairsInTx } from "./stock-cost";

const BKK_MS = 7 * 3_600_000;
const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? 0 : Number(d.toString()));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type StockCardRow = {
  id: string;
  date: string;
  type: string;
  sourceType: SourceType;
  qty: number;
  balance: number;
  /** FIFO baht of an outgoing row; null for incoming rows or without the cost ticket. */
  value: number | null;
  by: string | null;
  doc: { label: string; href: string | null } | null;
};

export type StockCard = {
  product: { id: string; name: string; unit: string };
  opening: number;
  closing: number;
  rows: StockCardRow[];
  /** Totals by source for the period. */
  bySource: { sourceType: SourceType; qty: number; count: number }[];
  totalIn: number;
  totalOut: number;
};

export async function getStockCardLogic(
  tenantId: string,
  q: { productId: string; branchId: string; from: Date; to: Date; withCost: boolean }
): Promise<StockCard | null> {
  const start = new Date(q.from.getTime() - BKK_MS);
  const end = new Date(q.to.getTime() + 86_400_000 - BKK_MS);
  return withTenantContext(
    tenantId,
    async (raw) => {
      const tx = raw as unknown as PrismaClient;
      const product = await tx.product.findFirst({
        where: { id: q.productId, tenantId },
        select: { id: true, name: true, productUnits: { where: { isBase: true }, select: { unitName: true }, take: 1 } },
      });
      if (!product) return null;
      const [before, moves, replayed] = await Promise.all([
        tx.stockMovement.aggregate({ where: { tenantId, productId: q.productId, branchId: q.branchId, occurredAt: { lt: start } }, _sum: { qty: true } }),
        tx.stockMovement.findMany({
          where: { tenantId, productId: q.productId, branchId: q.branchId, occurredAt: { gte: start, lt: end } },
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { id: true, occurredAt: true, type: true, sourceType: true, sourceId: true, qty: true, createdByUser: { select: { name: true, email: true } } },
        }),
        q.withCost ? replayPairsInTx(tx, tenantId, [q.productId], [q.branchId]) : Promise.resolve(null),
      ]);

      const outValue = new Map<string, number>();
      if (replayed) for (const c of replayed.values()) for (const o of c.outflows) outValue.set(o.movementId, num(o.value));

      // The document behind each row — the same lookup the raw Excel export
      // uses, so the file and the card name a row's document alike.
      const docs = await movementDocumentsInTx(
        tx,
        moves.map((m) => ({ id: m.id, sourceType: m.sourceType, sourceId: m.sourceId, branchId: q.branchId, productId: q.productId }))
      );
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      const opening = r3(num(before._sum.qty));
      let bal = opening;
      let totalIn = 0;
      let totalOut = 0;
      const by = new Map<SourceType, { qty: number; count: number }>();
      const rows: StockCardRow[] = moves.map((m) => {
        const qty = num(m.qty);
        bal = r3(bal + qty);
        if (qty > 0) totalIn += qty;
        else totalOut -= qty;
        const b = by.get(m.sourceType) ?? { qty: 0, count: 0 };
        b.qty += qty;
        b.count++;
        by.set(m.sourceType, b);
        return {
          id: m.id,
          date: iso(new Date(m.occurredAt.getTime() + BKK_MS)),
          type: m.type,
          sourceType: m.sourceType,
          qty,
          balance: bal,
          value: qty < 0 && outValue.has(m.id) ? Math.round(outValue.get(m.id)! * 100) / 100 : null,
          by: m.createdByUser?.name ?? m.createdByUser?.email?.split("@")[0] ?? null,
          doc: docs.get(m.id) ?? null,
        };
      });
      return {
        product: { id: product.id, name: product.name, unit: product.productUnits[0]?.unitName ?? "" },
        opening,
        closing: bal,
        rows,
        bySource: [...by].map(([sourceType, v]) => ({ sourceType, qty: r3(v.qty), count: v.count })),
        totalIn: r3(totalIn),
        totalOut: r3(totalOut),
      };
    },
    { timeout: 20_000 }
  );
}
