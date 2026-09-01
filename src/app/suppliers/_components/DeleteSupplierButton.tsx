"use client";

// Sprint 1 Part 5, Step 7.4 — soft-delete control for the edit page (Q6).
// confirm() → deleteSupplier action → back to the list on success.
//
// Part 8 L5b (Q6 cascade): mirror of DeleteProductButton. When the supplier has
// linked price mappings, a blast-radius dialog lists them (default all checked,
// primaryLabel = product name) and the chosen ids go to
// deleteSupplier(id, mappingIds[]) for an in-tx cascade soft-delete. No mappings
// → the original confirm() path is unchanged. Only MappingNotFoundError applies
// on the supplier side (no ProductUnit guard), surfaced as a Thai error string.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSupplier } from "@/app/suppliers/actions";
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

  /** Run the delete with the chosen cascade ids; on success leave to the list. */
  function runDelete(mappingIds: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await deleteSupplier(id, mappingIds);
      if (res.ok) {
        router.push("/suppliers");
        router.refresh();
      } else {
        setError(res.error ?? "ลบไม่สำเร็จ");
      }
    });
  }

  function handleDelete() {
    // No linked mappings → keep the original simple confirm() path.
    if (cascadeItems.length === 0) {
      if (!confirm("ต้องการลบซัพพลายเออร์นี้?")) return;
      runDelete([]);
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
        className="rounded-lg border border-bad-border px-4 py-2 text-sm text-bad hover:bg-bad-bg disabled:opacity-50"
      >
        {isPending ? "กำลังลบ..." : "ลบ"}
      </button>
      {/* Inline error only for the no-dialog confirm() path. */}
      {!dialogOpen && error && (
        <p className="mt-2 text-sm text-bad">{error}</p>
      )}

      <CascadeDeleteDialog
        open={dialogOpen}
        title="ลบซัพพลายเออร์ — มีรายการราคาที่เชื่อมอยู่"
        warning={CASCADE_WARNING}
        items={cascadeItems}
        confirmLabel="ลบซัพพลายเออร์และรายการที่เลือก"
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
