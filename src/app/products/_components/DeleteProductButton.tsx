"use client";

// Sprint 1 Part 7a — soft-delete control for the edit page.
// Mirrors src/app/categories/_components/DeleteCategoryButton.tsx.
//
// Part 8 L5b (Q6 cascade): when the product has linked supplier price mappings,
// the plain confirm() is replaced by a blast-radius dialog (CascadeDeleteDialog)
// that lists those mappings with per-row checkboxes (default all checked). The
// chosen ids are forwarded to deleteProduct(id, mappingIds[]) which soft-deletes
// them alongside the product in one tx. With no mappings the original confirm()
// path is kept unchanged. A ProductHasChildrenError / MappingNotFoundError comes
// back as a Thai `error` string and is surfaced where the user is (in the dialog
// when it's open, else inline under the button).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProduct } from "@/app/products/actions";
import CascadeDeleteDialog, {
  type CascadeMappingItem,
} from "@/components/ui/CascadeDeleteDialog";

const CASCADE_WARNING =
  "การลบจะซ่อนรายการราคาเหล่านี้จากหน้าสั่งซื้อ/สต๊อก — ประวัติราคายังอยู่ครบ และไม่กระทบยอด/มูลค่าสต๊อกที่บันทึกไว้";

export default function DeleteProductButton({
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
      const res = await deleteProduct(id, mappingIds);
      if (res.ok) {
        router.push("/products");
        router.refresh();
      } else {
        setError(res.error ?? "ลบไม่สำเร็จ");
      }
    });
  }

  function handleDelete() {
    // No linked mappings → keep the original simple confirm() path.
    if (cascadeItems.length === 0) {
      if (!confirm("ต้องการลบสินค้านี้?")) return;
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
        className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? "กำลังลบ..." : "ลบ"}
      </button>
      {/* Inline error only for the no-dialog confirm() path. */}
      {!dialogOpen && error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}

      <CascadeDeleteDialog
        open={dialogOpen}
        title="ลบสินค้า — มีรายการราคาที่เชื่อมอยู่"
        warning={CASCADE_WARNING}
        items={cascadeItems}
        confirmLabel="ลบสินค้าและรายการที่เลือก"
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
