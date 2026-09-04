"use client";

// ============================================================
// Mise — Restore-on-recreate dialog (Sprint 1 Part 8.5 L5b; ADR 0010)
// ============================================================
// The dialog opened when the user clicks a candidate in the L5a typeahead: it
// confirms the restore of a SOFT-DELETED product and composes 0–2 conditional
// sections over it (the candidate decides which appear):
//   Section 1 (Q5) — a `new_sku` input, ONLY when the candidate's original sku is
//     already held by a LIVE product (hasSkuConflict); pre-filled "<sku>-restored".
//   Section 2 (Q6/Q7) — a per-orphan price-review, ONLY when orphanMappingCount > 0.
//     The FULL orphan list (not the typeahead's top-3 preview) is fetched on open
//     via getOrphanMappingsForProductAction (Option A); each row is keep (default,
//     C-sub-2) or update (reveals price/minQty/leadTime, pre-filled from the row).
//   Neither → a plain restore confirmation.
//
// Hybrid pattern (Sprint 1 precedents): the modal SHELL is CascadeDeleteDialog's
// (`if (!candidate) return null` + fixed-inset overlay + card), but the body is a
// <form action={formAction}> on useActionState(restoreProductAction) — ProductForm's
// pattern — because restore has FORM FIELDS and returns dotted-path fieldErrors.
//
// FormData is the fanout contract the L4 action zips by index (mappingUpdatesFrom
// FormData): five parallel arrays — mapping_id / mapping_action / mapping_price /
// mapping_min_qty / mapping_lead_time. EVERY orphan row contributes one entry to
// ALL FIVE (a "keep" row emits the three update fields as empty hidden inputs) so
// the indices never desync — the additionalUnits fanout precedent.
//
// No unit tests at L5b (components are covered by E2E at L6, Sprint 1 convention).
// L5a/L5c wire this in for the CREATE flow; here it is standalone (candidate prop).
// ============================================================

import { useActionState, useEffect, useState } from "react";
import {
  restoreProductAction,
  getOrphanMappingsForProductAction,
  type RestoreActionState,
  type OrphanMappingRow,
} from "@/app/products/restore-actions";
import type { FuzzyMatchCandidate } from "@/server/product-restore";

/** One orphan row's review decision (default keep, C-sub-2). */
type MappingChoice = "keep" | "update";

const INITIAL_STATE: RestoreActionState = { ok: false };

const FIELD_INPUT_CLASS =
  "input w-full";

