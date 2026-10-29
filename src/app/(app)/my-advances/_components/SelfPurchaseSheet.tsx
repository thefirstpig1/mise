"use client";

// ADR 0037 Q6 — "บันทึกที่ซื้อเอง" (mockup L7p9q52ENkn1cwKUPYCwSm, phones 2–3).
// The camera comes first; then what was bought (stock from the picker, other
// things against a category); then how it was paid, with what happens next
// shown BEFORE it is sent. The form keeps one submit key for its whole life,
// so pressing ส่ง again after an error finishes the same claim, never a second.

import { useMemo, useState } from "react";
import { Sheet } from "@/app/(app)/menus/_components/sheet-parts";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import { orStale } from "@/lib/stale-tab";
import { baht, shortDate } from "@/lib/advance-labels";
import type { UploadResult } from "@/lib/upload-photo";
import { PhotoButton, PhotoThumb } from "@/app/(app)/advances/_components/claim-parts";
import { recordSelfPurchaseAction } from "../actions";

export type SelfPurchaseOptions = {
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  products: (PickerProduct & { units: { id: string; unitName: string; isBase: boolean }[] })[];
  categories: { id: string; label: string; opex: boolean }[];
  suppliers: { id: string; name: string }[];
};

type StockLine = { key: string; productId: string; unitId: string; qty: string; total: string };
type OtherLine = { key: string; description: string; categoryId: string; total: string };
type Pay = "TRANSFER" | "CASH" | "SHOP";
type Dup = Extract<UploadResult, { ok: true }>["duplicates"][number];

