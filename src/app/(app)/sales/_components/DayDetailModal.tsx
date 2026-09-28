"use client";

// ============================================================
// Mise — one sales day, as a popup (Kong, 2026-09-28)
// ============================================================
// Kong's own sheet opened a day as a window over the chart: categories on the
// left, the chosen category's menus on the right. "ประหยัดเนื้อที่ แล้วมันก็ดูมี
// ความเชื่อมโยงกับข้อมูล" — the day stays attached to the bar you pressed,
// instead of a panel appearing somewhere further down the page.
//
// It lives in the URL (`?day=`), so it is linkable and the back button closes
// it. Esc and a click outside close it too.
//
// The branch strip is the other half of the job: a sales day is per BRANCH, so
// "all branches" folds several into one row, and this is where they come apart
// again — each with its file, its till figure, and (when no file has arrived
// yet) a box to key that figure in. A file LOCKS the till figure (ADR 0020), so
// a branch whose file is in shows why there is no box instead.
// ============================================================

import { useActionState, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  recordSalesPulseAction,
  type RecordPulseActionState,
} from "../pulse-actions";
import {
  BreakdownPanes,
  ModalShell,
  baht,
  type BreakdownCategory,
  type BreakdownMenu,
  type ToneMap,
} from "./Breakdown";

export type DayModalBranch = {
  branchId: string;
  name: string;
  /** null = this branch has no sales day on this date at all. */
  net: number | null;
  fileName: string | null;
  importedAtLabel: string | null;
  pulseAmount: number | null;
  pulseDifference: number | null;
  pulseIsMismatch: boolean;
  pulseNote: string | null;
};

export default function DayDetailModal({
  day,
  title,
  net,
  qty,
  categories,
  menus,
  tones,
  branches,
  canKeyPulse,
  closeHref,
  prevHref,
  nextHref,
}: {
  day: string;
  title: string;
  net: number;
  qty: number;
  categories: BreakdownCategory[];
  menus: BreakdownMenu[];
  tones: ToneMap;
  branches: DayModalBranch[];
  canKeyPulse: boolean;
  closeHref: string;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  const go = useCallback((href: string) => router.push(href as Route, { scroll: false }), [router]);
  const close = useCallback(() => go(closeHref), [go, closeHref]);
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevHref) go(prevHref);
      if (e.key === "ArrowRight" && nextHref) go(nextHref);
    },
    [go, prevHref, nextHref]
  );

  return (
    <ModalShell onClose={close} onKey={onKey} labelledBy="day-modal-title">
      {/* ---------- header ---------- */}
      <div className="flex items-start justify-between gap-3 pr-10">
        <div>
          <h3 id="day-modal-title" className="text-lg font-semibold">
            {title}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            ยอดขาย <span className="font-medium text-foreground tabular-nums">{baht(net)}</span> ·{" "}
            {qty.toLocaleString("th-TH")} จาน · {categories.length} หมวด
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <NavArrow href={prevHref} label="วันก่อนหน้า">‹</NavArrow>
          <NavArrow href={nextHref} label="วันถัดไป">›</NavArrow>
        </div>
      </div>

      {/* ---------- branches ---------- */}
      {branches.length > 0 && (
        <div className={`mt-4 grid gap-2 ${branches.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {branches.map((b) => (
            <BranchCard key={b.branchId} day={day} branch={b} canKeyPulse={canKeyPulse} />
          ))}
        </div>
      )}

      <div className="mt-4">
        <BreakdownPanes categories={categories} menus={menus} tones={tones} total={net} resetKey={day} />
      </div>
    </ModalShell>
  );
}

function NavArrow({ href, label, children }: { href: string | null; label: string; children: string }) {
  const cls = "flex h-9 w-9 items-center justify-center rounded-full border border-border text-lg";
  return href ? (
    <Link href={href as Route} scroll={false} aria-label={label} title={label} className={`${cls} hover:bg-muted`}>
      {children}
    </Link>
  ) : (
    <span aria-hidden className={`${cls} opacity-30`}>
      {children}
    </span>
  );
}

function BranchCard({ day, branch: b, canKeyPulse }: { day: string; branch: DayModalBranch; canKeyPulse: boolean }) {
  const [state, action, pending] = useActionState<RecordPulseActionState | null, FormData>(
    recordSalesPulseAction,
    null
  );
  // The till figure can be keyed only while no file owns the day (ADR 0020).
  const canKey = canKeyPulse && b.fileName === null;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <div className="rounded-xl border border-border p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{b.name}</span>
        <span className="tabular-nums font-medium">{b.net === null ? "—" : baht(b.net)}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {b.fileName
          ? `จากไฟล์ ${b.fileName} · นำเข้า ${b.importedAtLabel}`
          : "ยังไม่มีไฟล์ยอดขายของวันนี้"}
      </p>

      <div className="mt-2 border-t border-border/60 pt-2 text-xs">
        <span className="text-muted-foreground">ยอดที่คีย์ตอนปิดร้าน: </span>
        {b.pulseAmount === null ? (
          <span className="text-muted-foreground">ไม่ได้คีย์</span>
        ) : (
          <>
            <span className="font-medium tabular-nums">{baht(b.pulseAmount)}</span>
            {b.pulseDifference !== null && (
              <span className={`ml-1 ${b.pulseIsMismatch ? "font-medium text-bad" : "text-muted-foreground"}`}>
                (ไฟล์ {b.pulseDifference >= 0 ? "+" : ""}
                {baht(b.pulseDifference)})
              </span>
            )}
          </>
        )}
        {b.pulseNote && <span className="block text-muted-foreground">“{b.pulseNote}”</span>}
        {b.pulseIsMismatch && (
          <span className="mt-1 block text-bad">
            ไฟล์กับยอดที่คีย์ไม่ตรงกัน — มักแปลว่า export มาไม่ครบทั้งวัน ลอง export ใหม่แล้วนำเข้าทับ
          </span>
        )}

        {canKey &&
          (open ? (
            <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="branchId" value={b.branchId} />
              <input type="hidden" name="businessDate" value={day} />
              <label className="flex-1">
                <span className="text-muted-foreground">ยอดที่ลูกค้าจ่ายทั้งวัน (รวม VAT และ SC)</span>
                <input
                  name="amount"
                  inputMode="decimal"
                  defaultValue={b.pulseAmount ?? ""}
                  className="input mt-1 w-full"
                  autoFocus
                />
              </label>
              <label className="w-full">
                <span className="text-muted-foreground">หมายเหตุ (ไม่บังคับ)</span>
                <input name="note" defaultValue={b.pulseNote ?? ""} className="input mt-1 w-full" />
              </label>
              <button type="submit" disabled={pending} className="btn">
                {pending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground underline">
                ยกเลิก
              </button>
              {state && !state.ok && (
                <p className="w-full text-bad">
                  {state.formError ?? Object.values(state.fieldErrors ?? {})[0]}
                </p>
              )}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-2 block rounded-full border border-primary-line px-3 py-1 font-medium text-primary hover:bg-primary hover:text-primary-foreground"
            >
              {b.pulseAmount === null ? "คีย์ยอดปิดร้าน" : "แก้ยอดที่คีย์"}
            </button>
          ))}
        {canKeyPulse && b.fileName !== null && b.pulseAmount === null && (
          <span className="mt-1 block text-muted-foreground">
            คีย์ได้เฉพาะก่อนนำเข้าไฟล์ของวันนั้น — ไฟล์เข้ามาแล้ว ยอดในไฟล์จึงเป็นหลักฐานของวันนี้
          </span>
        )}
      </div>
    </div>
  );
}
