// ============================================================
// Mise — Product restore-on-recreate READ logic (Sprint 1 Part 8.5 L3a; ADR 0010)
// ============================================================
// Backs the restore-on-recreate flow (ADR 0010): a pg_trgm fuzzy typeahead over
// the tenant's SOFT-DELETED products at product-create time, plus the read paths
// the restore dialog/action need (orphan-mapping preview + sku-conflict check).
//
// Same pattern as src/server/{product,supplier-product-mapping}.ts: each fn takes
// `tenantId` as its FIRST argument, runs inside withTenantContext, and
// filters/sets `tenantId` EXPLICITLY (explicit filtering isolates tenants TODAY;
// RLS is inert until Sprint 7 — ADR 0004).
//
// Isolated in its OWN file (NOT folded into product.ts) on the Part 8.5 isolation
// pattern: product.ts already carries the highest test coverage (Risk #2 — 108
// Sprint 1 tests must stay green) and a lazy circular dep with the mapping slice;
// restore touches BOTH product and mappings, so a new file keeps that blast
// radius out of product.ts. Shared guards/errors are imported, not copied.
//
// WRITE logic (restoreProductLogic + supersede/overwrite branch) is L3b, added
// below: a soft-deleted-only pre-flight, the newSku/original-sku conflict guards,
// and the Bangkok-TZ same-day-overwrite vs Sprint 1 supersede (ADR 0009) branch.
// ============================================================

import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import {
  MappingNotFoundError,
  type MappingWithRefs,
} from "@/server/supplier-product-mapping";
import { ProductSkuConflictError, type ProductWithUnits } from "@/server/product";
import type { MappingUpdate } from "@/lib/validations/product-restore";

// --- tunables (exported: raw SQL below + UI badge/reveal logic in L5 reuse them) ---
/** pg_trgm similarity floor a candidate must clear on name OR sku (Q1). */
export const FUZZY_SIMILARITY_THRESHOLD = 0.4;
/** Max candidates pre-fetched per search (Q1: top 5 shown + 5 "ดูเพิ่มอีก 5"). */
export const FUZZY_RESULT_LIMIT = 10;

/**
 * A soft-deleted mapping price-row previewed under a candidate (Q6). Decimal
 * `currentUnitPrice` is serialized to string HERE because FuzzyMatchCandidate
 * crosses to a Client Component (the typeahead dropdown) — no Decimal across RSC
 * (Pitfall #20). Mirrors getLiquidDensityTemplates serializing gPerMl in product.ts.
 */
export type MappingPreview = {
  id: string;
  supplierName: string;
  currentUnitPrice: string | null;
  isPreferred: boolean;
  effectiveFrom: string; // ISO date (YYYY-MM-DD)
};

/**
 * One fuzzy-search hit returned to the typeahead (Q1/Q2/Q5/Q6). `score` is the
 * raw pg_trgm similarity (0–1) — the UI maps it to the coarse Thai badge, the
 * decimal itself is never shown. `matchedOn` says which field won the GREATEST so
 * a sku hit displayed by name doesn't confuse. `hasSkuConflict` flags a live
 * product already holding this candidate's sku (restore-as-is would collide).
 */
export type FuzzyMatchCandidate = {
  id: string;
  name: string;
  sku: string;
  score: number;
  matchedOn: "name" | "sku";
  hasSkuConflict: boolean;
  conflictingLiveProductName: string | null;
  orphanMappingCount: number;
  orphanMappingSample: MappingPreview[]; // top 3 by isPreferred DESC, effectiveFrom DESC
};

/** Result of the action-layer pre-check on a user-typed `newSku` (Q5). */
export type SkuConflictInfo = {
  hasConflict: boolean;
  conflictingProductName: string | null;
};

/** Raw row shape of the fuzzy SELECT (snake_case columns, pg_trgm score). */
type FuzzyRow = {
  id: string;
  name: string;
  sku: string;
  score: number;
  matched_on: "name" | "sku";
  conflict_live_id: string | null;
  conflict_live_name: string | null;
};

/** A live orphan mapping with just the supplier relation (the preview needs the name). */
type OrphanMappingWithSupplier = Prisma.SupplierProductMappingGetPayload<{
  include: { supplier: true };
}>;

/** Serialize one live orphan mapping to its display preview (Decimal → string). */
function toMappingPreview(m: OrphanMappingWithSupplier): MappingPreview {
  return {
    id: m.id,
    supplierName: m.supplier.nameFull,
    currentUnitPrice:
      m.currentUnitPrice === null ? null : m.currentUnitPrice.toString(),
    isPreferred: m.isPreferred,
    effectiveFrom: m.effectiveFrom.toISOString().slice(0, 10),
  };
}

