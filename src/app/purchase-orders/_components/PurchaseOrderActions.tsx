"use client";

// Sprint 2 Part 11 L5c — the lifecycle buttons on the detail view.
//
// Three irreversible things live here, so each asks first — and the confirm text
// says what actually happens, not "are you sure":
//
//   send    — the document leaves the building and locks (Q4)
//   cancel  — a real order is withdrawn; the row stays forever (Q9)
//   discard — a draft nobody saw is thrown away (Q9)
//
// `window.confirm` is used deliberately: a dialog component would be nicer, but
// the project has one (CascadeDeleteDialog) built for a different shape entirely,
// and inventing a second modal for three buttons is more surface than the choice
// deserves. NOTE: this is a native confirm, not a JS alert triggered by
// automation — the E2E drives the actions directly, never this component.
//
// Printing is here too, because window.print() needs a client component; the
// print stylesheet lives on the page itself.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseOrderActionState } from "../actions";

export default function PurchaseOrderActions({
  id,
  poNumber,
  status,
  onSend,
  onCancel,
  onDiscard,
}: {
  id: string;
  poNumber: string;
  status: string;
  onSend: (id: string) => Promise<PurchaseOrderActionState>;
  onCancel: (
    prev: PurchaseOrderActionState,
    fd: FormData
  ) => Promise<PurchaseOrderActionState>;
  onDiscard: (id: string) => Promise<PurchaseOrderActionState>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const isDraft = status === "DRAFT";
  const canCancel = status === "DRAFT" || status === "SENT";

  const run = (fn: () => Promise<PurchaseOrderActionState>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        after?.();
        router.refresh();
      } else {
        setError(res.formError ?? "ทำรายการไม่สำเร็จ");
      }
    });
  };

  const send = () => {
    if (
      !window.confirm(
        `ส่งใบสั่งซื้อ ${poNumber} ให้ผู้ขาย?\n\nหลังจากนี้จะแก้ไขใบนี้ไม่ได้อีก — ถ้าต้องเปลี่ยนต้องยกเลิกแล้วออกใบใหม่`
      )
    ) {
      return;
    }
    run(() => onSend(id));
  };

  const discard = () => {
    if (!window.confirm(`ทิ้งร่าง ${poNumber}?`)) return;
    run(() => onDiscard(id), () => router.push("/purchase-orders"));
  };

  const submitCancel = (formData: FormData) => {
    run(
      () => onCancel({ ok: false }, formData),
      () => setCancelling(false)
    );
  };

  return (
    <div className="space-y-3 print:hidden">
      {error && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isDraft && (
          <>
            <button
              type="button"
              onClick={send}
              disabled={pending}
              className="btn"
            >
              ส่งให้ผู้ขาย
            </button>
            <a
              href={`/purchase-orders/${id}/edit`}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
            >
              แก้ไข
            </a>
          </>
        )}

        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
        >
          พิมพ์ / บันทึกภาพ
        </button>

        {canCancel && !cancelling && (
          <button
            type="button"
            onClick={() => setCancelling(true)}
            disabled={pending}
            className="rounded-lg border border-bad-border px-4 py-2 text-sm text-bad hover:bg-bad-bg disabled:opacity-50"
          >
            ยกเลิกใบสั่งซื้อ
          </button>
        )}

        {isDraft && (
          <button
            type="button"
            onClick={discard}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:text-bad disabled:opacity-50"
          >
            ทิ้งร่าง
          </button>
        )}
      </div>

      {cancelling && (
        <form action={submitCancel} className="rounded-lg border border-bad-border bg-bad-bg p-4">
          <input type="hidden" name="id" value={id} />
          <label htmlFor="cancel_reason" className="label text-bad">
            เหตุผลที่ยกเลิก
          </label>
          <input
            id="cancel_reason"
            name="cancel_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ผู้ขายของหมด / สั่งผิดร้าน"
            className="mt-1 w-full rounded-lg border border-bad-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-bad">
            ใบที่ยกเลิกจะยังอยู่ในระบบตลอดไป เพื่อให้ตรวจย้อนหลังได้
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-bad px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              ยืนยันยกเลิก
            </button>
            <button
              type="button"
              onClick={() => setCancelling(false)}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm"
            >
              ไม่ยกเลิกแล้ว
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
