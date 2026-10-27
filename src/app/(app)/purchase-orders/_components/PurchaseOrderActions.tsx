"use client";

import { orStale } from "@/lib/stale-tab";

// Sprint 2 Part 11 L5c — the lifecycle buttons on the detail view.
// Document-page review (Kong 2026-10-27, mockup 58mU74dLaAMwH6nF3AC6zw): drawn
// in two places. `part="head"` sits in the page header — the next step (send a
// draft) and print. `part="foot"` sits at the bottom, away from them —
// cancelling a real order and discarding a draft. Each irreversible one asks in
// the app's own dialog, saying what actually happens, instead of confirm().
//
//   send    — the document leaves the building and locks (Q4)
//   cancel  — a real order is withdrawn; the row stays forever (Q9)
//   discard — a draft nobody saw is thrown away (Q9)
//
// Printing is here too, because window.print() needs a client component; the
// print stylesheet lives on the page itself.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, type ConfirmSpec } from "@/app/(app)/menus/_components/sheet-parts";
import type { PurchaseOrderActionState } from "../actions";

export default function PurchaseOrderActions({
  part,
  id,
  poNumber,
  supplierName,
  status,
  onSend,
  onCancel,
  onDiscard,
}: {
  part: "head" | "foot";
  id: string;
  poNumber: string;
  supplierName: string;
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
  const [asking, setAsking] = useState<ConfirmSpec | null>(null);

  const isDraft = status === "DRAFT";
  const canCancel = status === "DRAFT" || status === "SENT";

  const run = (fn: () => Promise<PurchaseOrderActionState>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await orStale(fn());
      if (res.ok) {
        after?.();
        router.refresh();
      } else {
        setError(res.formError ?? "ทำรายการไม่สำเร็จ");
      }
    });
  };

  const send = () =>
    setAsking({
      title: `ส่ง ${poNumber} ให้${supplierName}?`,
      lines: [
        "หลังจากนี้แก้ใบนี้ไม่ได้อีก ถ้าต้องเปลี่ยนต้องยกเลิกแล้วออกใบใหม่",
        "ใบจะขึ้นเป็น “ส่งแล้ว” และรอรับของ",
      ],
      money: null,
      who: "",
      go: "ส่งให้ผู้ขาย",
      back: "ยังไม่ส่ง",
      onGo: () => run(() => onSend(id)),
    });

  const discard = () =>
    setAsking({
      title: `ทิ้งร่าง ${poNumber}?`,
      lines: ["ร่างนี้ยังไม่เคยส่งให้ใคร จะหายไปจากรายการ"],
      money: null,
      who: "",
      go: "ทิ้งร่าง",
      back: "ไม่ทิ้ง",
      onGo: () => run(() => onDiscard(id), () => router.push("/purchase-orders")),
    });

  const submitCancel = (formData: FormData) => {
    run(
      () => onCancel({ ok: false }, formData),
      () => setCancelling(false)
    );
  };

  const dialog = asking && <ConfirmDialog spec={asking} onClose={() => setAsking(null)} />;
  const errorBox = error && (
    <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</div>
  );

  if (part === "head") {
    return (
      <>
        {isDraft && (
          <a href={`/purchase-orders/${id}/edit`} className="rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-sm font-medium hover:bg-muted/40">
            แก้ไข
          </a>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-sm font-medium hover:bg-muted/40"
        >
          พิมพ์ / บันทึกภาพ
        </button>
        {isDraft && (
          <button type="button" onClick={send} disabled={pending} className="btn">
            ส่งให้ผู้ขาย
          </button>
        )}
        {errorBox}
        {dialog}
      </>
    );
  }

  if (!canCancel && !isDraft) return null;
  return (
    <section className="space-y-3 border-t border-border pt-4 print:hidden">
      {errorBox}
      <div className="flex flex-wrap items-center gap-3">
        {canCancel && !cancelling && (
          <button
            type="button"
            onClick={() => setCancelling(true)}
            disabled={pending}
            className="rounded-xl border border-bad-border bg-surface px-4 py-2 text-sm font-medium text-bad hover:bg-bad-bg disabled:opacity-50"
          >
            ยกเลิกใบสั่งซื้อ
          </button>
        )}
        {isDraft && (
          <button
            type="button"
            onClick={discard}
            disabled={pending}
            className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-bad disabled:opacity-50"
          >
            ทิ้งร่าง
          </button>
        )}
      </div>

      {cancelling && (
        <form action={submitCancel} className="rounded-xl border border-bad-border bg-bad-bg p-4">
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
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-bad">
            <li>{supplierName}จะไม่ถูกนับว่ามีของค้างส่งตามใบนี้อีก</li>
            <li>ใบที่ยกเลิกยังอยู่ในระบบตลอดไป เพื่อให้ตรวจย้อนหลังได้</li>
          </ul>
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
      {dialog}
    </section>
  );
}
