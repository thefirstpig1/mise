"use client";

// Sprint 1 Part 5, Step 7.4 — soft-delete control for the edit page (Q6).
// confirm() → deleteSupplier action → back to the list on success.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSupplier } from "@/app/suppliers/actions";

export default function DeleteSupplierButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!confirm("ต้องการลบซัพพลายเออร์นี้?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSupplier(id);
      if (res.ok) {
        router.push("/suppliers");
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
