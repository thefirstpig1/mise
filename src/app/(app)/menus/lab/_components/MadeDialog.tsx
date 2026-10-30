"use client";

// "นี่คือของที่ร้านทำเอง" (Kong 2026-10-30: "ถ้าเผลอบันทึกเป็นเมนูไปแล้วจะทำยังไงดี").
// A draft that is really something the shop makes for its dishes (น้ำซุป)
// becomes a live production recipe. Before anything is written the dialog says
// what will happen — which product it makes (an ingredient turned shop-made,
// or a new one), the day it starts, and whether the dish the draft created
// goes — and asks the one thing a dish recipe never had: how much one batch
// makes.

import { useEffect, useState, useTransition } from "react";
import { orStale } from "@/lib/stale-tab";
import type { MadePreview } from "@/server/menu-lab";
import { Portal, useTopLayer } from "../../_components/sheet-parts";
import { thDate, unitTh } from "../../_components/manager-format";
import { madePreview } from "../../_components/prefetch";
import { draftToMadeAction } from "../actions";

const DIMENSION_ORDER: Record<string, number> = { VOLUME: 0, WEIGHT: 1, COUNT: 2 };

export default function MadeDialog({
  recipeId,
  menuName,
  onClose,
  onDone,
}: {
  recipeId: string;
  menuName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  useTopLayer(onClose);
  const [preview, setPreview] = useState<MadePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    void madePreview(recipeId).then((r) => {
      if (!r.ok) return setLoadError(r.error);
      setPreview(r.preview);
      setUnit(r.preview.product?.units.find((u) => u.isBase)?.unitName ?? "");
    });
  }, [recipeId]);

  const p = preview?.product ?? null;
  // An existing product is measured in its own units; a new one takes the unit
  // chosen here as the one its stock is counted in.
  const units = p
    ? p.units.map((u) => u.unitName)
    : [...(preview?.templates ?? [])].sort((a, b) => (DIMENSION_ORDER[a.unitDimension] ?? 9) - (DIMENSION_ORDER[b.unitDimension] ?? 9)).map((t) => t.unitName);
  const refused = p?.blocked ?? (preview?.fromMenu ? "MENU" : null);

  const go = () =>
    start(async () => {
      setError(null);
      const res = await orStale(draftToMadeAction({ recipeId, yieldQty: Number(qty), unitName: unit, menuName }));
      if (!res.ok) return setError(res.formError);
      onDone(
        `ย้าย “${menuName}” ไปเป็นของที่ร้านทำเองแล้ว` +
          (res.menuRemoved === true ? " · ลบเมนูที่สร้างไว้ตอนร่างออกแล้ว" : res.menuRemoved === false ? " · ยังไม่ได้ลบเมนู ลบได้ที่หน้าจัดการเมนู" : "")
      );
    });

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" aria-labelledby="made-title" className="w-full max-w-md animate-pop-in space-y-3 rounded-2xl bg-surface p-5 shadow-2xl">
          <h3 id="made-title" className="text-base font-semibold">
            “{menuName}” เป็นของที่ร้านทำเอง
          </h3>
          <p className="text-sm text-muted-foreground">ไม่ใช่เมนูที่ขาย แต่เป็นของที่ร้านทำไว้ใส่ในเมนูอื่น เช่น น้ำซุป น้ำจิ้ม — ร่างนี้จะย้ายไปเป็นสูตรผลิต</p>
          {preview === null ? (
            <p className={`text-sm ${loadError ? "text-bad" : "text-muted-foreground"}`}>{loadError ?? "กำลังโหลด…"}</p>
          ) : refused !== null ? (
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm">
              {refused === "RECIPE"
                ? `“${p!.name}” มีสูตรผลิตอยู่แล้ว — แก้ที่หน้าสินค้า แล้วทิ้งร่างนี้`
                : refused === "TRIM"
                  ? `“${p!.name}” ตัดแต่งจากของอื่นอยู่แล้ว — ของหนึ่งอย่างทำได้วิธีเดียว`
                  : "สูตรนี้มีเมนูอื่นเป็นส่วนประกอบ — สูตรของที่ร้านทำเองใช้ได้แต่วัตถุดิบ"}
            </p>
          ) : (
            <>
              <ul className="space-y-1 text-sm">
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
                  <span>
                    {p === null ? `สร้างของแปรรูปใหม่ “${menuName}”` : p.type === "RAW" ? `“${p.name}” ในรายการวัตถุดิบ จะเปลี่ยนเป็นของที่ร้านทำเอง` : `ใช้ของแปรรูป “${p.name}” ที่มีอยู่`}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
                  <span>มีผลทันที ตั้งแต่ {thDate(preview.madeFrom)} · ใช้ร่วมกันทุกสาขา</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
                  <span>{preview.menuGoes ? `เมนู “${menuName}” ที่สร้างไว้ตอนร่างจะถูกลบออก (ยังไม่เคยขาย)` : `เมนู “${menuName}” ยังอยู่ในรายการเมนู เพราะมาจาก POS หรือเคยขายแล้ว`}</span>
                </li>
              </ul>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                ทำครั้งหนึ่งได้
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  aria-label="ทำครั้งหนึ่งได้เท่าไร"
                  className="input h-9 w-24 py-1"
                  autoFocus
                />
                <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="หน่วยที่ทำได้" className="input h-9 w-auto py-1">
                  {p === null && <option value="">หน่วย…</option>}
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {unitTh(u)}
                    </option>
                  ))}
                </select>
              </label>
              {p === null && <p className="text-xs text-muted-foreground">หน่วยที่เลือกจะเป็นหน่วยนับสต๊อกของ “{menuName}”</p>}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary btn-sm">
              ไม่ใช่
            </button>
            <button type="button" onClick={go} disabled={busy || preview === null || refused !== null || !(Number(qty) > 0) || unit === ""} className="btn btn-sm disabled:opacity-50">
              {busy ? "กำลังย้าย…" : "ย้ายไปเป็นของที่ร้านทำเอง"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
