"use client";

import { orStale } from "@/lib/stale-tab";

// Sprint 1 Part 6, Step 6.4 — soft-delete control for the edit page.
// Mirrors src/app/suppliers/_components/DeleteSupplierButton.tsx.

import { useState, useTransition } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useRouter } from "next/navigation";
import { deleteCategory } from "@/app/(app)/categories/actions";

export default function DeleteCategoryButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  function handleDelete() {
    setAskOpen(false);
    setError(null);
    startTransition(async () => {
      const res = await orStale(deleteCategory(id));
      if (res.ok) {
        router.push("/categories");
        router.refresh();
      } else {
        setError(res.error ?? "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => setAskOpen(true)}
        disabled={isPending}
        className="btn-danger"
      >
        {isPending ? "กำลังลบ..." : "ลบ"}
      </button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <ConfirmDialog open={askOpen} title="ลบหมวดบัญชีนี้?" confirmLabel="ลบ" danger pending={isPending} onConfirm={handleDelete} onCancel={() => setAskOpen(false)}>
        หมวดนี้จะไม่ขึ้นในตัวเลือกอีก · รายการที่บันทึกไว้ในหมวดนี้แล้วยังอยู่ครบ
      </ConfirmDialog>
    </div>
  );
}
