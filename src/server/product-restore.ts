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
// WRITE logic (restoreProductLogic + supersede/overwrite branch) is L3b — same
// file, added next.
// ============================================================

import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { MappingWithRefs } from "@/server/supplier-product-mapping";

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