const key = () => Math.random().toString(36).slice(2);
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export default function SelfPurchaseSheet({
  branches,
  defaultBranchId,
  products,
  categories,
  suppliers,
  today,
  onClose,
  onDone,
}: SelfPurchaseOptions & { today: string; onClose: () => void; onDone: (message: string) => void }) {
  const [submitKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState<1 | 2>(1);
  const [bills, setBills] = useState<string[]>([]);
  const [dups, setDups] = useState<Dup[]>([]);
  const [place, setPlace] = useState("");
  const [branchId, setBranchId] = useState(defaultBranchId);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const [billDate, setBillDate] = useState(today);
  const [stock, setStock] = useState<StockLine[]>([]);
  const [others, setOthers] = useState<OtherLine[]>([]);
  const [pay, setPay] = useState<Pay>("TRANSFER");
  const [slips, setSlips] = useState<string[]>([]);
  const [noSlipReason, setNoSlipReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const supplier = suppliers.find((s) => s.name.trim() === place.trim()) ?? null;
  const total = [...stock, ...others].reduce((s, l) => s + (num(l.total) || 0), 0);

  const step1Problem =
    !place.trim()
      ? "ระบุว่าซื้อที่ไหน"
      : stock.length + others.length === 0
        ? "เพิ่มอย่างน้อย 1 รายการ"
        : stock.some((l) => !l.productId || !(num(l.qty) > 0) || !(num(l.total) > 0))
          ? "ใส่ของ จำนวน และยอดเงินให้ครบทุกบรรทัด"
          : others.some((l) => !l.description.trim() || !l.categoryId || !(num(l.total) > 0))
            ? "ใส่ชื่อ หมวด และยอดเงินให้ครบทุกบรรทัด"
            : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await orStale(
      recordSelfPurchaseAction({
        submitKey,
        branchId,
        billDate,
        supplierId: supplier?.id ?? null,
        vendorName: supplier ? null : place.trim(),
        stockLines: stock.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: num(l.qty), lineTotal: num(l.total), purchaseRequestLineId: null })),
        otherLines: others.map((l) => ({ categoryId: l.categoryId, description: l.description.trim(), lineTotal: num(l.total) })),
        payer: pay === "SHOP" ? "SHOP" : "STAFF",
        method: pay === "SHOP" ? "OTHER" : pay,
        noSlipReason: pay === "CASH" ? noSlipReason : null,
        billFileIds: bills,
        slipFileIds: pay === "TRANSFER" ? slips : [],
      })
    );
    setBusy(false);
    if (!res.ok) return setError(res.formError);
    onDone(pay === "SHOP" ? `บันทึกบิล ${baht(total)} แล้ว` : `ส่งให้บัญชีแล้ว · ${baht(total)}`);
  };

  const onBill = (r: Extract<UploadResult, { ok: true }>) => {
    setBills((b) => [...b, r.file.id]);
    if (r.duplicates.length) setDups(r.duplicates);
  };

  return (
    <Sheet onClose={onClose} labelledBy="self-purchase-title">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-4">
        {step === 2 && (
          <button type="button" onClick={() => setStep(1)} className="rounded-lg px-2 text-xl text-muted-foreground hover:bg-muted" aria-label="ย้อนกลับ">
            ‹
          </button>
        )}
        <h3 id="self-purchase-title" className="flex-1 text-lg font-semibold">
          {step === 1 ? "บันทึกที่ซื้อเอง" : "จ่ายยังไง"}
        </h3>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-muted-foreground hover:bg-muted" aria-label="ปิด">
          ×
        </button>
      </div>

      <div className="space-y-5 px-5 py-4 pb-10 max-sm:flex-none sm:flex-1 sm:overflow-y-auto">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-1 flex-1 rounded-full bg-primary" />
          <span className={`h-1 flex-1 rounded-full ${step === 2 ? "bg-primary" : "bg-wash"}`} />
        </div>

        {step === 1 ? (
          <>
            {/* ---- the bill photo, first ---- */}
            {bills.length === 0 ? (
              <div className="grid place-items-center gap-2 rounded-2xl border-2 border-dashed border-border-strong bg-surface-sunk px-4 py-7 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-2xl text-primary-foreground">📷</span>
                <p className="font-display font-semibold">ถ่ายรูปบิลก่อน</p>
                <p className="text-xs text-muted-foreground">บัญชีคืนเงินได้เมื่อมีรูปบิล · ไม่มีบิลก็บันทึกไว้ก่อนได้ แล้วค่อยเพิ่ม</p>
                <PhotoButton kind="BILL" label="ถ่ายรูป / เลือกรูป" className="btn btn-sm" onUploaded={onBill} onError={setError} />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {bills.map((id, i) => (
                    <PhotoThumb key={id} id={id} label={`รูปบิล ${i + 1}`} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="chip chip-good">รูปบิล ✓</span>
                  <PhotoButton kind="BILL" label="＋ อีกรูป (บิลยาว)" onUploaded={onBill} onError={setError} />
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => (setBills([]), setDups([]))}>
                    ถ่ายใหม่
                  </button>
                </div>
              </div>
            )}
            {dups.length > 0 && (
              <p className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
                รูปนี้เคยบันทึกแล้ว — {dups.map((d) => `${shortDate(d.billDate)} ${baht(d.total)}${d.who ? ` โดย${d.who}` : ""}`).join(", ")} · ถ้าเป็นบิลเดียวกัน ไม่ต้องบันทึกซ้ำ
              </p>
            )}

            {/* ---- where and when ---- */}
            <label className="block space-y-1">
              <span className="block text-sm font-semibold">ซื้อที่</span>
              <input
                className="input w-full"
                list="self-purchase-suppliers"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="ผู้ขายประจำ หรือพิมพ์ชื่อร้าน เช่น ตลาด อ.ต.ก."
              />
              <datalist id="self-purchase-suppliers">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              {supplier && <span className="text-xs text-good">ผู้ขายในระบบ ✓</span>}
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="block text-sm font-semibold">สาขา</span>
                {branches.length > 1 ? (
                  <select className="input w-full" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="py-2 text-sm">{branches[0]?.name}</p>
                )}
              </div>
              <div className="space-y-1">
                <span className="block text-sm font-semibold">วันที่ซื้อ</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    [today, "วันนี้"],
                    [yesterday, "เมื่อวาน"],
                  ].map(([d, label]) => (
                    <button key={d} type="button" onClick={() => setBillDate(d)} className={`pill ${billDate === d ? "is-on" : ""}`}>
                      {label}
                    </button>
                  ))}
                  <input
                    type="date"
                    className="input h-9 w-auto py-0 text-sm"
                    max={today}
                    value={billDate}
                    onChange={(e) => e.target.value && setBillDate(e.target.value)}
                    aria-label="เลือกวัน"
                  />
                </div>
              </div>
            </div>

            {/* ---- what was bought ---- */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">ซื้ออะไร</p>
              {stock.map((l) => {
                const p = productById.get(l.productId);
                return (
                  <div key={l.key} className="space-y-2 rounded-xl border border-border bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-subtle">เข้าสต๊อก</span>
                      <button type="button" className="text-xs text-muted-foreground hover:text-bad" onClick={() => setStock((s) => s.filter((x) => x.key !== l.key))}>
                        ลบ
                      </button>
                    </div>
                    <ProductPicker
                      products={products}
                      value={l.productId}
                      onChange={(id) => {
                        const unit = productById.get(id)?.units[0]?.id ?? "";
                        setStock((s) => s.map((x) => (x.key === l.key ? { ...x, productId: id, unitId: unit } : x)));
                      }}
                      placeholder="พิมพ์ชื่อของ เช่น หมูสับ ผักบุ้ง"
                    />
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                      <input className="input w-full" inputMode="decimal" placeholder="จำนวน" value={l.qty} onChange={(e) => setStock((s) => s.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} />
                      {p && p.units.length > 1 ? (
                        <select className="input w-auto" value={l.unitId} onChange={(e) => setStock((s) => s.map((x) => (x.key === l.key ? { ...x, unitId: e.target.value } : x)))}>
                          {p.units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.unitName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm text-muted-foreground">{p?.units[0]?.unitName ?? ""}</span>
                      )}
                      <input className="input text-right" inputMode="decimal" placeholder="฿ ยอด" value={l.total} onChange={(e) => setStock((s) => s.map((x) => (x.key === l.key ? { ...x, total: e.target.value } : x)))} />
                    </div>
                  </div>
                );
              })}
              {others.map((l) => (
                <div key={l.key} className="space-y-2 rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-subtle">ไม่เข้าสต๊อก</span>
                    <button type="button" className="text-xs text-muted-foreground hover:text-bad" onClick={() => setOthers((s) => s.filter((x) => x.key !== l.key))}>
                      ลบ
                    </button>
                  </div>
                  <input className="input w-full" placeholder="ซื้ออะไร เช่น น้ำแข็ง แก๊ส ถุงพลาสติก" value={l.description} onChange={(e) => setOthers((s) => s.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)))} />
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                    <select className="input w-full" value={l.categoryId} onChange={(e) => setOthers((s) => s.map((x) => (x.key === l.key ? { ...x, categoryId: e.target.value } : x)))}>
                      <option value="">— หมวด —</option>
                      <optgroup label="ค่าใช้จ่ายร้าน">
                        {categories.filter((c) => c.opex).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="ต้นทุนอาหาร">
                        {categories.filter((c) => !c.opex).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <input className="input text-right" inputMode="decimal" placeholder="฿ ยอด" value={l.total} onChange={(e) => setOthers((s) => s.map((x) => (x.key === l.key ? { ...x, total: e.target.value } : x)))} />
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setStock((s) => [...s, { key: key(), productId: "", unitId: "", qty: "", total: "" }])}>
                  ＋ ของเข้าสต๊อก
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setOthers((s) => [...s, { key: key(), description: "", categoryId: "", total: "" }])}>
                  ＋ ของใช้ / อื่น ๆ
                </button>
              </div>
              {stock.length + others.length > 0 && (
                <p className="flex justify-between border-t border-border pt-2 font-semibold">
                  <span>รวม</span>
                  <span className="tabular-nums">{baht(total)}</span>
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              {(
                [
                  ["TRANSFER", "โอนจากบัญชีของฉัน", "แนบสลิปโอน → บัญชีคืนได้ทันที"],
                  ["CASH", "เงินสดของฉัน", "ไม่มีสลิป → ให้บัญชีรับรองก่อนคืน"],
                  ["SHOP", "เงินของร้าน", "เงินสดย่อย / บัตรร้าน — ไม่ต้องคืนใคร"],
                ] as const
              ).map(([k, title, sub]) => (
                <label key={k} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary">
                  <input type="radio" name="pay" className="mt-1 h-[18px] w-[18px] accent-primary" checked={pay === k} onChange={() => setPay(k)} />
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  </span>
                </label>
              ))}
            </div>

            {pay === "TRANSFER" && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">สลิปโอน</p>
                <div className="flex flex-wrap items-center gap-2">
                  {slips.map((id) => (
                    <PhotoThumb key={id} id={id} label="สลิป" />
                  ))}
                  <PhotoButton kind="PAYMENT_SLIP" label={slips.length ? "＋ อีกรูป" : "📷 แนบสลิป"} onUploaded={(r) => setSlips((s) => [...s, r.file.id])} onError={setError} />
                </div>
                {slips.length === 0 && <p className="text-xs text-muted-foreground">ยังไม่มีสลิปก็ส่งได้ — บิลจะขึ้น “ขาดสลิป” จนกว่าจะแนบ</p>}
              </div>
            )}
            {pay === "CASH" && (
              <label className="block space-y-1">
                <span className="block text-sm font-semibold">
                  ทำไมไม่มีสลิป <span className="font-normal text-muted-foreground">(ช่วยบัญชีตัดสินใจ)</span>
                </span>
                <input className="input w-full" value={noSlipReason} onChange={(e) => setNoSlipReason(e.target.value)} placeholder="เช่น แม่ค้าในตลาดรับเงินสดอย่างเดียว" />
              </label>
            )}

            <p className={`rounded-xl border p-3 text-sm ${pay === "CASH" ? "border-warn-border bg-warn-bg text-warn" : "border-border bg-surface-sunk text-muted-foreground"}`}>
              {pay === "TRANSFER"
                ? bills.length === 0
                  ? "ยังไม่มีรูปบิล — บัญชีจะคืนเงินได้เมื่อเพิ่มรูปบิลแล้ว"
                  : "มีรูปบิลและสลิปครบ = รอคืนเงินทันที"
                : pay === "CASH"
                  ? "บิลนี้จะ “รอบัญชีรับรอง” ก่อน แล้วค่อยเข้าคิวคืนเงิน"
                  : "บันทึกเป็นค่าใช้จ่ายของร้าน ไม่มีใครต้องได้เงินคืน"}
            </p>
            <p className="flex justify-between border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">
                {shortDate(billDate)} · {place} · {stock.length + others.length} รายการ
              </span>
              <span className="font-semibold tabular-nums">{baht(total)}</span>
            </p>
          </>
        )}
        {error && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</p>}
      </div>

      <div className="sticky bottom-0 mt-auto border-t border-border bg-surface px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        {step === 1 ? (
          <>
            {step1Problem && stock.length + others.length > 0 && <p className="mb-2 text-center text-xs text-muted-foreground">{step1Problem}</p>}
            <button type="button" className="btn h-12 w-full text-base" disabled={!!step1Problem} onClick={() => (setError(null), setStep(2))}>
              ถัดไป: จ่ายยังไง
            </button>
          </>
        ) : (
          <button type="button" className="btn h-12 w-full text-base" disabled={busy} onClick={submit}>
            {busy ? "กำลังบันทึก…" : pay === "SHOP" ? `บันทึก · ${baht(total)}` : `ส่งให้บัญชี · ${baht(total)}`}
          </button>
        )}
      </div>
    </Sheet>
  );
}
