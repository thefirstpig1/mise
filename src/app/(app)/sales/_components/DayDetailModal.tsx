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

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  recordSalesPulseAction,
  type RecordPulseActionState,
} from "../pulse-actions";

export type DayModalCategory = { key: string; label: string; net: number; qty: number };
export type DayModalMenu = { id: string; name: string; categoryKey: string; net: number; qty: number };
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

const ALL = "__all__";
const baht = (v: number) => `฿${v.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;

export default function DayDetailModal({
  day,
  title,
  net,
  qty,
  categories,
  menus,
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
  categories: DayModalCategory[];
  menus: DayModalMenu[];
  branches: DayModalBranch[];
  canKeyPulse: boolean;
  closeHref: string;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  const [cat, setCat] = useState<string>(ALL);

  // A new day starts on "every category" again.
  useEffect(() => setCat(ALL), [day]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref as Route, { scroll: false });
      if (e.key === "ArrowLeft" && prevHref) router.push(prevHref as Route, { scroll: false });
      if (e.key === "ArrowRight" && nextHref) router.push(nextHref as Route, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [router, closeHref, prevHref, nextHref]);

  const only = categories.length === 1 ? categories[0].key : null;
  const shown = useMemo(
    () => (cat === ALL ? menus : menus.filter((m) => m.categoryKey === cat)),
    [cat, menus]
  );
  const shownTotal = shown.reduce((t, m) => t + m.net, 0);
  const maxCat = Math.max(1, ...categories.map((c) => c.net));
  const maxMenu = Math.max(1, ...shown.map((m) => m.net));
  const catLabel =
    cat === ALL ? (only ? categories[0].label : "ทุกหมวด") : categories.find((c) => c.key === cat)?.label ?? "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) router.push(closeHref as Route, { scroll: false });
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-modal-title"
    >
      <div className="relative w-full max-w-4xl rounded-2xl border border-border bg-surface p-4 shadow-xl sm:p-6">
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
        <Link
          href={closeHref as Route}
          scroll={false}
          aria-label="ปิด"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ×
        </Link>

        {/* ---------- branches ---------- */}
        {branches.length > 0 && (
          <div className={`mt-4 grid gap-2 ${branches.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {branches.map((b) => (
              <BranchCard key={b.branchId} day={day} branch={b} canKeyPulse={canKeyPulse} />
            ))}
          </div>
        )}

        {/* ---------- two panes ---------- */}
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1.3fr]">
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">หมวดเมนู</p>
            <p className="mb-2 text-[11px] text-muted-foreground">กดหมวดเพื่อดูเมนูในหมวดนั้น</p>
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {categories.length > 1 && (
                <CatButton active={cat === ALL} onClick={() => setCat(ALL)} label="ทุกหมวด" value={net} share={100} width={100} />
              )}
              {categories.map((c) => (
                <CatButton
                  key={c.key}
                  active={cat === c.key || c.key === only}
                  onClick={() => setCat(c.key)}
                  label={c.label}
                  value={c.net}
                  share={net > 0 ? (c.net / net) * 100 : 0}
                  width={(c.net / maxCat) * 100}
                />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              เมนูใน “{catLabel}” · {shown.length} เมนู · {baht(shownTotal)}
            </p>
            <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {shown.map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{m.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {baht(m.net)}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {m.qty.toLocaleString("th-TH")} จาน ·{" "}
                        {shownTotal > 0 ? ((m.net / shownTotal) * 100).toFixed(1) : "0.0"}%
                      </span>
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(m.net / maxMenu) * 100}%` }} />
                  </div>
                </li>
              ))}
              {shown.length === 0 && <li className="text-sm text-muted-foreground">ไม่มีเมนูในหมวดนี้</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
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

function CatButton({
  active,
  onClick,
  label,
  value,
  share,
  width,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: number;
  share: number;
  width: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-surface"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        <span className={`mt-1 block h-1 rounded-full ${active ? "bg-primary-foreground/25" : "bg-muted"}`}>
          <span
            className={`block h-1 rounded-full ${active ? "bg-primary-foreground" : "bg-primary/70"}`}
            style={{ width: `${width}%` }}
          />
        </span>
      </span>
      <span className={`shrink-0 text-right text-xs tabular-nums ${active ? "" : "text-muted-foreground"}`}>
        {baht(value)}
        <br />
        {share.toFixed(1)}%
      </span>
    </button>
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
