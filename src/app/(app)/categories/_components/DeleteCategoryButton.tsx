"use client";

import { orStale } from "@/lib/stale-tab";

// Sprint 1 Part 6, Step 6.4 — soft-delete control, now at the foot of the
// edit popup (queue item 9), worded like "นำออกจากร้าน" in the people popup.
// Mirrors src/app/suppliers/_components/DeleteSupplierButton.tsx.

import { useState, useTransition } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { deleteCategory } from "@/app/(app)/categories/actions";

export default function DeleteCategoryButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  function handleDelete() {
    setAskOpen(false);
    setError(null);
    startTransition(async () => {
      const res = await orStale(deleteCategory(id));
      if (res.ok) onDone();
      else {
        setError(res.error ?? "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setAskOpen(true)}
        disabled={isPending}
        className="py-2 text-sm font-semibold text-bad hover:underline"
      >
        {isPending ? "กำลังลบ…" : "ลบหมวดนี้"}
      </button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <ConfirmDialog open={askOpen} title="ลบหมวดบัญชีนี้?" confirmLabel="ลบ" danger pending={isPending} onConfirm={handleDelete} onCancel={() => setAskOpen(false)}>
        หมวดนี้จะไม่ขึ้นในตัวเลือกอีก · รายการที่บันทึกไว้ในหมวดนี้แล้วยังอยู่ครบ · ลบผิด กด “เพิ่มหมวดบัญชี” ใส่ชื่อเดิม ระบบจะกู้หมวดนี้กลับมาพร้อมรายการเดิม
      </ConfirmDialog>
    </div>
  );
}