/**
 * The live owner (if any) of `sku` within `tenantId`, EXCLUDING `excludeId`.
 * Encodes the sku-conflict rule once: a LIVE product (deletedAt null) sharing the
 * sku but with a different id. The partial unique index guarantees ≤1 such row,
 * so findFirst is exact. (fuzzySearch expresses the SAME predicate inline in SQL
 * — a JS helper can't be called mid-query — so this is the detectSkuConflict path.)
 */
async function findLiveSkuOwner(
  tx: PrismaClient,
  tenantId: string,
  sku: string,
  excludeId: string
): Promise<{ id: string; name: string } | null> {
  return tx.product.findFirst({
    where: { tenantId, sku, deletedAt: null, id: { not: excludeId } },
    select: { id: true, name: true },
  });
}

/**
 * Fuzzy-search the tenant's SOFT-DELETED products by name+sku similarity (Q1/Q2),
 * surfacing likely re-creations at product-create time. Two bounded round-trips:
 *
 *   1. raw $queryRaw (pg_trgm): GREATEST(similarity(name), similarity(sku)) score
 *      over `deleted_at IS NOT NULL` rows above the 0.4 threshold, top 10 by score,
 *      with a LEFT JOIN onto the LIVE product (if any) sharing the candidate's sku
 *      → per-row conflict flag in the SAME trip. raw is mandatory: similarity()/
 *      GREATEST/threshold have no Prisma client API. Values are parameterized via
 *      the tagged template (no injection).
 *   2. one Prisma findMany batching ALL candidate ids (`productId IN (...)`) →
 *      their live orphan mappings (with supplier), grouped in JS for count + top-3
 *      sample. Batched, so it is 2 trips total — NOT N+1.
 *
 * `searchTerm` under 3 chars (after trim) returns [] defensively (the action layer
 * zod also enforces this). No matches → [].
 *
 * NOTE: `similarity() > 0.4` is not GIN-accelerated (the trgm index backs the `%`
 * operator); at MVP scale (<10K soft-deleted/tenant, Q1) the partial-index scan is
 * acceptable. Switching to `name % term` + a 0.4 similarity_threshold GUC is a
 * future perf tweak, not a correctness change.
 */
export async function fuzzySearchSoftDeletedProductsLogic(
  tenantId: string,
  searchTerm: string
): Promise<FuzzyMatchCandidate[]> {
  const term = searchTerm.trim();
  if (term.length < 3) return [];

  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<FuzzyRow[]>`
      SELECT c.id, c.name, c.sku,
        GREATEST(similarity(c.name, ${term}), similarity(c.sku, ${term})) AS score,
        CASE WHEN similarity(c.name, ${term}) >= similarity(c.sku, ${term})
          THEN 'name' ELSE 'sku' END AS matched_on,
        live.id   AS conflict_live_id,
        live.name AS conflict_live_name
      FROM product c
      LEFT JOIN product live
        ON live.tenant_id = c.tenant_id
       AND live.sku = c.sku
       AND live.deleted_at IS NULL
       AND live.id <> c.id
      WHERE c.tenant_id = ${tenantId}::uuid
        AND c.deleted_at IS NOT NULL
        AND (similarity(c.name, ${term}) > ${FUZZY_SIMILARITY_THRESHOLD}
             OR similarity(c.sku, ${term}) > ${FUZZY_SIMILARITY_THRESHOLD})
      ORDER BY score DESC
      LIMIT ${FUZZY_RESULT_LIMIT}
    `;
    if (rows.length === 0) return [];

    const candidateIds = rows.map((r) => r.id);
    // Q6 orphan = mapping kept LIVE under the (now soft-deleted) product. Supplier
    // soft-delete is NOT filtered out (F2) — the preview/count reflect every live
    // price row that would come back with the restore.
    const orphans = await tx.supplierProductMapping.findMany({
      where: { productId: { in: candidateIds }, deletedAt: null },
      include: { supplier: true },
      orderBy: [{ isPreferred: "desc" }, { effectiveFrom: "desc" }],
    });
    const byProduct = new Map<string, OrphanMappingWithSupplier[]>();
    for (const m of orphans) {
      const arr = byProduct.get(m.productId) ?? [];
      arr.push(m);
      byProduct.set(m.productId, arr);
    }

    return rows.map((r) => {
      const mine = byProduct.get(r.id) ?? [];
      return {
        id: r.id,
        name: r.name,
        sku: r.sku,
        score: Number(r.score),
        matchedOn: r.matched_on,
        hasSkuConflict: r.conflict_live_id !== null,
        conflictingLiveProductName: r.conflict_live_name,
        orphanMappingCount: mine.length,
        orphanMappingSample: mine.slice(0, 3).map(toMappingPreview),
      };
    });
  });
}

