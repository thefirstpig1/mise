"use client";

// The orders and requests behind one product's par state (Kong 2026-10-21,
// rule PAR-3, mockup round 5): what was done about it, whether that is enough,
// and the document itself — this product highlighted, and any other line that
// is below or near par given a quieter highlight, just to be seen.

import { useEffect, useState } from "react";
import type { ParDoc } from "@/server/product-list";
import type { ParStateKind } from "@/lib/par-alert";
import { packQtyTh, qtyFmt, thDate } from "@/app/(app)/menus/_components/manager-format";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";

export default function ParDocsPopup({
  productId,
  productName,
  branchId,
  branchName,
  state,
  onHand,
  par,
  baseUnitName,
  onClose,
}: {
  productId: string;
  productName: string;
  branchId: string;
  branchName: string;
  state: { kind: ParStateKind; coming: number };
  onHand: number;
  par: number;
  baseUnitName: string | null;
  onClose: () => void;
}) {
  useTopLayer(onClose);
  const [docs, setDocs] = useState<ParDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    fetch(`/api/products?what=docs&product=${productId}&branch=${branchId}`, { cache: "no-store" })
      .then((r) => (r.headers.get("content-type")?.includes("json") ? r.json() : null))
      .then((j) => on && (j?.ok ? setDocs(j.docs) : setError(j?.error ?? "เปิดไม่ได้ — ลองรีเฟรชหน้า")))
      .catch(() => on && setError("เชื่อมต่อไม่ได้ — ลองอีกครั้ง"));
    return () => {
      on = false;
    };
  }, [productId, branchId]);

  const u = (n: number) => qtyFmt(n, baseUnitName);
  const head: Record<ParStateKind, React.ReactNode> = {
    need: null,
    near: null,
    short: (
      <>
        สั่งไว้ {u(state.coming)} · รวมกับที่มี {u(onHand)} แล้ว <b className="text-bad">ยังไม่ถึงขั้นต่ำ {u(par)}</b> — สั่งเพิ่มอีกอย่างน้อย {u(Math.max(0, par - onHand - state.coming))}
      </>
    ),
    overdue: (
      <>
        ใบสั่งซื้อ<b className="text-bad">เลยวันนัดส่งแล้ว</b> — โทรตามผู้ขาย หรือรับของถ้ามาถึงแล้วแต่ยังไม่ได้บันทึก
      </>
    ),
    "stale-request": (
      <>
        ขอซื้อไว้แล้ว<b className="text-bad">แต่ยังไม่มีใครสั่ง</b>เกิน 3 วัน — ตามจัดซื้อ หรือสั่งจากหน้าตัดรอบใบขอซื้อ
      </>
    ),
    ordered: (
      <>
        สั่งไว้ {u(state.coming)} · มาถึงแล้วจะมี {u(onHand + state.coming)} <b className="text-good">เกินขั้นต่ำ {u(par)}</b> · ตัวเลขแดงจึงไม่นับรายการนี้
      </>
    ),
    requested: <>ขอซื้อแล้ว รอจัดซื้อสั่ง · ตัวเลขแดงจึงไม่นับรายการนี้ · ถ้าเกิน 3 วันยังไม่มีใครสั่ง จะกลับมาเป็นสีแดง</>,
    "near-covered": <>ใกล้ขั้นต่ำ แต่สั่งไว้แล้ว {u(state.coming)} · ตัวเลขเหลืองจึงไม่นับรายการนี้</>,
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" aria-labelledby="pardocs-title" className="max-h-[calc(100vh-32px)] w-full max-w-xl animate-pop-in overflow-y-auto rounded-2xl bg-surface shadow-2xl">
          <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
            <div>
              <h3 id="pardocs-title" className="text-base font-semibold">
                {productName} · {branchName}
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{head[state.kind]}</p>
            </div>
            <button type="button" autoFocus onClick={onClose} aria-label="ปิด" className="rounded-lg px-2 text-2xl leading-none text-muted-foreground hover:bg-muted">
              ×
            </button>
          </div>

          {error && <p className="px-5 pb-4 text-sm text-bad">{error}</p>}
          {!docs && !error && <div className="mx-4 mb-4 h-32 animate-pulse rounded-xl bg-muted" />}

          {docs?.map((d) => (
            <section key={`${d.kind}-${d.id}`} className="mx-4 mb-4 overflow-hidden rounded-2xl border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-sunk px-4 py-2.5">
                <span>
                  <b className="font-display">{d.number}</b>
                  <span className="block text-xs text-muted-foreground">
                    {d.supplier ?? "ให้จัดซื้อเลือกผู้ขาย"}
                    {d.requestedBy ? ` · ขอโดย ${d.requestedBy}` : ""} · {d.kind === "PR" ? "ขอเมื่อ" : "ส่งเมื่อ"} {d.date ? thDate(d.date) : "—"}
                  </span>
                </span>
                <span className={`text-sm ${d.lateDays > 0 ? "font-medium text-bad" : "text-muted-foreground"}`}>
                  {d.kind === "PR"
                    ? "ขอซื้อแล้ว · รอจัดซื้อสั่ง"
                    : d.lateDays > 0
                      ? `เลยนัด ${d.lateDays} วัน${d.assumed ? " (ไม่ได้ใส่วันนัด · นับ 3 วันจากวันส่ง)" : ""}`
                      : d.expected
                        ? `นัดส่ง ${thDate(d.expected)}`
                        : "ยังไม่ได้ใส่วันนัดส่ง"}
                </span>
              </div>
              {d.lines.map((l, i) => {
                const primary = l.productId === productId;
                const tone = !primary && l.tone;
                return (
                  <div
                    key={i}
                    className={`relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border px-4 py-2.5 last:border-b-0 ${
                      primary
                        ? "bg-gradient-to-r from-[rgb(174_183_132/0.38)] to-[rgb(174_183_132/0.1)] shadow-[inset_4px_0_0_#6E7A3A]"
                        : tone === "red"
                          ? "bg-gradient-to-r from-[rgb(229_72_77/0.1)] to-transparent shadow-[inset_3px_0_0_rgb(229_72_77/0.55)]"
                          : tone === "yellow"
                            ? "bg-gradient-to-r from-[rgb(245_197_66/0.16)] to-transparent shadow-[inset_3px_0_0_rgb(245_197_66/0.8)]"
                            : ""
                    }`}
                  >
                    {primary && <span className="absolute -top-2 right-3 rounded-full bg-[#6E7A3A] px-2 py-px text-[10px] text-white">รายการนี้</span>}
                    <span className={primary ? "font-semibold" : ""}>
                      {l.name}
                      {tone && (
                        <span className={`ml-1.5 rounded-full px-2 py-px text-[11px] ${tone === "red" ? "bg-bad-bg text-bad" : "border border-warn-border bg-warn-bg text-warn"}`}>
                          {tone === "red" ? "ต่ำกว่าขั้นต่ำ" : "ใกล้ขั้นต่ำ"}
                        </span>
                      )}
                    </span>
                    <span className="text-right tabular-nums">
                      {packQtyTh(l.qty, l.unitName)}
                    </span>
                    <span className="col-span-2 text-xs text-muted-foreground">
                      มี {qtyFmt(l.onHand, l.baseUnitName)}
                      {l.par !== null ? ` → มาถึงแล้วจะมี ${qtyFmt(l.onHand + l.base, l.baseUnitName)} · ขั้นต่ำ ${qtyFmt(l.par, l.baseUnitName)}` : ""}
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-end gap-2 px-3 py-2.5">
                {d.kind === "PO" && d.lateDays > 0 && (
                  <a href={`/goods-receipts/new?po=${d.id}`} className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted">
                    รับของ
                  </a>
                )}
                <a href={d.kind === "PO" ? `/purchase-orders/${d.id}` : "/purchase-requests"} className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted">
                  {d.kind === "PO" ? "เปิดใบสั่งซื้อ" : "เปิดใบขอซื้อ"}
                </a>
              </div>
            </section>
          ))}
          {docs && docs.length === 0 && <p className="px-5 pb-4 text-sm text-muted-foreground">ไม่พบใบที่ยังค้างอยู่ — อาจรับของหรือยกเลิกไปแล้ว ลองรีเฟรชหน้า</p>}
          <p className="px-5 pb-4 text-xs text-muted-subtle">ไฮไลท์เขียว = รายการนี้ · แถบแดง/เหลืองจาง = สินค้าอื่นในใบเดียวกันที่ต่ำกว่า/ใกล้ขั้นต่ำ (ดูเฉย ๆ)</p>
        </div>
      </div>
    </Portal>
  );
}
