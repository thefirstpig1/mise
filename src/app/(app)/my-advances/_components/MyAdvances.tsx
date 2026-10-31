"use client";

// ADR 0037 Q5–Q6 — "สำรองจ่ายของฉัน" (mockup L7p9q52ENkn1cwKUPYCwSm, phone 1).
// Opens on the one number this person came for — what the shop still owes
// them — then every bill with where it stands. A bill missing its proof is
// tapped to add the photo; nothing here can change an amount once sent.

import { useEffect, useMemo, useState, useTransition } from "react";
import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import { orStale } from "@/lib/stale-tab";
import { PAYMENT_METHOD_LABEL, baht, shortDate } from "@/lib/advance-labels";
import { fileUrl } from "@/lib/upload-photo";
import type { ClaimView } from "@/server/staff-advance";
import { MissingPhoto, PhotoButton, PhotoThumb, StatusChip } from "@/app/(app)/advances/_components/claim-parts";
import { addClaimPhotosAction } from "../actions";
import SelfPurchaseSheet, { type SelfPurchaseOptions } from "./SelfPurchaseSheet";

type Filter = "open" | "refunded" | "all";

const daysSince = (ymd: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);

export default function MyAdvances({ claims, today, storageReady, ...options }: { claims: ClaimView[]; today: string; storageReady: boolean } & SelfPurchaseOptions) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("open");
  const [recording, setRecording] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const open = claims.filter((c) => c.status !== "REFUNDED");
  const owed = open.reduce((s, c) => s + c.amount, 0);
  const oldest = open.reduce<string | null>((o, c) => (o === null || c.billDate < o ? c.billDate : o), null);
  const month = today.slice(0, 7);
  const refundedThisMonth = claims.filter((c) => c.refund && c.refund.at.slice(0, 7) === month);
  const shown = useMemo(
    () => (filter === "open" ? open : filter === "refunded" ? claims.filter((c) => c.status === "REFUNDED") : claims),
    [filter, claims, open]
  );
  const openClaim = claims.find((c) => c.paymentId === openId) ?? null;

  const done = (message: string) => {
    setRecording(false);
    setToast(message);
    startRefresh(() => router.refresh());
  };

  return (
    <div className="max-w-xl space-y-4 pb-28">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.005em]">สำรองจ่ายของฉัน</h1>
          <p className="mt-1 text-sm text-muted-foreground">ของที่คุณซื้อให้ร้าน — ถ่ายบิลและสลิป แล้วติดตามว่าร้านคืนเงินหรือยัง</p>
        </div>
        <button type="button" onClick={() => setRecording(true)} className="btn max-sm:hidden" disabled={!storageReady}>
          <Camera aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.9} />
          บันทึกที่ซื้อเอง
        </button>
      </div>

      {!storageReady && (
        <p className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">ระบบเก็บรูปยังไม่พร้อม จึงยังบันทึกบิลใหม่ไม่ได้ — กรุณาแจ้งคิดครัว</p>
      )}

      <section className="rounded-2xl bg-primary px-5 py-4 text-primary-foreground">
        <p className="text-sm opacity-80">ร้านยังต้องคืนคุณ</p>
        <p className="font-display text-3xl font-semibold tabular-nums">{baht(owed)}</p>
        <p className="text-sm opacity-85">
          {open.length === 0 ? "ไม่มีบิลค้าง" : `${open.length} บิล · เก่าสุด ${shortDate(oldest!)}${daysSince(oldest!, today) > 0 ? ` (${daysSince(oldest!, today)} วัน)` : " (วันนี้)"}`}
        </p>
        <div className="mt-3 flex justify-between gap-3 border-t border-primary-foreground/25 pt-2 text-sm">
          <span>คืนแล้วเดือนนี้</span>
          <span className="tabular-nums">
            {baht(refundedThisMonth.reduce((s, c) => s + c.amount, 0))} · {refundedThisMonth.length} บิล
          </span>
        </div>
      </section>

      <div className="seg" role="group" aria-label="แสดง">
        {(
          [
            ["open", `รอคืน ${open.length}`],
            ["refunded", "คืนแล้ว"],
            ["all", "ทั้งหมด"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`seg-item ${filter === k ? "is-on" : ""}`}>
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">
          {filter === "open" ? "ยังไม่มีบิลที่รอคืนเงิน" : "ยังไม่มีรายการ"}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((c) => (
            <li key={c.paymentId}>
              <button
                type="button"
                onClick={() => setOpenId(c.paymentId)}
                className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-border/70 bg-surface shadow-card p-3 text-left transition-colors hover:bg-muted/50"
              >
                {c.billPhotoIds[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private route
                  <img src={fileUrl(c.billPhotoIds[0], { thumb: true })} alt="รูปบิล" loading="lazy" className="h-16 w-14 rounded-lg border border-border-strong object-cover" />
                ) : (
                  <MissingPhoto label="+ บิล" />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.what}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {shortDate(c.billDate)} · {c.place} · {PAYMENT_METHOD_LABEL[c.method]}
                  </span>
                </span>
                <span className="grid justify-items-end gap-1">
                  <span className="font-display font-medium tabular-nums">{baht(c.amount)}</span>
                  <StatusChip status={c.status} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open.some((c) => c.status === "NO_BILL" || c.status === "NO_SLIP") && <p className="text-center text-xs text-muted-subtle">บิลที่ขาดหลักฐาน กดเพื่อถ่ายเพิ่ม</p>}

      <button
        type="button"
        onClick={() => setRecording(true)}
        disabled={!storageReady}
        className="btn fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-30 h-12 text-base shadow-xl sm:hidden"
      >
        <Camera aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.9} />
          บันทึกที่ซื้อเอง
      </button>

      {recording && <SelfPurchaseSheet {...options} today={today} onClose={() => setRecording(false)} onDone={done} />}
      {openClaim && (
        <ClaimDetail
          claim={openClaim}
          onClose={() => setOpenId(null)}
          onChanged={(m) => {
            setToast(m);
            startRefresh(() => router.refresh());
          }}
          onError={setToast}
        />
      )}
      {toast && (
        <Portal>
          <div role="status" className="fixed inset-x-0 bottom-24 z-[70] mx-auto w-fit max-w-[90vw] animate-pop-in rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg">
            {toast}
          </div>
        </Portal>
      )}
    </div>
  );
}

function ClaimDetail({ claim: c, onClose, onChanged, onError }: { claim: ClaimView; onClose: () => void; onChanged: (m: string) => void; onError: (m: string) => void }) {
  useTopLayer(onClose);
  const add = async (kind: "BILL" | "PAYMENT_SLIP", fileId: string) => {
    const res = await orStale(addClaimPhotosAction({ paymentId: c.paymentId, kind, fileIds: [fileId] }));
    if (res.ok) onChanged(kind === "BILL" ? "เพิ่มรูปบิลแล้ว" : "เพิ่มสลิปแล้ว");
    else onError(res.formError);
  };
  const editable = c.status !== "REFUNDED";
  const steps: { done: boolean; title: string; sub: string }[] = [
    { done: true, title: "บันทึกแล้ว", sub: `${shortDate(c.billDate)} · ${c.branchName}` },
    ...(c.method === "CASH" || c.method === "OTHER"
      ? [{ done: c.status !== "NEEDS_ENDORSE" && c.status !== "NO_BILL", title: "บัญชีรับรอง", sub: c.endorseNote ?? (c.slipIds.length ? "มีสลิป ไม่ต้องรับรอง" : "ยังไม่ถึง") }]
      : []),
    {
      done: c.status === "REFUNDED",
      title: "โอนคืน",
      sub: c.refund ? `${shortDate(c.refund.at.slice(0, 10))} · ${PAYMENT_METHOD_LABEL[c.refund.method]}` : "คุณจะเห็นสลิปโอนคืนที่นี่",
    },
  ];

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-end p-0 sm:place-items-center sm:p-4">
        <div className="absolute inset-0 animate-fade-in bg-black/25" onMouseDown={onClose} aria-hidden />
        <div role="dialog" aria-modal="true" aria-labelledby="claim-title" className="relative max-h-[92dvh] w-full max-w-md animate-pop-in space-y-4 overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-2xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 id="claim-title" className="text-lg font-semibold">
                {c.what}
              </h3>
              <p className="text-xs text-muted-foreground">
                {shortDate(c.billDate)} · {c.place} · {PAYMENT_METHOD_LABEL[c.method]}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-2 text-xl text-muted-foreground hover:bg-muted" aria-label="ปิด">
              ×
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-display text-2xl font-semibold tabular-nums">{baht(c.amount)}</span>
            <StatusChip status={c.status} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-subtle">รูปบิล</p>
            <div className="flex flex-wrap gap-2">
              {c.billPhotoIds.map((id) => (
                <PhotoWithDownload key={id} id={id} label="บิล" />
              ))}
              {c.billPhotoIds.length === 0 && <MissingPhoto label="ไม่มี" />}
            </div>
            {editable && <PhotoButton kind="BILL" label={c.billPhotoIds.length ? "＋ เพิ่มรูปบิล" : "ถ่ายรูปบิล"} onUploaded={(r) => add("BILL", r.file.id)} onError={onError} />}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-subtle">สลิป</p>
            <div className="flex flex-wrap gap-2">
              {c.slipIds.map((id) => (
                <PhotoWithDownload key={id} id={id} label="สลิป" />
              ))}
              {c.slipIds.length === 0 && <span className="text-sm text-muted-foreground">{c.noSlipReason ? `ไม่มีสลิป — “${c.noSlipReason}”` : "ยังไม่มี"}</span>}
            </div>
            {editable && <PhotoButton kind="PAYMENT_SLIP" label={c.slipIds.length ? "＋ เพิ่มสลิป" : "แนบสลิป"} onUploaded={(r) => add("PAYMENT_SLIP", r.file.id)} onError={onError} />}
          </div>

          {c.refund && c.refund.slipIds.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-subtle">สลิปโอนคืน</p>
              <div className="flex flex-wrap gap-2">
                {c.refund.slipIds.map((id) => (
                  <PhotoWithDownload key={id} id={id} label="สลิปคืนเงิน" />
                ))}
              </div>
            </div>
          )}

          <ol className="space-y-0">
            {steps.map((s, i) => (
              <li key={s.title} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 pb-3 last:pb-0">
                {i < steps.length - 1 && <span className="absolute bottom-0 left-[0.56rem] top-5 w-0.5 bg-border" aria-hidden />}
                <span className={`relative z-10 grid h-5 w-5 place-items-center rounded-full border text-[11px] font-semibold ${s.done ? "border-good-border bg-good-bg text-good" : "border-border bg-surface-sunk text-muted-subtle"}`}>
                  {s.done ? "✓" : i + 1}
                </span>
                <span className="text-sm">
                  {s.title}
                  <span className="block text-xs text-muted-foreground">{s.sub}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Portal>
  );
}

/** A photo with its "ดาวน์โหลดรูปเต็ม" — Kong: the whole photo, for the accountant's file. */
function PhotoWithDownload({ id, label }: { id: string; label: string }) {
  return (
    <span className="grid justify-items-center gap-1">
      <PhotoThumb id={id} label={label} />
      <a href={fileUrl(id, { download: true })} className="text-[11px] text-primary underline decoration-dotted underline-offset-2">
        ดาวน์โหลด
      </a>
    </span>
  );
}
