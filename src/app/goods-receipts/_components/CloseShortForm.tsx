"use client";

// Sprint 2 Part 13 L5c — "ปิดรับ" on the purchase-order page (ADR 0013 Q8).
//
// Lives in the goods-receipts folder rather than purchase-orders because it is
// part of the receiving story: the button only ever appears once a delivery has
// arrived and stopped, and it calls the receiving action.
//
// The reason is required, so this is a form rather than a confirm dialog: the
// status is about to say RECEIVED while the quantities say otherwise, and this
// sentence is the only thing that reconciles them.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GoodsReceiptActionState } from "../actions";

export default function CloseShortForm({
  purchaseOrderId,
  onClose,
}: {
  purchaseOrderId: string;
  onClose: (
    prev: GoodsReceiptActionState,
    fd: FormData
  ) => Promise<GoodsReceiptActionState>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await onClose({ ok: false }, formData);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(
          res.formError ?? res.fieldErrors?.closedShortReason ?? "ปิดรับไม่สำเร็จ"
        );
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
      >
        ปิดรับ (ไม่รอของส่วนที่ขาด)
      </button>
    );
  }

  return (
    <form action={submit} className="rounded-lg border border-border bg-muted/30 p-4">
      <input type="hidden" name="id" value={purchaseOrderId} />
      <label htmlFor="closed_short_reason" className="block text-sm font-medium">
        เหตุผลที่ปิดรับทั้งที่ยังได้ไม่ครบ (จำเป็น)
      </label>
      <input
        id="closed_short_reason"
        name="closed_short_reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="เช่น ซัพแจ้งของหมด ไม่ส่งส่วนที่เหลือแล้ว"
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        ใบสั่งซื้อจะเปลี่ยนเป็น &quot;รับของครบแล้ว&quot; ส่วนตัวเลขที่รับจริงจะยังเป็นตามเดิม
        และจะไม่ค้างอยู่ในรายการของที่กำลังมาอีก
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          ยืนยันปิดรับ
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm"
        >
          ไม่ปิดแล้ว
        </button>
      </div>
    </form>
  );
}
