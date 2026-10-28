"use client";

// Sprint 1 Part 8 L5a-2 — soft-delete control for the mapping edit page.
// Unlike DeleteProductButton (7c direct-invoke), the L4 deleteMappingAction is
// useActionState-style `(id, prev, fd)` so it can surface a Thai formError
// (MappingNotFoundError → "ไม่พบรายการราคา"). We bind the id, wrap in
// useActionState, and gate submission behind ConfirmDialog (the app's own, 2026-10-29). On
// success we leave the (now-deleted) mapping's edit page back to the product
// and refresh so the revalidated price list re-renders.

import { useActionState, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useRouter } from "next/navigation";
import {
  deleteMappingAction,
  type MappingActionState,
} from "@/app/(app)/supplier-product-mappings/actions";

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
  const formRef = useRef<HTMLFormElement>(null);
  const [askOpen, setAskOpen] = useState(false);

  return (
    <form ref={formRef} action={formAction} className="text-right">
      <button
        type="button"
        onClick={() => setAskOpen(true)}
        disabled={isPending}
        className="btn-danger"
      >
        {isPending ? "กำลังลบ..." : "ลบรายการราคา"}
      </button>
      {formError && <p className="mt-2 text-sm text-bad">{formError}</p>}
      <ConfirmDialog
        open={askOpen}
        title="ลบรายการราคานี้?"
        confirmLabel="ลบรายการราคา"
        danger
        pending={isPending}
        onConfirm={() => {
          setAskOpen(false);
          formRef.current?.requestSubmit();
        }}
        onCancel={() => setAskOpen(false)}
      >
        ราคานี้จะไม่ถูกใช้เติมในใบสั่งซื้ออีก · ประวัติราคายังอยู่
      </ConfirmDialog>
    </form>
  );
}