/**
 * All LIVE orphan mappings (with full relations) of a product, ordered isPreferred
 * DESC then effectiveFrom DESC (Q6/Q7). INTERNAL read for the L3b restore write +
 * L4 action: it needs the full mapping data (effectiveFrom for the same-day branch,
 * price/min/lead to compare) before processing the per-row updates. Returns the raw
 * Prisma `MappingWithRefs` (Decimal KEPT) — the caller/L5 view layer serializes.
 */
export async function getOrphanMappingsForProductLogic(
  tenantId: string,
  productId: string
): Promise<MappingWithRefs[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.supplierProductMapping.findMany({
      where: { tenantId, productId, deletedAt: null },
      include: { supplier: true, product: true, branch: true, orderUnit: true },
      orderBy: [{ isPreferred: "desc" }, { effectiveFrom: "desc" }],
    })
  );
}

/**
 * Action-layer pre-check: does a user-typed `newSku` collide with a LIVE product
 * other than the candidate being restored (Q5)? Lets the action return a
 * field-level error before attempting the restore TX (the partial unique index +
 * P2002 → ProductSkuConflictError in L3b is the backstop). `candidateId` is
 * excluded so a candidate keeping its own sku is never a self-conflict.
 */
export async function detectSkuConflictLogic(
  tenantId: string,
  candidateId: string,
  newSku: string
): Promise<SkuConflictInfo> {
  return withTenantContext(tenantId, async (tx) => {
    const owner = await findLiveSkuOwner(tx, tenantId, newSku, candidateId);
    return {
      hasConflict: owner !== null,
      conflictingProductName: owner?.name ?? null,
    };
  });
}

// ============================================================
// L3b — WRITE logic: restoreProductLogic
// ============================================================

/**
 * Thrown when a restore targets an id that is NOT an actually-soft-deleted product
 * of `tenantId` — i.e. missing, cross-tenant, or already LIVE. The last case makes
 * a double-submit an honest error (not a silent no-op): the idempotency guard
 * (`deletedAt IS NOT NULL`) is consistent, simpler, and sidesteps re-running the
 * mapping-supersede branch on an already-restored product. product.ts has no such
 * error — its reads return null — so it is defined here.
 */
export class ProductNotFoundError extends Error {
  constructor(public readonly productId: string) {
    super(`Product not found or not soft-deleted: ${productId}`);
    this.name = "ProductNotFoundError";
  }
}

// --- date helpers (day-precision; @db.Date values are UTC midnight, like mapping.ts) ---
// Redefined locally rather than imported: mapping.ts keeps DAY_MS/minusOneDay
// module-private, and the Part 8.5 isolation pattern keeps that file untouched.
const DAY_MS = 86_400_000;
const minusOneDay = (d: Date): Date => new Date(d.getTime() - DAY_MS);

/**
 * "Today" in Bangkok (UTC+7, no DST — Decision #60 per-tenant tz is future) as a
 * UTC-midnight Date, so it compares/writes identically to a `@db.Date` value.
 * Computed in JS (not SQL) so the SAME instant backs both the same-day compare and
 * every write in a restore — no drift mid-transaction. Exported for L4/L5 + tests.
 */
export function computeBangkokToday(): Date {
  const bkk = new Date(Date.now() + 7 * 3600 * 1000);
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()));
}

/** A stored `@db.Date` (UTC midnight) falls on Bangkok-today iff its ms equal it. */
const isSameDayBangkok = (stored: Date, todayBangkok: Date): boolean =>
  stored.getTime() === todayBangkok.getTime();

/**
 * Map a Prisma P2002 from the product undelete to a typed sku conflict. Only the
 * `(tenant_id, sku) WHERE deleted_at IS NULL` partial-unique index can fire on a
 * product.update that flips deletedAt → null (no unit_name write here), so — unlike
 * product.ts's rethrowOnUniqueConflict — no meta.target narrowing is needed.
 */
function rethrowSkuConflict(e: unknown, sku: string | null): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new ProductSkuConflictError(sku);
  }
  throw e;
}

/** Restore options: an optional replacement sku (Q5) + the per-orphan price review (Q7). */
type RestoreOptions = {
  newSku?: string;
  mappingUpdates?: MappingUpdate[];
};

