"use client";

// Sprint 1 Part 6, Step 6.4 — soft-delete control for the edit page.
// Mirrors src/app/suppliers/_components/DeleteSupplierButton.tsx.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCategory } from "@/app/categories/actions";

export default function DeleteCategoryButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!confirm("ต้องการลบหมวดบัญชีนี้?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCategory(id);
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
        onClick={handleDelete}
        disabled={isPending}
        className="rounded-lg border border-bad-border px-4 py-2 text-sm text-bad hover:bg-bad-bg disabled:opacity-50"
      >
        {isPending ? "กำลังลบ..." : "ลบ"}
      </button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