export default function RestoreDialog({
  candidate,
  onClose,
  onRestored,
}: {
  candidate: FuzzyMatchCandidate | null; // null = closed (modal-shell pattern)
  onClose: () => void;
  onRestored?: (productId: string) => void; // L5c owns navigation; dialog stays decoupled
}) {
  const [state, formAction, isPending] = useActionState(
    restoreProductAction,
    INITIAL_STATE
  );

  // Full orphan list (Q6/Q7), Option A. null = not loaded yet; [] = loaded, none.
  const [orphanRows, setOrphanRows] = useState<OrphanMappingRow[] | null>(null);
  const [loadingOrphans, setLoadingOrphans] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-row keep/update, index-aligned with orphanRows (re-seeded on each load).
  const [choices, setChoices] = useState<MappingChoice[]>([]);

  const candidateId = candidate?.id ?? null;
  const orphanCount = candidate?.orphanMappingCount ?? 0;

  // Fetch the FULL orphan list when a candidate WITH orphans opens. The ignore-flag
  // stale guard (mirror L5a) drops a response if the candidate changed meanwhile.
  // orphanCount === 0 → skip the round-trip entirely (decision #8): ready at once.
  useEffect(() => {
    if (!candidateId) return;
    if (orphanCount === 0) {
      setOrphanRows([]);
      setChoices([]);
      setLoadingOrphans(false);
      setLoadError(null);
      return;
    }
    let ignore = false;
    setOrphanRows(null);
    setLoadingOrphans(true);
    setLoadError(null);
    getOrphanMappingsForProductAction(candidateId)
      .then((rows) => {
        if (ignore) return;
        setOrphanRows(rows);
        setChoices(rows.map(() => "keep")); // default keep (C-sub-2)
      })
      .catch(() => {
        if (!ignore) setLoadError("โหลดรายการราคาไม่สำเร็จ — รบกวนปิดแล้วลองใหม่");
      })
      .finally(() => {
        if (!ignore) setLoadingOrphans(false);
      });
    return () => {
      ignore = true;
    };
  }, [candidateId, orphanCount]);

  // Success (decision #9): fire ONCE when the action reports ok, then close. Deps are
  // [state.ok] per the locked decision (fire on the success transition, not on every
  // state identity change); onRestored/onClose are intentionally omitted.
  useEffect(() => {
    if (state.ok) {
      onRestored?.(state.productId);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  if (!candidate) return null;

  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const formError = state.ok === false ? state.formError : undefined;
  const err = (key: string) => fieldErrors?.[key];

  function setChoice(i: number, choice: MappingChoice) {
    setChoices((prev) => {
      const next = [...prev];
      next[i] = choice;
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-surface p-6 shadow-lg">
        <h3 className="text-base font-semibold">
          กู้คืนสินค้า — “{candidate.name}” ({candidate.sku})
        </h3>

        {formError && (
          <p className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
            {formError}
          </p>
        )}

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="product_id" value={candidate.id} />

          {/* Section 1 — newSku, ONLY on a live-sku conflict (Q5). */}
          {candidate.hasSkuConflict && (
            <div className="space-y-1 rounded-lg border border-warn-border bg-warn-bg p-3">
              <p className="text-sm text-warn">
                ⚠️ รหัส {candidate.sku} ถูกใช้แล้วโดย “
                {candidate.conflictingLiveProductName}” — กรุณาตั้งรหัสใหม่
              </p>
              <label htmlFor="new_sku" className="label">
                รหัสสินค้าใหม่
              </label>
              <input
                id="new_sku"
                name="new_sku"
                type="text"
                defaultValue={`${candidate.sku}-restored`}
                className={FIELD_INPUT_CLASS}
              />
              {err("newSku") && (
                <p className="text-sm text-bad">{err("newSku")}</p>
              )}
            </div>
          )}

          {/* Section 2 — orphan price-review, ONLY when the candidate has orphans (Q6/Q7). */}
          {orphanCount > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                ตรวจสอบราคาที่จะกลับมา ({orphanCount} รายการ)
              </legend>

              {loadingOrphans && (
                <p className="text-sm text-muted-foreground">
                  กำลังโหลดรายการราคา...
                </p>
              )}
              {loadError && (
                <p className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
                  {loadError}
                </p>
              )}

              {orphanRows?.map((row, i) => {
                const choice = choices[i] ?? "keep";
                return (
                  <div
                    key={row.id}
                    className="space-y-2 rounded-lg border border-border p-3"
                  >
                    {/* Fanout: every row emits id + action so the 5 arrays stay aligned. */}
                    <input type="hidden" name="mapping_id" value={row.id} />
                    <input type="hidden" name="mapping_action" value={choice} />

                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        <span className="font-medium">{row.supplierName}</span>
                        {row.isPreferred && (
                          <span className="ml-1 rounded-full border border-good-border bg-good-bg px-1.5 py-0.5 text-xs text-good">
                            หลัก
                          </span>
                        )}
                        <span className="ml-1 text-xs text-muted-foreground">
                          · ราคาตั้งแต่ {row.effectiveFrom}
                        </span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {row.currentUnitPrice ? `฿${row.currentUnitPrice}` : "—"}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-sm">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={`mapping_choice_${i}`}
                          checked={choice === "keep"}
                          onChange={() => setChoice(i, "keep")}
                          className="h-4 w-4"
                        />
                        คงราคาเดิม
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={`mapping_choice_${i}`}
                          checked={choice === "update"}
                          onChange={() => setChoice(i, "update")}
                          className="h-4 w-4"
                        />
                        อัปเดตราคา
                      </label>
                    </div>

                    {choice === "update" ? (
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-xs text-muted-foreground">
                          ราคา/หน่วย
                          <input
                            name="mapping_price"
                            type="number"
                            step="any"
                            min="0"
                            defaultValue={row.currentUnitPrice ?? ""}
                            className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          ขั้นต่ำ
                          <input
                            name="mapping_min_qty"
                            type="number"
                            step="any"
                            min="0"
                            defaultValue={row.minOrderQty ?? ""}
                            className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Lead time (วัน)
                          <input
                            name="mapping_lead_time"
                            type="number"
                            step="1"
                            min="0"
                            defaultValue={row.leadTimeDays ?? ""}
                            className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                      </div>
                    ) : (
                      // "keep" row: empty hidden fields keep the 5 fanout arrays aligned.
                      <>
                        <input type="hidden" name="mapping_price" value="" />
                        <input type="hidden" name="mapping_min_qty" value="" />
                        <input type="hidden" name="mapping_lead_time" value="" />
                      </>
                    )}

                    {/* Per-field errors (dotted, decision #7) + a row-level fallback. */}
                    {err(`mappingUpdates.${i}.updates.currentUnitPrice`) && (
                      <p className="text-sm text-bad">
                        {err(`mappingUpdates.${i}.updates.currentUnitPrice`)}
                      </p>
                    )}
                    {err(`mappingUpdates.${i}.updates.minOrderQty`) && (
                      <p className="text-sm text-bad">
                        {err(`mappingUpdates.${i}.updates.minOrderQty`)}
                      </p>
                    )}
                    {err(`mappingUpdates.${i}.updates.leadTimeDays`) && (
                      <p className="text-sm text-bad">
                        {err(`mappingUpdates.${i}.updates.leadTimeDays`)}
                      </p>
                    )}
                    {err(`mappingUpdates.${i}.updates`) && (
                      <p className="text-sm text-bad">
                        {err(`mappingUpdates.${i}.updates`)}
                      </p>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isPending || loadingOrphans}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "กำลังกู้คืน..." : "กู้คืน"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
