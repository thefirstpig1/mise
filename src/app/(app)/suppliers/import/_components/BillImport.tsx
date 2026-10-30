"use client";

// นำเข้าบิลซื้อย้อนหลัง (คิวงานข้อ 5c, Kong 2026-10-30, mockup
// YFU35adTUBXVQ6PPppFcHP round 2). The same three steps as the ingredient
// import; the review is grouped by bill. Every rule shown here comes from
// src/lib/bill-import.ts — the save judges with the same functions.

import Link from "next/link";
import { useMemo, useState } from "react";
import { orStale } from "@/lib/stale-tab";
import { PromptCard, UploadCard } from "@/components/import/ImportParts";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import {
  draftBills,
  isClean,
  judgeLine,
  linePrice,
  toBillSave,
  type BillContext,
  type BillDraft,
  type LineDraft,
  type LineFlag,
  type LineVerdict,
  type RawBillRow,
} from "@/lib/bill-import";
import { importBillsAction, type ImportBillsState } from "../actions";

type Filter = "all" | "need" | "review" | "ready" | "skip";
const baht = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
const thaiDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export default function BillImport({ prompt, productCount }: { prompt: string; productCount: number }) {
  const [bypass, setBypass] = useState(productCount > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [ctx, setCtx] = useState<BillContext | null>(null);
  const [bills, setBills] = useState<BillDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<ImportBillsState, { ok: true }> | null>(null);

  async function send(body: FormData, label: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/suppliers/import", { method: "POST", body });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("เปิดข้อมูลไม่ได้ — กรุณารีเฟรชหน้าแล้วลองอีกครั้ง");
        return;
      }
      const data = (await res.json()) as { ok: true; rows: RawBillRow[]; context: BillContext } | { ok: false; formError: string };
      if (!data.ok) {
        setError(data.formError);
        return;
      }
      setCtx(data.context);
      setBills(draftBills(data.rows, data.context));
      setSource(label);
      setDone(null);
      setSaveError(null);
    } catch {
      setError("เชื่อมต่อไม่ได้ — ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCtx(null);
    setBills([]);
    setSource(null);
    setDone(null);
    setError(null);
    setSaveError(null);
  }

  async function save() {
    if (!ctx) return;
    setSaving(true);
    setSaveError(null);
    const res = await orStale(importBillsAction(toBillSave(bills, ctx)));
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.formError);
      return;
    }
    setDone(res);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (done) return <Done done={done} onAgain={reset} />;

  if (!bypass) {
    // Kong 2026-10-30: setup goes in order — bills match against the ingredient list.
    return (
      <section className="card grid gap-3 border-warn-border bg-warn-bg/50">
        <h3 className="text-lg font-semibold">ยังไม่มีรายการวัตถุดิบ — แนะนำให้นำเข้าวัตถุดิบก่อน</h3>
        <p className="text-sm text-muted-foreground">
          บิลจะจับคู่กับวัตถุดิบของร้าน ถ้ายังไม่มีรายการ ทุกบรรทัดในบิลจะ “ไม่พบคู่” และต้องสร้างวัตถุดิบทีละบรรทัด · นำเข้าวัตถุดิบก่อน แล้วกลับมาที่หน้านี้ ระบบจะใส่รายการวัตถุดิบลงในคำสั่งให้ AI ช่วยจับคู่ด้วย
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/products/import" className="btn">
            นำเข้าวัตถุดิบก่อน
          </Link>
          <button type="button" className="btn-secondary" onClick={() => setBypass(true)}>
            นำเข้าบิลต่อเลย
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-4">
      {ctx === null ? (
        <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
          <PromptCard
            prompt={prompt}
            title="ขั้น 1 · ให้ AI ของร้านอ่านบิล"
            sub="คัดลอกคำสั่งนี้ไปใช้กับ AI ที่ร้านใช้ แล้วแนบรูปบิล ใบเสร็จ หรือไฟล์ PDF ได้หลายใบพร้อมกัน · คำสั่งมีรายการวัตถุดิบของร้านแนบไปด้วย ให้ AI ช่วยจับคู่"
            templateHref="/api/suppliers/import?what=template"
          />
          <UploadCard busy={busy} error={error} onSend={send} pasteHint="ระบบอ่านเฉพาะตารางบิลซื้อ" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
          <p className="text-sm">
            <span className="text-muted-foreground">อ่านจาก </span>
            <b className="font-semibold">{source}</b>
            <span className="text-muted-foreground"> · ยังไม่มีอะไรถูกบันทึก</span>
          </p>
          <button type="button" onClick={reset} className="btn-secondary btn-sm">
            เลือกไฟล์ใหม่
          </button>
        </div>
      )}
      {ctx !== null && <Review ctx={ctx} bills={bills} setBills={setBills} saving={saving} saveError={saveError} onSave={save} />}
    </div>
  );
}

// ------------------------------------------------------------
// Review
// ------------------------------------------------------------

const measureKey = (l: LineDraft) =>
  l.unit === null ? null : l.choice.kind === "PRODUCT" ? `p:${l.choice.id}|${l.unit}` : l.choice.kind === "NEW" ? `n:${l.choice.name.trim().toLowerCase()}|${l.unit}` : null;

function bucket(v: LineVerdict): Exclude<Filter, "all"> {
  if (v.kind === "SKIP") return "skip";
  if (v.kind === "NEED") return "need";
  return isClean(v) ? "ready" : "review";
}

function Review({
  ctx,
  bills,
  setBills,
  saving,
  saveError,
  onSave,
}: {
  ctx: BillContext;
  bills: BillDraft[];
  setBills: (f: (b: BillDraft[]) => BillDraft[]) => void;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const verdicts = useMemo(() => bills.map((b) => b.lines.map((l) => judgeLine(b, l, ctx))), [bills, ctx]);
  const counts = useMemo(() => {
    const c = { need: 0, review: 0, ready: 0, skip: 0 };
    for (const vs of verdicts) for (const v of vs) c[bucket(v)]++;
    return c;
  }, [verdicts]);
  const plan = useMemo(() => toBillSave(bills, ctx), [bills, ctx]);
  const newSuppliers = plan.suppliers.filter((s) => s.id === null).length;
  const pickerProducts: PickerProduct[] = useMemo(
    () =>
      ctx.products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        imageUrl: null,
        section: null,
        group: null,
        baseUnitName: p.units.find((u) => u.isBase)?.unitName ?? null,
      })),
    [ctx.products]
  );
  const pickerSuppliers: PickerProduct[] = useMemo(
    () => ctx.suppliers.map((s) => ({ id: s.id, name: s.name, sku: "", imageUrl: null, section: null, group: null, baseUnitName: null })),
    [ctx.suppliers]
  );

  const editBill = (bi: number, patch: Partial<BillDraft>) => setBills((all) => all.map((b, k) => (k === bi ? { ...b, ...patch } : b)));
  // A bag's size is asked ONCE: it fills every line of every bill that buys
  // that product by that unit.
  const editLine = (bi: number, li: number, patch: Partial<LineDraft>) =>
    setBills((all) => {
      const shareKey = "ratio" in patch ? measureKey(all[bi].lines[li]) : null;
      return all.map((b, k) => ({
        ...b,
        lines: b.lines.map((l, j) => (k === bi && j === li ? { ...l, ...patch } : shareKey !== null && measureKey(l) === shareKey ? { ...l, ratio: patch.ratio ?? null } : l)),
      }));
    });

  const FILTERS: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "ทั้งหมด", n: counts.need + counts.review + counts.ready + counts.skip },
    { key: "need", label: "ต้องแก้", n: counts.need },
    { key: "review", label: "ควรตรวจ", n: counts.review },
    { key: "ready", label: "พร้อม", n: counts.ready },
    { key: "skip", label: "ข้าม", n: counts.skip },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-sunk px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[12.5px] font-semibold tracking-[0.08em] text-warn">ขั้น 3 · ตรวจทาน</span>
          <span className="text-[13px] text-muted-foreground">{bills.length} บิล</span>
          <div className="seg" role="group" aria-label="แสดงบรรทัด">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`seg-item ${filter === f.key ? "is-on" : ""}`} disabled={f.n === 0 && f.key !== "all"}>
                {f.label} {f.n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip chip-good">ราคาใหม่ {counts.ready + counts.review}</span>
          {counts.review > 0 && <span className="chip chip-warn">ควรตรวจ {counts.review}</span>}
          {counts.need > 0 && <span className="chip chip-bad">ต้องแก้ {counts.need}</span>}
        </div>
      </div>

      {bills.map((b, bi) => {
        const rows = b.lines.map((l, li) => ({ l, li, v: verdicts[bi][li] })).filter(({ v }) => filter === "all" || bucket(v) === filter);
        if (rows.length === 0) return null;
        return (
          <BillBlock key={b.key} b={b} ctx={ctx} suppliers={pickerSuppliers} onEdit={(p) => editBill(bi, p)}>
            {rows.map(({ l, li, v }) => (
              <LineRow key={l.line} l={l} v={v} ctx={ctx} products={pickerProducts} onEdit={(p) => editLine(bi, li, p)} />
            ))}
          </BillBlock>
        );
      })}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <p className="max-w-[640px] text-[13.5px] text-muted-foreground">
          {counts.need > 0 && <span className="font-medium text-bad">ยังมี {counts.need} บรรทัดที่ต้องแก้หรือกดข้ามก่อนบันทึก · </span>}
          {newSuppliers > 0 ? `จะสร้างผู้ขาย ${newSuppliers} ราย · ` : ""}
          {plan.newProducts.length > 0 ? `วัตถุดิบใหม่ ${plan.newProducts.length} รายการ · ` : ""}
          บันทึกราคา {plan.prices.length} บรรทัด · <b className="font-medium text-foreground">ไม่มีอะไรลงสต๊อกหรือค่าใช้จ่าย</b>
        </p>
        <div className="grid justify-items-end gap-1">
          <button type="button" className="btn" disabled={saving || counts.need > 0 || plan.prices.length === 0} onClick={onSave}>
            {saving ? "กำลังบันทึก…" : "บันทึกราคาและผู้ขาย"}
          </button>
          {saveError && (
            <span role="alert" className="text-[13px] text-bad">
              {saveError}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function BillBlock({
  b,
  ctx,
  suppliers,
  onEdit,
  children,
}: {
  b: BillDraft;
  ctx: BillContext;
  suppliers: PickerProduct[];
  onEdit: (p: Partial<BillDraft>) => void;
  children: React.ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const chosen = b.supplier.kind === "EXISTING" ? ctx.suppliers.find((s) => s.id === (b.supplier as { id: string }).id) : null;
  const afterOpening = b.date !== null && ctx.openingDate !== null && b.date > ctx.openingDate;
  const future = b.date !== null && b.date > ctx.today;
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-surface-sunk/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="flex items-center gap-1.5">
            <span className="sr-only">วันที่ของบิล</span>
            <input
              type="date"
              value={b.date ?? ""}
              max={ctx.today}
              onChange={(e) => onEdit({ date: e.target.value === "" ? null : e.target.value, guessedYear: false })}
              className={`input h-9 w-[150px] py-1 font-display font-semibold ${b.date === null || future ? "border-bad" : ""}`}
            />
          </label>
          <span className="font-display font-semibold">{chosen ? chosen.name : b.supplier.kind === "NEW" ? b.supplier.name || "(ไม่มีชื่อผู้ขาย)" : ""}</span>
          {b.billNo !== "" && <span className="text-sm text-muted-foreground">· เลขที่ {b.billNo}</span>}
          {b.dateRaw !== "" && <span className="text-[12.5px] text-muted-subtle">บิลเขียน “{b.dateRaw}”</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {b.supplier.kind === "NEW" ? (
            <span className="chip chip-good">ผู้ขายใหม่ · สร้างให้</span>
          ) : b.supplierHow === "SIMILAR" ? (
            <span className="chip chip-warn">บิลเขียน “{b.supplierText}” · ใกล้ผู้ขายที่มี</span>
          ) : (
            <span className="chip">ตรงกับผู้ขายที่มี</span>
          )}
          {b.hasVat && <span className="chip">มี VAT แยก · ราคาในบิลเป็นก่อน VAT</span>}
          <button type="button" onClick={() => setPicking((v) => !v)} className="text-[12.5px] underline decoration-dotted underline-offset-4 hover:text-warn">
            {picking ? "เสร็จ" : "เปลี่ยนผู้ขาย"}
          </button>
        </div>
        {picking && (
          <div className="grid w-full gap-2 sm:grid-cols-2">
            <ProductPicker
              products={suppliers}
              thumbs={false}
              value={b.supplier.kind === "EXISTING" ? b.supplier.id : ""}
              onChange={(id) => onEdit(id === "" ? { supplier: { kind: "NEW", name: b.supplierText } } : { supplier: { kind: "EXISTING", id } })}
              placeholder="ค้นหาผู้ขายที่มีอยู่"
            />
            <label className="flex items-center gap-2 text-sm">
              <span className="shrink-0 text-muted-foreground">หรือผู้ขายใหม่ชื่อ</span>
              <input
                value={b.supplier.kind === "NEW" ? b.supplier.name : ""}
                placeholder={b.supplierText}
                onChange={(e) => onEdit({ supplier: { kind: "NEW", name: e.target.value } })}
                className="input h-9 py-1"
              />
            </label>
          </div>
        )}
      </div>
      {(b.date === null || future) && (
        <p className="border-t border-bad-border bg-bad-bg px-4 py-2 text-[13px] text-bad">
          {b.date === null ? "อ่านวันที่ของบิลไม่ได้ — ใส่วันที่ก่อนบันทึก" : "วันที่อยู่ในอนาคต — ตรวจวันที่ของบิล"}
        </p>
      )}
      {b.date !== null && !future && b.guessedYear && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-warn-border bg-warn-bg px-4 py-2 text-[13px] text-warn">
          บิลเขียนปีสองหลัก “{b.dateRaw}” ระบบอ่านเป็น {thaiDay(b.date)} — ถ้าไม่ใช่ แก้ที่ช่องวันที่
          <button type="button" onClick={() => onEdit({ guessedYear: false })} className="rounded-lg border border-warn-border bg-surface px-2.5 py-0.5 text-[12.5px] text-foreground hover:bg-muted">
            ปีถูกแล้ว
          </button>
        </p>
      )}
      {afterOpening && (
        <p className="border-t border-warn-border bg-warn-bg px-4 py-2 text-[13px] text-warn">
          บิลนี้ลงวันที่หลังวันนับเปิดระบบ ({thaiDay(ctx.openingDate!)}) — การนำเข้านี้เก็บแค่ราคา ไม่ลงสต๊อก ถ้ายังไม่ได้บันทึกรับของ ให้บันทึกที่หน้ารับสินค้า
        </p>
      )}
      <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_110px_110px_110px_minmax(0,1.5fr)] gap-3 border-t border-border px-4 py-2 font-display text-[12.5px] font-semibold text-muted-foreground lg:grid">
        <span>รายการในบิล</span>
        <span>วัตถุดิบในระบบ</span>
        <span className="text-right">จำนวน</span>
        <span className="text-right">ราคาต่อหน่วย</span>
        <span className="text-right">ยอดรวม</span>
        <span>ผลการตรวจ</span>
      </div>
      <ol className="divide-y divide-border border-t border-border">{children}</ol>
    </div>
  );
}

const HOW_TH = { REMEMBERED: "จำได้จากบิลก่อน", EXACT: "ชื่อตรงกัน", AI_AND_SIMILAR: "ชื่อใกล้ + AI แนะนำตรงกัน", AI: "AI แนะนำ", SIMILAR: "ชื่อใกล้" } as const;
const FLAG_TH: Partial<Record<LineFlag, string>> = {
  YEAR_GUESSED: "ตรวจปีของบิล",
  NO_UNIT: "บิลไม่ระบุหน่วย ใช้หน่วยนับ",
  PRICE_FROM_TOTAL: "คำนวณจากยอดรวม",
  FIGURES_DISAGREE: "ตัวเลขไม่ลงกัน",
  NEW_PRODUCT: "สร้างวัตถุดิบใหม่",
  AI_UNSURE: "AI ไม่แน่ใจ",
};
const NEED_TH = {
  DATE: "ต้องใส่วันที่ของบิล",
  FUTURE_DATE: "วันที่อยู่ในอนาคต",
  SUPPLIER: "ต้องใส่ชื่อผู้ขาย",
  NAME: "ต้องเลือกวัตถุดิบ",
  BASE_UNIT: "ต้องเลือกหน่วยนับ",
  RATIO: "ต้องบอกขนาดของหน่วย",
  PRICE: "บิลไม่มีราคา",
} as const;
const NOT_ITEM_TH = { VAT: "บรรทัด VAT", DISCOUNT: "ส่วนลด", SHIPPING: "ค่าส่ง", TOTAL: "ยอดรวม", ITEM: "" } as const;

function LineRow({
  l,
  v,
  ctx,
  products,
  onEdit,
}: {
  l: LineDraft;
  v: LineVerdict;
  ctx: BillContext;
  products: PickerProduct[];
  onEdit: (p: Partial<LineDraft>) => void;
}) {
  const label = "text-[11.5px] font-semibold text-muted-foreground lg:hidden";
  const cols = "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_110px_110px_110px_minmax(0,1.5fr)]";
  const choice = l.choice;
  const product = choice.kind === "PRODUCT" ? ctx.products.find((p) => p.id === choice.id) : null;
  const base = choice.kind === "NEW" ? choice.baseUnit : product?.units.find((u) => u.isBase)?.unitName ?? null;
  const p = linePrice(l);
  const agree = l.qty !== null && l.unitPrice !== null && l.total !== null && !p.disagree;

  // A line that is not an item (VAT, a discount) has nothing to decide.
  if (l.kind !== "ITEM") {
    return (
      <li className={`grid gap-x-3 gap-y-1 bg-surface-sunk/40 px-4 py-2 text-sm ${cols}`}>
        <span className="text-muted-foreground lg:col-span-4">
          {l.item} {l.original !== "" && <span className="text-[12.5px] text-muted-subtle">“{l.original}”</span>}
        </span>
        <span className="text-muted-foreground lg:text-right">{l.total !== null ? baht(l.total) : "—"}</span>
        <span>
          <span className="chip">{NOT_ITEM_TH[l.kind]} · ไม่ใช่สินค้า</span>
        </span>
      </li>
    );
  }

  return (
    <li className={`grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3 text-sm lg:gap-3 ${cols} ${v.kind === "NEED" ? "border-l-[3px] border-l-bad" : ""} ${v.kind === "SKIP" ? "bg-surface-sunk/40" : ""}`}>
      <div className="col-span-2 grid min-w-0 content-start gap-0.5 max-lg:order-1 lg:col-span-1">
        <span className="font-medium">{l.item || "(ไม่มีชื่อรายการ)"}</span>
        {l.original !== "" && <span className="text-[12.5px] text-muted-foreground">“{l.original}”</span>}
      </div>

      <div className="col-span-2 grid min-w-0 content-start gap-1.5 max-lg:order-3 lg:col-span-1">
        <span className={label}>วัตถุดิบในระบบ</span>
        {choice.kind === "NEW" ? (
          <div className="grid gap-1.5">
            <input value={choice.name} onChange={(e) => onEdit({ choice: { ...choice, name: e.target.value } })} aria-label="ชื่อวัตถุดิบใหม่" className="input h-9 py-1" />
            <select
              value={choice.baseUnit ?? ""}
              onChange={(e) => onEdit({ choice: { ...choice, baseUnit: e.target.value === "" ? null : e.target.value } })}
              aria-label="หน่วยนับของวัตถุดิบใหม่"
              className={`input h-9 py-1 ${v.kind === "NEED" && v.why === "BASE_UNIT" ? "border-bad" : ""}`}
            >
              <option value="">นับสต๊อกเป็น…</option>
              {ctx.templates.map((t) => (
                <option key={t.unitName} value={t.unitName}>
                  {t.unitName}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => onEdit({ choice: l.proposal ? { kind: "PRODUCT", id: l.proposal.productId } : { kind: "SKIP" } })} className="justify-self-start text-[12.5px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
              ยกเลิกการสร้างใหม่
            </button>
          </div>
        ) : (
          <>
            <ProductPicker
              products={products}
              thumbs={false}
              value={choice.kind === "PRODUCT" ? choice.id : ""}
              onChange={(id) => onEdit({ choice: id === "" ? { kind: "SKIP" } : { kind: "PRODUCT", id } })}
              placeholder="ค้นหาวัตถุดิบ…"
              footer={{
                label: `สร้างเป็นวัตถุดิบใหม่ “${l.item}”`,
                onClick: () => onEdit({ choice: { kind: "NEW", name: l.item, baseUnit: l.unit !== null && ctx.templates.some((t) => t.unitName === l.unit) ? l.unit : null } }),
              }}
            />
            {product && l.proposal?.productId === product.id && <span className="text-[12.5px] text-muted-foreground">{HOW_TH[l.proposal.how]}</span>}
            {l.aiUnknown !== "" && <span className="text-[12.5px] text-warn">AI แนะนำ “{l.aiUnknown}” แต่ร้านไม่มีชื่อนี้</span>}
          </>
        )}
      </div>

      <div className="grid content-start gap-1 max-lg:order-4 lg:justify-items-end lg:text-right">
        <span className={label}>จำนวน</span>
        <span className="tabular-nums">
          {l.qty !== null ? l.qty.toLocaleString("th-TH", { maximumFractionDigits: 3 }) : "—"} {l.unit ?? ""}
        </span>
      </div>

      <div className="grid content-start gap-1 max-lg:order-5 lg:justify-items-end lg:text-right">
        <span className={label}>ราคาต่อหน่วย</span>
        {v.kind === "NEED" && v.why === "PRICE" ? (
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={l.priceEdit ?? ""}
            onChange={(e) => onEdit({ priceEdit: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="ราคา"
            aria-label="ราคาต่อหน่วย"
            className="input h-8 w-24 border-bad px-2 py-1"
          />
        ) : (
          <span className="tabular-nums">{p.price !== null ? baht(p.price) : "—"}</span>
        )}
      </div>

      <div className="col-span-2 grid content-start gap-1 max-lg:order-6 lg:col-span-1 lg:justify-items-end lg:text-right">
        <span className={label}>ยอดรวม</span>
        <span className={`tabular-nums ${agree ? "text-good" : ""}`}>
          {l.total !== null ? baht(l.total) : "—"}
          {agree ? " ✓" : ""}
        </span>
      </div>

      <div className="col-span-2 flex min-w-0 flex-wrap content-start items-center gap-1.5 max-lg:order-2 lg:col-span-1 lg:grid lg:justify-items-start">
        <LineVerdictView l={l} v={v} base={base} onEdit={onEdit} />
      </div>
    </li>
  );
}

/**
 * The size box sits AFTER the verdict, in one place for both states: inside the
 * "ต้องบอกขนาด" state it vanished on the first digit (the line turned ready), so
 * "1 แพ็ค = 12 ฟอง" could only ever be typed as 1.
 */
function LineVerdictView({ l, v, base, onEdit }: { l: LineDraft; v: LineVerdict; base: string | null; onEdit: (p: Partial<LineDraft>) => void }) {
  const askRatio = (v.kind === "NEED" && v.why === "RATIO") || (v.kind === "PRICE" && v.unitIsNew && !v.flags.includes("UNIT_CONVERTED"));
  return (
    <>
      <LineVerdictBody l={l} v={v} onEdit={onEdit} />
      {askRatio && (
        <label className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
          1 {l.unit} =
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={l.ratio ?? ""}
            onChange={(e) => onEdit({ ratio: e.target.value === "" ? null : Number(e.target.value) })}
            aria-label={`1 ${l.unit} เท่ากับกี่ ${base ?? "หน่วยนับ"}`}
            className={`input h-8 w-20 px-2 py-1 ${v.kind === "NEED" ? "border-bad" : ""}`}
          />
          {base} · จำไว้เป็นหน่วยของวัตถุดิบนี้
        </label>
      )}
    </>
  );
}

function LineVerdictBody({ l, v, onEdit }: { l: LineDraft; v: LineVerdict; onEdit: (p: Partial<LineDraft>) => void }) {
  const choice = (on: boolean) =>
    `rounded-lg border px-2.5 py-0.5 text-[12.5px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`;
  const skipBtn = (
    <button type="button" onClick={() => onEdit({ choice: { kind: "SKIP" } })} className="text-[12.5px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
      ข้ามบรรทัดนี้
    </button>
  );
  if (v.kind === "SKIP") {
    return v.why === "NO_MATCH" ? (
      <>
        <span className="chip">ไม่พบคู่ · ข้าม</span>
        <span className="text-[12.5px] text-muted-foreground">เลือกวัตถุดิบหรือสร้างใหม่ได้ที่ช่องค้นหา</span>
      </>
    ) : (
      <>
        <span className="chip">ข้าม</span>
        {l.proposal && (
          <button type="button" onClick={() => onEdit({ choice: { kind: "PRODUCT", id: l.proposal!.productId } })} className="text-[12.5px] underline decoration-dotted underline-offset-4 hover:text-warn">
            นำกลับมา
          </button>
        )}
      </>
    );
  }
  if (v.kind === "NEED") {
    return (
      <>
        <span className="chip chip-bad whitespace-normal">{NEED_TH[v.why]}</span>
        {skipBtn}
      </>
    );
  }
  const derived = l.total !== null && l.qty !== null && l.qty > 0 ? l.total / l.qty : null;
  const labels = v.flags.map((f) => FLAG_TH[f]).filter(Boolean);
  const how = v.flags.includes("MATCH_TO_CHECK") && l.proposal && l.choice.kind === "PRODUCT" && l.choice.id === l.proposal.productId ? HOW_TH[l.proposal.how] : v.flags.includes("MATCH_TO_CHECK") ? "เลือกเอง" : null;
  const clean = isClean(v);
  return (
    <>
      <span className={`chip ${clean ? "chip-good" : "chip-warn"} whitespace-normal`}>{clean ? "ราคาใหม่" : [how, ...labels].filter(Boolean).join(" · ") || "ควรตรวจ"}</span>
      <span className="text-[12.5px] text-muted-foreground">
        {baht(v.unitPrice)} /{v.unitName}
        {v.unitIsNew && v.ratio !== null && v.flags.includes("UNIT_CONVERTED") ? ` · เพิ่มหน่วย ${v.unitName} = ${v.ratio.toLocaleString("th-TH", { maximumFractionDigits: 4 })}` : ""}
      </span>
      {v.flags.includes("FIGURES_DISAGREE") && l.qty !== null && l.unitPrice !== null && derived !== null && (
        <>
          <span className="text-[12.5px] text-warn">
            {l.qty} × {l.unitPrice} = {(l.qty * l.unitPrice).toLocaleString("th-TH", { maximumFractionDigits: 2 })} ไม่ใช่ {l.total} — เทียบกับบิลจริง
          </span>
          <span className="flex flex-wrap gap-1.5">
            <button type="button" className={choice(l.trust === "UNIT")} onClick={() => onEdit({ trust: "UNIT" })}>
              ใช้ {baht(l.unitPrice)}
            </button>
            <button type="button" className={choice(l.trust === "TOTAL")} onClick={() => onEdit({ trust: "TOTAL" })}>
              ใช้ยอดรวม ÷ จำนวน = {baht(derived)}
            </button>
          </span>
        </>
      )}
      {l.unsure.trim() !== "" && <span className="text-[12.5px] text-warn">AI: “{l.unsure}”</span>}
      {skipBtn}
    </>
  );
}

// ------------------------------------------------------------
// After the save
// ------------------------------------------------------------

function Done({ done, onAgain }: { done: Extract<ImportBillsState, { ok: true }>; onAgain: () => void }) {
  return (
    <section className="card grid gap-3">
      <h3 className="text-xl font-semibold">บันทึกราคาแล้ว {done.pricesWritten.toLocaleString("th-TH")} รายการ</h3>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        {done.suppliersCreated > 0 && <li>· สร้างผู้ขายใหม่ {done.suppliersCreated} ราย (มีแค่ชื่อ เติมเบอร์โทรหรือ LINE ได้ที่หน้าผู้ขาย)</li>}
        {done.productsCreated > 0 && <li>· สร้างวัตถุดิบใหม่ {done.productsCreated} รายการ</li>}
        {done.unitsAdded > 0 && <li>· เพิ่มหน่วยให้วัตถุดิบ {done.unitsAdded} หน่วย</li>}
        {done.skippedOlder > 0 && <li>· ข้ามราคาเก่า {done.skippedOlder} รายการ เพราะร้านมีราคาที่ใหม่กว่าอยู่แล้ว</li>}
        <li>· ระบบจำชื่อที่ผู้ขายใช้ไว้แล้ว บิลถัดไปจากเจ้าเดิมจะจับคู่ได้เอง</li>
        <li>· ไม่มีอะไรลงสต๊อกหรือค่าใช้จ่าย · ตอนนับเปิดระบบ ระบบจะเติมราคาเหล่านี้ให้</li>
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/suppliers" className="btn">
          ดูผู้ขาย
        </Link>
        <Link href="/dashboard" className="btn-secondary">
          ไปขั้นต่อไปของการตั้งร้าน
        </Link>
        <button type="button" onClick={onAgain} className="btn-secondary">
          นำเข้าบิลชุดอื่น
        </button>
      </div>
    </section>
  );
}
