"use client";

// Sprint 1 Part 8 L5a-2 — soft-delete control for the mapping edit page.
// Unlike DeleteProductButton (7c direct-invoke), the L4 deleteMappingAction is
// useActionState-style `(id, prev, fd)` so it can surface a Thai formError
// (MappingNotFoundError → "ไม่พบรายการราคา"). We bind the id, wrap in
// useActionState, and gate submission behind a confirm() in onSubmit. On
// success we leave the (now-deleted) mapping's edit page back to the product
// and refresh so the revalidated price list re-renders.

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  deleteMappingAction,
  type MappingActionState,
} from "@/app/supplier-product-mappings/actions";

export default function DeleteMappingButton({
  mappingId,
  productId,
}: {
  mappingId: string;
  productId: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    deleteMappingAction.bind(null, mappingId),
    { ok: false } as MappingActionState
  );

  useEffect(() => {
    if (state.ok) {
      router.push(`/products/${productId}`);
      router.refresh();
    }
  }, [state, router, productId]);

  const formError = state.ok === false ? state.formError : undefined;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("ต้องการลบรายการราคานี้?")) e.preventDefault();
      }}
      className="text-right"
    >
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg border border-bad-border px-4 py-2 text-sm text-bad hover:bg-bad-bg disabled:opacity-50"
      >
        {isPending ? "กำลังลบ..." : "ลบรายการราคา"}
      </button>
      {formError && <p className="mt-2 text-sm text-bad">{formError}</p>}
    </form>
  );
}
