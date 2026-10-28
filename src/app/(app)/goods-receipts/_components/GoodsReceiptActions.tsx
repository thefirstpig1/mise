"use client";

import { orStale } from "@/lib/stale-tab";

// Sprint 2 Part 13 L5c — the lifecycle buttons on the detail view.
//
// Three irreversible things live here, and each says what actually happens
// rather than "are you sure":
//
//   confirm — stock enters the ledger and the document locks (Q2)
//   void    — compensating rows are appended; nothing is erased (Q6)
//   discard — a draft that never posted is thrown away
//
// Each asks first in the app's own dialog (it was window.confirm until the
// document-page review, 2026-10-27). Drawn twice: `part="head"` in the page
// header (confirm a draft, print), `part="foot"` at the bottom (void, discard).
//
// After a confirm the post-write balances come back with the response, so the
// page can say where the stock landed without another round trip — and flag a
// negative one (ADR 0011 Q9), which a VOID genuinely can cause.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, type ConfirmSpec } from "@/app/(app)/menus/_components/sheet-parts";
import type {
  GoodsReceiptActionState,
  GoodsReceiptPostActionState,
} from "../actions";

type Balances = { productId: string; productName: string; balance: string }[];

export default function GoodsReceiptActions({
  part,
  id,
  grNumber,
  status,
  onConfirm,
  onVoid,
  onDiscard,
}: {
  /** Document-page review 2026-10-27: "head" = next step + print, "foot" = void / discard. */
  part: "head" | "foot";
  id: string;
  grNumber: string;
  status: string;
  onConfirm: (id: string) => Promise<GoodsReceiptPostActionState>;
  onVoid: (
    prev: GoodsReceiptPostActionState,
    fd: FormData
  ) => Promise<GoodsReceiptPostActionState>;
  onDiscard: (id: string) => Promise<GoodsReceiptActionState>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [posted, setPosted] = useState<{
    balances: Balances;
    negative: boolean;
  } | null>(null);

  const [asking, setAsking] = useState<ConfirmSpec | null>(null);
  const isDraft = status === "DRAFT";
  const isConfirmed = status === "CONFIRMED";

  const confirmReceipt = () =>
    setAsking({
      title: `ยืนยันรับของตามใบ ${grNumber}?`,
      lines: [
        "สต๊อกเพิ่มทันที และระบบสร้างบิลค่าใช้จ่ายให้",
        "แก้ใบนี้ไม่ได้อีก ถ้าตัวเลขผิดต้องยกเลิกใบรับแล้วออกใบใหม่",
      ],
      money: null,
      who: "",
      go: "ยืนยันรับของเข้าคลัง",
      back: "ยังไม่ยืนยัน",
      onGo: doConfirm,
    });
  const doConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await orStale(onConfirm(id));
      if (res.ok) {
        setPosted({ balances: res.balances, negative: res.negative });
        router.refresh();
      } else {
        setError(res.formError ?? "ทำรายการไม่สำเร็จ");
      }
    });
  };

  const discard = () =>
    setAsking({
      title: `ทิ้งร่าง ${grNumber}?`,
      lines: ["ร่างนี้ยังไม่ได้รับเข้าคลัง จะหายไปจากรายการ"],
      money: null,
      who: "",
      go: "ทิ้งร่าง",
      back: "ไม่ทิ้ง",
      onGo: doDiscard,
    });
  const doDiscard = () => {
    setError(null);
    startTransition(async () => {
      const res = await orStale(onDiscard(id));
      if (res.ok) router.push("/goods-receipts");
      else setError(res.formError ?? "ทำรายการไม่สำเร็จ");
    });
  };

  const submitVoid = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await orStale(onVoid({ ok: false }, formData));
      if (res.ok) {
        setPosted({ balances: res.balances, negative: res.negative });
        setVoiding(false);
        router.refresh();
      } else {
        setError(
          res.formError ?? res.fieldErrors?.voidReason ?? "ทำรายการไม่สำเร็จ"
        );
      }
    });
  };

  const dialog = asking && <ConfirmDialog spec={asking} onClose={() => setAsking(null)} />;
  const errorBox = error && (
    <div className="basis-full rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</div>
  );
  const postedBox = posted && (
    <div
      className={`basis-full rounded-lg border p-3 text-sm ${
        posted.negative ? "border-bad-border bg-bad-bg text-bad" : "border-good-border bg-good-bg text-good"
      }`}
    >
      <p className="font-medium">{posted.negative ? "บันทึกแล้ว — แต่ต้องตรวจสอบ" : "บันทึกเข้าคลังแล้ว"}</p>
      <ul className="mt-1 space-y-0.5">
        {posted.balances.map((b) => (
          <li key={b.productId}>
            {b.productName}: คงเหลือ <span className="font-medium tabular-nums">{b.balance}</span>
          </li>
        ))}
      </ul>
      {posted.negative && (
        <p className="mt-1">
          มีวัตถุดิบที่ยอดคงเหลือติดลบ — แปลว่ามีการเบิกออกไปแล้วมากกว่าที่รับเข้า ลองตรวจการนับสต๊อกย้อนหลัง
        </p>
      )}
    </div>
  );

  if (part === "head") {
    return (
      <>
        {isDraft && (
          <a href={`/goods-receipts/${id}/edit`} className="btn-secondary">
            แก้ไข
          </a>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="btn-secondary"
        >
          พิมพ์ / บันทึกภาพ
        </button>
        {isDraft && (
          <button type="button" onClick={confirmReceipt} disabled={pending} className="btn">
            ยืนยันรับของเข้าคลัง
          </button>
        )}
        {errorBox}
        {postedBox}
        {dialog}
      </>
    );
  }

  if (!isConfirmed && !isDraft) return null;
  return (
    <section className="space-y-3 border-t border-border pt-4 print:hidden">
      {errorBox}
      {postedBox}
      <div className="flex flex-wrap gap-2">
        {isConfirmed && !voiding && (
          <button
            type="button"
            onClick={() => setVoiding(true)}
            disabled={pending}
            className="btn-danger"
          >
            ยกเลิกใบรับ
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

      {voiding && (
        <form
          action={submitVoid}
          className="rounded-lg border border-bad-border bg-bad-bg p-4"
        >
          <input type="hidden" name="id" value={id} />
          <label
            htmlFor="void_reason"
            className="label text-bad"
          >
            เหตุผลที่ยกเลิกใบรับ (จำเป็น)
          </label>
          <input
            id="void_reason"
            name="void_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น รับผิดใบ / ของไม่ตรงสเปกและส่งคืนทั้งหมด"
            className="mt-1 w-full rounded-lg border border-bad-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-bad">
            ระบบจะไม่ลบรายการเดิม แต่จะเพิ่ม &quot;รายการกลับรายการ&quot;
            ที่หักสต๊อกคืนเท่ากัน ทั้งสองบรรทัดจะอยู่ในใบนี้ตลอดไปเพื่อให้ตรวจย้อนหลังได้
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-bad px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              ยืนยันยกเลิกใบรับ
            </button>
            <button
              type="button"
              onClick={() => setVoiding(false)}
              className="btn-secondary"
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
