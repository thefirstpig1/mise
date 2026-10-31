"use client";

// ============================================================
// Mise — ประวัติสูตร you can open (Kong, 2026-10-28)
// ============================================================
// Approved mockup 7VQiTBsoiaQc56GdiD8f6v. The list used to say only "ตั้งแต่
// 5 ต.ค. 69 / ตั้งแต่ 3 ส.ค. 69" — nobody could tell what changed, who
// changed it, or what it did to the cost of a plate.
//
// Each version opens to its difference from the version before it: an
// ingredient added, removed, or its amount changed (compared in BASE units, so
// 0.2 kg → 200 g is not a change). Its cost per plate is priced from the
// branch's price book of TODAY — the same book the editor uses — so two
// versions differ only by what is in them, never by when pork was cheaper.
// Money only for someone who may see cost.
// ============================================================

import { useState } from "react";
import type { MenuSheet as SheetData, PriceBook } from "@/server/menu-manager";
import { lineCost as lineCostWith, type Line } from "./recipe-editor";
import { baht, thDate } from "./manager-format";

type Version = SheetData["history"][number];

export const sheetLinesToLines = (lines: Version["lines"]): Line[] =>
  lines.map((l) => ({
    key: l.ingredientId,
    kind: l.kind,
    productId: l.productId,
    componentMenuId: l.componentMenuId,
    label: l.label,
    sku: l.sku,
    prepped: l.prepped,
    qty: String(l.qty),
    unitId: l.unitId,
    unitName: l.unitName,
    ratio: l.kind === "menu" ? 1 : l.toBaseRatio,
    notes: l.notes ?? "",
  }));

const keyOf = (l: Line) => (l.kind === "menu" ? `m:${l.componentMenuId}` : `p:${l.productId}`);
const base = (l: Line) => Number(l.qty) * (l.ratio || 1);
const amount = (l: Line) => `${Number(l.qty).toLocaleString("th-TH", { maximumFractionDigits: 3 })} ${l.unitName ?? ""}`.trim();

type Change = { kind: "add" | "del" | "chg"; text: string; cost: number | null };

/** What `cur` changed relative to `prev`, in the order the recipe lists it. */
export function diffVersions(cur: Line[], prev: Line[], cost: (l: Line) => number | null): Change[] {
  const before = new Map(prev.map((l) => [keyOf(l), l]));
  const after = new Map(cur.map((l) => [keyOf(l), l]));
  const out: Change[] = [];
  for (const l of prev) if (!after.has(keyOf(l))) out.push({ kind: "del", text: `${l.label} ${amount(l)}`, cost: cost(l) });
  for (const l of cur) {
    const was = before.get(keyOf(l));
    if (!was) out.push({ kind: "add", text: `${l.label} ${amount(l)}`, cost: cost(l) });
    else if (Math.abs(base(was) - base(l)) > 1e-9) out.push({ kind: "chg", text: `${l.label} ${amount(was)} → ${amount(l)}`, cost: cost(l) });
  }
  return out;
}