/**
 * Restore a soft-deleted product (ADR 0010), optionally re-skuing it and applying
 * the per-orphan-mapping price review — all in ONE transaction (withTenantContext
 * = one $transaction), so any throw rolls the whole restore back. Input is assumed
 * zod-validated (restoreProductInputSchema, L2). Steps:
 *
 *   1. pre-flight: the row must be an actually-soft-deleted product of THIS tenant
 *      (`deletedAt IS NOT NULL`) — else ProductNotFoundError (missing / cross-tenant
 *      / already live = double-submit; Decision A).
 *   2. if newSku: reject when a DIFFERENT live product already owns it (precise
 *      field error before the write; ProductSkuConflictError).
 *   3. undelete (+ newSku). A P2002 here covers the ORIGINAL-sku collision — no
 *      newSku given but a live product now holds the candidate's sku — plus races;
 *      rethrown as ProductSkuConflictError. Firing here (before any mapping write)
 *      rolls the tx back clean.
 *   4. for each "update" decision: only OPEN orphan rows (`effectiveTo IS NULL`)
 *      are updatable — a closed historical row id falls out of the fetch set →
 *      MappingNotFoundError (superseding a closed row would corrupt its real history;
 *      defense-in-depth, L5 sends only open rows). Same-day (Bangkok) target →
 *      overwrite in place (Option ε, zero-duration row has no audit value); else
 *      Sprint 1 supersede (ADR 0009): close the open predecessor at today − 1 day +
 *      insert a new open row carrying the SAME identity with today's price. "keep"
 *      decisions are no-ops (the orphan is already live).
 *   5. return the restored product with the standard full include (replicated INLINE
 *      on `tx` — NOT getProductByIdLogic, which would open a nested $transaction and
 *      break atomicity).
 *
 * NOTE: every read+write runs on the passed `tx`. No nested withTenantContext call.
 */
export async function restoreProductLogic(
  tenantId: string,
  productId: string,
  options: RestoreOptions = {}
): Promise<ProductWithUnits> {
  const { newSku, mappingUpdates = [] } = options;

  return withTenantContext(tenantId, async (tx) => {
    const todayBangkok = computeBangkokToday();

    // Step 1 — pre-flight: only an actually soft-deleted row of this tenant restores.
    const existing = await tx.product.findFirst({
      where: { id: productId, tenantId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (!existing) throw new ProductNotFoundError(productId);

    // Step 2 — newSku conflict pre-check (live owner ≠ self) for a precise field error.
    if (newSku !== undefined) {
      const owner = await findLiveSkuOwner(tx, tenantId, newSku, productId);
      if (owner) throw new ProductSkuConflictError(newSku);
    }

    // Step 3 — undelete (+ optional newSku). P2002 backstop = original-sku collision + race.
    try {
      await tx.product.update({
        where: { id: productId },
        data: { deletedAt: null, ...(newSku !== undefined ? { sku: newSku } : {}) },
      });
    } catch (e) {
      rethrowSkuConflict(e, newSku ?? null);
    }

    // Step 4 — apply the per-orphan price review. Fetch only OPEN targets (#4 guard).
    const updates = mappingUpdates.filter((m) => m.action === "update");
    if (updates.length > 0) {
      const ids = updates.map((m) => m.mappingId);
      const targets = await tx.supplierProductMapping.findMany({
        where: { id: { in: ids }, tenantId, productId, deletedAt: null, effectiveTo: null },
      });
      const byId = new Map(targets.map((t) => [t.id, t]));

      for (const u of updates) {
        const row = byId.get(u.mappingId);
        if (!row) throw new MappingNotFoundError(u.mappingId);
        // `updates` is guaranteed present when action === "update" (zod superRefine, L2).
        const { currentUnitPrice, minOrderQty, leadTimeDays } = u.updates!;

        if (isSameDayBangkok(row.effectiveFrom, todayBangkok)) {
          // Option ε: a same-day (zero-duration) row was never used → overwrite in place.
          await tx.supplierProductMapping.update({
            where: { id: row.id },
            data: { currentUnitPrice, minOrderQty, leadTimeDays },
          });
        } else {
          // Sprint 1 supersede (ADR 0009): close the open predecessor at today − 1 day,
          // then insert a new open row carrying the SAME identity (Q3) at today's price.
          await tx.supplierProductMapping.update({
            where: { id: row.id },
            data: { effectiveTo: minusOneDay(todayBangkok) },
          });
          await tx.supplierProductMapping.create({
            data: {
              tenantId: row.tenantId,
              supplierId: row.supplierId,
              productId: row.productId,
              branchId: row.branchId,
              supplierItemCode: row.supplierItemCode,
              supplierItemName: row.supplierItemName,
              orderUnitId: row.orderUnitId,
              isPreferred: row.isPreferred,
              currentUnitPrice,
              minOrderQty,
              leadTimeDays,
              effectiveFrom: todayBangkok,
              effectiveTo: null,
            },
          });
        }
      }
    }
    // "keep" decisions are no-ops (the orphan mapping is already live).

    // Step 5 — return the restored product, full relations, inline on tx (no nesting).
    return tx.product.findFirstOrThrow({
      where: { id: productId, tenantId },
      include: {
        productUnits: true,
        category: true,
        parentProduct: { select: { name: true, sku: true } },
        liquidDensityTemplate: {
          select: {
            id: true,
            name: true,
            gPerMl: true,
            description: true,
            displayOrder: true,
          },
        },
      },
    });
  });
}
