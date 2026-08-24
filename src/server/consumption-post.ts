// ============================================================
// Mise — posting a day's consumption (Part 22 L3b, ADR 0022)
// ============================================================
// The writer. It takes the demand `consumption.ts` computed and turns it into a
// `sales_consumption_run`, its items, and their ledger movements.
//
// Two acts live here, and Q2b is the reason they are one file: posting a day
// that was already posted VOIDS the whole day first and posts it afresh. It is
// not a top-up — a top-up would silently miss a recipe that was *edited* rather
// than added, because that dish already counts as posted.
//
// The void is exported on its own because Q5 needs it from the import: a re-import
// must take the day back automatically, inside the import's own transaction. It
// is safe there for the exact reason posting is not — **voiding needs no recipe**,
// so it cannot fail on a cycle or a missing yield.
// ============================================================

import {
  Prisma,
  type ConsumptionVoidReason,
  type PrismaClient,
  type SalesConsumptionItem,
  type SalesConsumptionRun,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import { createStockMovementLogic } from "@/server/stock-movement";
import {
  computeConsumptionForDayLogic,
  type ConsumptionDemand,
} from "@/server/consumption";

/**
 * A day can explode fifty menus, walk five levels of recipe and write a hundred
 * movements. Prisma's default 5 s is a transaction budget for a form submit, not
 * for this — the goods-receipt confirm needed 20 s for a handful of lines.
 */
const POST_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

const ZERO = new Prisma.Decimal(0);

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

/**
 * The day already carries a live posting, and the caller has not said they mean
 * to replace it (Q2b).
 *
 * Carries what the screen has to show before it can honestly ask again: when it
 * was posted, and how much of the day it covered — pressing on discards a real
 * result, and "are you sure" with nothing in it is not a question.
 */
export class ConsumptionAlreadyPostedError extends Error {
  constructor(
    public readonly businessDate: Date,
    public readonly runId: string,
    public readonly postedAt: Date,
    public readonly coveredNetAmount: Prisma.Decimal,
    public readonly totalNetAmount: Prisma.Decimal
  ) {
    super(
      `Consumption for ${businessDate.toISOString().slice(0, 10)} is already posted (run ${runId})`
    );
    this.name = "ConsumptionAlreadyPostedError";
  }
}

// ------------------------------------------------------------
// Result
// ------------------------------------------------------------

export type ConsumptionRunResult = {
  run: SalesConsumptionRun;
  items: SalesConsumptionItem[];
  /** The run that this one replaced, when there was one. */
  voidedRunId: string | null;
  demand: ConsumptionDemand;
};

// ------------------------------------------------------------
// Posting
// ------------------------------------------------------------

/**
 * Post one branch's consumption for one business day.
 *
 * IDEMPOTENT by `submitKey`. The run's id is DERIVED from the key and the day,
 * so a retried submission recomputes the same id and finds the row it already
 * wrote. Using the key itself as the id — the Part 13.5 / waste pattern — does
 * not stretch here, because one press covers up to a month of days and only the
 * first of them could claim the key.
 */
export async function postConsumptionForDayLogic(
  tenantId: string,
  input: {
    submitKey: string;
    branchId: string;
    businessDate: Date;
    acknowledgeRepost: boolean;
  },
  postedBy: string
): Promise<ConsumptionRunResult> {
  const runId = runIdFor(input.submitKey, input.businessDate);

  return withTenantContext(
    tenantId,
    async (tx) => {
      const replay = await tx.salesConsumptionRun.findFirst({
        where: { tenantId, id: runId },
        include: { items: true },
      });
      if (replay !== null) {
        return {
          run: replay,
          items: replay.items,
          voidedRunId: null,
          // A replay does not recompute: the answer is the one that was written,
          // and re-exploding could differ if a recipe changed in between — which
          // is exactly what a retry must NOT quietly do.
          demand: demandOf(replay),
        };
      }

      await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);

      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { cancelledSalePolicy: true },
      });

      // --- Q2b: a day already posted is taken back, whole, before anything new ---
      const live = await tx.salesConsumptionRun.findFirst({
        where: {
          tenantId,
          branchId: input.branchId,
          businessDate: input.businessDate,
          voidedAt: null,
        },
        select: {
          id: true,
          postedAt: true,
          coveredNetAmount: true,
          totalNetAmount: true,
        },
      });
      if (live !== null && !input.acknowledgeRepost) {
        throw new ConsumptionAlreadyPostedError(
          input.businessDate,
          live.id,
          live.postedAt,
          live.coveredNetAmount,
          live.totalNetAmount
        );
      }
      if (live !== null) {
        await voidConsumptionRunInTx(tx, tenantId, live.id, "REPOST", postedBy);
      }

      const demand = await computeConsumptionForDayLogic(tx, tenantId, {
        branchId: input.branchId,
        businessDate: input.businessDate,
        cancelledSalePolicy: tenant.cancelledSalePolicy,
      });

      // The run is written even when nothing could post. It is the document that
      // says "this day was attempted, and here is why none of it landed" — and
      // without it the screen cannot tell a day nobody tried from a day where
      // every dish was missing its recipe.
      const run = await tx.salesConsumptionRun.create({
        data: {
          id: runId,
          tenantId,
          branchId: input.branchId,
          businessDate: input.businessDate,
          postedAt: new Date(),
          postedBy,
          cancelledSalePolicy: demand.cancelledSalePolicy,
          coveredNetAmount: demand.coveredNetAmount,
          totalNetAmount: demand.totalNetAmount,
          menusPosted: demand.menusPosted,
          menusSkipped: demand.menusSkipped,
          skippedMenus: demand.skipped.map((s) => ({
            menuId: s.menuId,
            menuName: s.menuName,
            qty: s.qty.toString(),
            netAmount: s.netAmount.toString(),
            reason: s.reason,
            detail: s.detail,
          })),
        },
      });

      const items: SalesConsumptionItem[] = [];
      for (const line of demand.lines) {
        const item = await tx.salesConsumptionItem.create({
          data: {
            tenantId,
            runId: run.id,
            productId: line.productId,
            qty: line.qty,
          },
        });
        items.push(item);
        await postMovementForItem(tx, tenantId, {
          item,
          branchId: input.branchId,
          occurredAt: input.businessDate,
          createdBy: postedBy,
        });
      }

      return { run, items, voidedRunId: live?.id ?? null, demand };
    },
    POST_TX_OPTIONS
  );
}

