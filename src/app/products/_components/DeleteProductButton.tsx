"use client";

// Sprint 1 Part 7a — soft-delete control for the edit page.
// Mirrors src/app/categories/_components/DeleteCategoryButton.tsx.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProduct } from "@/app/products/actions";

export default function DeleteProductButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!confirm("ต้องการลบสินค้านี้?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteProduct(id);
      if (res.ok) {
        router.push("/products");
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
        className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? "กำลังลบ..." : "ลบ"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