export default function RecipeHistory({ history, book, costHidden }: { history: Version[]; book: PriceBook | null; costHidden: boolean }) {
  const [open, setOpen] = useState<string | null>(history.find((h) => h.isCurrent)?.recipeId ?? null);
  const cost = (l: Line) => (costHidden ? null : lineCostWith(l, book));
  const versions = history.map((h) => {
    const lines = sheetLinesToLines(h.lines);
    const all = lines.map(cost);
    const perPlate = costHidden || book === null || all.some((c) => c === null) ? null : all.reduce((t: number, c) => t + (c ?? 0), 0) / (h.servings || 1);
    return { h, lines, perPlate };
  });
  // The version each one changed: the next OLDER one that still stands.
  const prevOf = (i: number) => versions.slice(i + 1).find((v) => !v.h.isSuperseded) ?? null;

  return (
    <details className="group rounded-[18px] border border-border/70 bg-surface shadow-card p-4" open={history.length > 1}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">
          ประวัติสูตร · {history.length} เวอร์ชัน <span className="ml-1 text-xs font-normal text-muted-foreground">กดเวอร์ชันเพื่อดูว่าเปลี่ยนอะไร</span>
        </span>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-none text-muted-subtle transition-transform group-open:rotate-180">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {versions.map((v, i) => {
          const { h } = v;
          const prev = prevOf(i);
          const isOpen = open === h.recipeId;
          const changes = prev ? diffVersions(v.lines, prev.lines, cost) : [];
          const delta = prev && v.perPlate !== null && prev.perPlate !== null ? v.perPlate - prev.perPlate : null;
          return (
            <li key={h.recipeId}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : h.recipeId)}
                className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isOpen ? "border-border-strong bg-surface-sunk" : "border-border hover:bg-surface-sunk"
                }`}
              >
                <span className={`font-semibold ${h.isSuperseded ? "text-muted-subtle line-through" : ""}`}>ตั้งแต่ {thDate(h.effectiveFrom)}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {[h.savedBy, h.notes].filter(Boolean).join(" · ") || `บันทึก ${thDate(h.savedAt)}`}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`rounded-full border px-2 text-[11px] ${
                      h.isCurrent ? "border-good-border bg-good-bg text-good" : "border-border-strong text-muted-foreground"
                    }`}
                  >
                    {h.isCurrent ? "ใช้อยู่" : h.isSuperseded ? "แก้ทับแล้ว" : "เวอร์ชันก่อน"}
                  </span>
                  {!costHidden && <b className="tabular-nums">{v.perPlate === null ? (book === null ? "…" : "—") : baht(v.perPlate, 2)}</b>}
                </span>
              </button>
              {isOpen && (
                <div className="ml-1 mt-1.5 space-y-1.5 border-l-2 border-border-strong py-1 pl-3 text-[13px]">
                  {h.isSuperseded && <p className="text-xs text-muted-foreground">เวอร์ชันนี้ถูกแก้ทับในวันเดียวกัน (บันทึกผิดแล้วแก้) ไม่เคยใช้คิดยอดวันไหน</p>}
                  {prev ? (
                    <>
                      <p className="text-xs text-muted-foreground">เปลี่ยนจากเวอร์ชัน {thDate(prev.h.effectiveFrom)} · บันทึก {thDate(h.savedAt)}</p>
                      {changes.length === 0 ? (
                        <p className="text-muted-foreground">วัตถุดิบเหมือนเดิม{h.servings !== prev.h.servings ? ` · เปลี่ยนจำนวนที่ทำได้ ${prev.h.servings} → ${h.servings} จาน` : ""}</p>
                      ) : (
                        changes.map((c, k) => (
                          <p key={k} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-2">
                            <span className={`text-center font-bold ${c.kind === "add" ? "text-good" : c.kind === "del" ? "text-bad" : "text-warn"}`}>
                              {c.kind === "add" ? "+" : c.kind === "del" ? "−" : "~"}
                            </span>
                            <span className={c.kind === "del" ? "text-muted-foreground line-through" : ""}>{c.text}</span>
                            {!costHidden && <span className="tabular-nums text-muted-foreground">{c.cost === null ? "" : baht(c.cost, 2)}</span>}
                          </p>
                        ))
                      )}
                      {delta !== null && Math.abs(delta) >= 0.005 && (
                        <p>
                          ต้นทุนต่อจาน {baht(prev.perPlate!, 2)} → <b>{baht(v.perPlate!, 2)}</b>{" "}
                          <span
                            className={`rounded-full border px-2 text-[11px] font-semibold ${
                              delta > 0 ? "border-bad-border bg-bad-bg text-bad" : "border-good-border bg-good-bg text-good"
                            }`}
                          >
                            {delta > 0 ? "+" : "−"}
                            {baht(Math.abs(delta), 2)}
                          </span>
                        </p>
                      )}
                      {changes.length > 0 && v.lines.length - changes.filter((c) => c.kind !== "del").length > 0 && (
                        <p className="text-xs text-muted-foreground">อีก {v.lines.length - changes.filter((c) => c.kind !== "del").length} วัตถุดิบเหมือนเดิม</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">เวอร์ชันแรก · {v.lines.length} วัตถุดิบ · บันทึก {thDate(h.savedAt)}</p>
                      <p>{v.lines.map((l) => `${l.label} ${amount(l)}`).join(" · ")}</p>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {costHidden ? "" : "ต้นทุนทุกเวอร์ชันคิดด้วยราคาวัตถุดิบวันนี้ จึงเทียบกันได้ตรง ๆ · "}
        วันที่ขายในอดีตยังตัดสต๊อกตามสูตรที่ใช้วันนั้น
      </p>
    </details>
  );
}