// ------------------------------------------------------------
// Voiding
// ------------------------------------------------------------

/**
 * Take a posted day back, inside the caller's transaction.
 *
 * Exported in this shape because Q5 calls it from the import commit: superseding
 * a day's sales makes its movements refer to sales that no longer stand, and the
 * ledger must not sit knowingly wrong until someone notices. It is safe to run
 * there because it never touches a recipe — it reads the movements already
 * posted and appends their negation.
 *
 * Per Part 17's rule the reversal is valued from the ORIGINAL MOVEMENT, never
 * recomputed: `qty` is read back from the posted row rather than re-derived from
 * today's recipe or today's unit ratios.
 */
export async function voidConsumptionRunInTx(
  tx: PrismaClient,
  tenantId: string,
  runId: string,
  reason: ConsumptionVoidReason,
  voidedBy: string
): Promise<{ reversedItems: number }> {
  const run = await tx.salesConsumptionRun.findFirst({
    where: { tenantId, id: runId, voidedAt: null },
    include: { items: { where: { reversalOfItemId: null } } },
  });
  // Already voided, or never existed. Not an error: a re-import and a re-post can
  // both reach for the same day, and the second must find the work done rather
  // than fail — the whole point of `sales_consumption_run_live_unique`.
  if (run === null) return { reversedItems: 0 };

  for (const original of run.items) {
    const reversal = await tx.salesConsumptionItem.create({
      data: {
        tenantId,
        runId: run.id,
        productId: original.productId,
        qty: original.qty.negated(),
        reversalOfItemId: original.id,
      },
    });
    await postMovementForItem(tx, tenantId, {
      item: reversal,
      branchId: run.branchId,
      // NOW, not the day it consumed (ADR 0013 Q6's clarification). Backdating a
      // compensating movement would silently change the balance "as of" a past
      // date and force the cost engine to re-value a period the shop may have
      // closed.
      occurredAt: new Date(),
      createdBy: voidedBy,
    });
  }

  await tx.salesConsumptionRun.update({
    where: { id: run.id },
    data: { voidedAt: new Date(), voidedBy, voidReason: reason },
  });

  return { reversedItems: run.items.length };
}

/**
 * Void whatever live run covers a branch's day, if any. The shape the import
 * wants (Q5): it knows the days it replaced, not the runs.
 */
