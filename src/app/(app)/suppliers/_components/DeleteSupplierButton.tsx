"use client";

import { orStale } from "@/lib/stale-tab";

// Sprint 1 Part 5, Step 7.4 — soft-delete control for the edit page (Q6).
// ConfirmDialog → deleteSupplier action → back to the list on success.
//
// Part 8 L5b (Q6 cascade): mirror of DeleteProductButton. When the supplier has
// linked price mappings, a blast-radius dialog lists them (default all checked,
// primaryLabel = product name) and the chosen ids go to
// deleteSupplier(id, mappingIds[]) for an in-tx cascade soft-delete. No mappings
// → the plain ConfirmDialog asks instead (the browser's confirm() until 2026-10-29). Only MappingNotFoundError applies
// on the supplier side (no ProductUnit guard), surfaced as a Thai error string.

import { useState, useTransition } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useRouter } from "next/navigation";
import { deleteSupplier } from "@/app/(app)/suppliers/actions";
import CascadeDeleteDialog, {
  type CascadeMappingItem,
} from "@/components/ui/CascadeDeleteDialog";

const CASCADE_WARNING =
  "การลบจะซ่อนรายการราคาเหล่านี้จากหน้าสั่งซื้อ/สต๊อก — ประวัติราคายังอยู่ครบ และไม่กระทบยอด/มูลค่าสต๊อกที่บันทึกไว้";

export default function DeleteSupplierButton({
  id,
  cascadeItems,
}: {
  id: string;
  cascadeItems: CascadeMappingItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  /** Run the delete with the chosen cascade ids; on success leave to the list. */
  function runDelete(mappingIds: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await orStale(deleteSupplier(id, mappingIds));
      if (res.ok) {
        router.push("/suppliers");
        router.refresh();
      } else {
        setError(res.error ?? "ลบไม่สำเร็จ");
      }
    });
  }

  function handleDelete() {
    // No linked mappings → keep the original simple ConfirmDialog path.
    if (cascadeItems.length === 0) {
      setAskOpen(true);
      return;
    }
    setDialogOpen(true);
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="btn-danger"
      >
        {isPending ? "กำลังลบ..." : "ลบ"}
      </button>
      {/* Inline error only for the no-cascade path. */}
      {!dialogOpen && error && (
        <p className="mt-2 text-sm text-bad">{error}</p>
      )}

      <ConfirmDialog
        open={askOpen}
        title="ลบผู้ขายนี้?"
        confirmLabel="ลบ"
        danger
        pending={isPending}
        onConfirm={() => {
          setAskOpen(false);
          runDelete([]);
        }}
        onCancel={() => setAskOpen(false)}
      >
        ผู้ขายนี้จะไม่ขึ้นในตัวเลือกตอนสั่งซื้อและรับของอีก · เอกสารที่บันทึกไปแล้วยังอยู่ครบ
      </ConfirmDialog>
      <CascadeDeleteDialog
        open={dialogOpen}
        title="ลบผู้ขาย — มีรายการราคาที่เชื่อมอยู่"
        warning={CASCADE_WARNING}
        items={cascadeItems}
        confirmLabel="ลบผู้ขายและรายการที่เลือก"
        isPending={isPending}
        error={error ?? undefined}
        onConfirm={runDelete}
        onCancel={() => {
          setDialogOpen(false);
          setError(null);
        }}
      />
    </div>
  );
}