export async function voidConsumptionForDayInTx(
  tx: PrismaClient,
  tenantId: string,
  branchId: string,
  businessDate: Date,
  reason: ConsumptionVoidReason,
  voidedBy: string
): Promise<{ voidedRunId: string | null; reversedItems: number }> {
  const live = await tx.salesConsumptionRun.findFirst({
    where: { tenantId, branchId, businessDate, voidedAt: null },
    select: { id: true },
  });
  if (live === null) return { voidedRunId: null, reversedItems: 0 };

  const { reversedItems } = await voidConsumptionRunInTx(
    tx,
    tenantId,
    live.id,
    reason,
    voidedBy
  );
  return { voidedRunId: live.id, reversedItems };
}

/**
 * Which of these days already carry a live posting.
 *
 * The action asks BEFORE it writes anything, so a press that would replace six
 * days refuses once, names all six, and then obeys — rather than posting four
 * and stopping at the fifth (the Q8 shape Part 21 already uses for copying a
 * recipe onto branches that decided for themselves).
 */
export async function findLivePostedDaysLogic(
  tenantId: string,
  branchId: string,
  businessDates: Date[]
): Promise<
  {
    businessDate: Date;
    postedAt: Date;
    coveredNetAmount: Prisma.Decimal;
    totalNetAmount: Prisma.Decimal;
  }[]
> {
  if (businessDates.length === 0) return [];
  return withTenantContext(tenantId, (tx) =>
    tx.salesConsumptionRun.findMany({
      where: {
        tenantId,
        branchId,
        voidedAt: null,
        businessDate: { in: businessDates },
      },
      select: {
        businessDate: true,
        postedAt: true,
        coveredNetAmount: true,
        totalNetAmount: true,
      },
      orderBy: { businessDate: "asc" },
    })
  );
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * One item, one movement, with the type following the sign.
 *
 * `stock_movement_sign_check` binds one sign to each type, so the direction is
 * not a choice here — it is read off the quantity. A positive ordinary item is
 * the TREAT_AS_NOT_COOKED case where a day's cancellations outweighed its sales;
 * a positive reversal item is a day being taken back. Both are stock arriving,
 * and both are `CONSUMPTION_REVERSAL`.
 */
async function postMovementForItem(
  tx: PrismaClient,
  tenantId: string,
  args: {
    item: SalesConsumptionItem;
    branchId: string;
    occurredAt: Date;
    createdBy: string;
  }
): Promise<void> {
  const { item } = args;
  await createStockMovementLogic(tx, {
    tenantId,
    productId: item.productId,
    branchId: args.branchId,
    qty: item.qty,
    type: item.qty.lessThan(ZERO) ? "CONSUMPTION" : "CONSUMPTION_REVERSAL",
    sourceType: "SALES_CONSUMPTION",
    sourceId: item.id,
    occurredAt: args.occurredAt,
    createdBy: args.createdBy,
  });
}

/**
 * A stable id for the run this submission will write for this day.
 *
 * A name-based UUID (RFC 4122 v5 in shape: sha1 of the pair, with the version
 * and variant bits set), so a replayed press recomputes the same id rather than
 * writing the day twice. Same device, and the same reason, as `versionIdFor` in
 * `recipe.ts`: one submission produces N rows, and using the key as one row's id
 * would leave the other N−1 unreachable.
 */
function runIdFor(submitKey: string, businessDate: Date): string {
  const day = businessDate.toISOString().slice(0, 10);
  const digest = createHash("sha1").update(`${submitKey}:${day}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The demand a stored run recorded, reconstructed for a replayed submission. */
function demandOf(
  run: SalesConsumptionRun & { items: SalesConsumptionItem[] }
): ConsumptionDemand {
  const skipped = Array.isArray(run.skippedMenus)
    ? (run.skippedMenus as unknown[]).map((raw) => {
        const s = raw as Record<string, string | null>;
        return {
          menuId: s.menuId as string,
          menuName: s.menuName as string,
          qty: new Prisma.Decimal(s.qty ?? "0"),
          netAmount: new Prisma.Decimal(s.netAmount ?? "0"),
          reason: s.reason as ConsumptionDemand["skipped"][number]["reason"],
          detail: s.detail ?? null,
        };
      })
    : [];

  return {
    branchId: run.branchId,
    businessDate: run.businessDate,
    lines: run.items
      .filter((i) => i.reversalOfItemId === null)
      .map((i) => ({ productId: i.productId, qty: i.qty })),
    coveredNetAmount: run.coveredNetAmount,
    totalNetAmount: run.totalNetAmount,
    menusPosted: run.menusPosted,
    menusSkipped: run.menusSkipped,
    skipped,
    cancelledSalePolicy: run.cancelledSalePolicy,
  };
}
