"use client";

// นำเข้าวัตถุดิบจากไฟล์ (คิวงานข้อ 5, Kong 2026-10-30, mockup
// R3vZEuvaWr2gWQosAgYfkA round 3). Three steps on one page: the prompt for
// the shop's AI, the upload (or a pasted table), and the review. Every rule the
// review shows comes from src/lib/product-import.ts — the server's save judges
// with the same functions, so what turns red here is what it would refuse.

import Link from "next/link";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { orStale } from "@/lib/stale-tab";
import {
  FROM_METHOD_MARK,
  draftFromRaw,
  draftStatus,
  matchDrafts,
  toCreate,
  type CategoryOption,
  type DraftMatch,
  type DraftStatus,
  type ExistingProduct,
  type ImportDraft,
  type RawProductRow,
  type UnitTemplate,
} from "@/lib/product-import";
import { importProductsAction } from "../actions";

type Context = { existing: ExistingProduct[]; categories: CategoryOption[]; templates: UnitTemplate[] };
type Filter = "all" | "need" | "review" | "create" | "skip";

const DIMENSION_TH: Record<string, string> = { WEIGHT: "น้ำหนัก", VOLUME: "ปริมาตร", COUNT: "จำนวน" };

export default function ProductImport({ prompt }: { prompt: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [recipeMenus, setRecipeMenus] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: string[] } | null>(null);

  async function send(body: FormData, label: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/products/import", { method: "POST", body });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("เปิดข้อมูลไม่ได้ — กรุณารีเฟรชหน้าแล้วลองอีกครั้ง");
        return;
      }
      const data = (await res.json()) as
        | { ok: true; rows: RawProductRow[]; recipeMenus: number; context: Context }
        | { ok: false; formError: string };
      if (!data.ok) {
        setError(data.formError);
        return;
      }
      setCtx(data.context);
      setDrafts(data.rows.map((r) => draftFromRaw(r, data.context)));
      setRecipeMenus(data.recipeMenus);
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
    setDrafts([]);
    setSource(null);
    setDone(null);
    setError(null);
    setSaveError(null);
  }

  async function save(creates: ReturnType<typeof toCreate>[]) {
    setSaving(true);
    setSaveError(null);
    const res = await orStale(importProductsAction(creates));
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.formError);
      return;
    }
    setDone({ created: res.created, skipped: res.skipped });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (done) return <Done done={done} recipeMenus={recipeMenus} onAgain={reset} />;

  return (
    <div className="grid gap-4">
      {ctx === null ? (
        <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
          <PromptCard prompt={prompt} />
          <UploadCard busy={busy} error={error} onSend={send} />
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

      {ctx !== null && (
        <Review
          ctx={ctx}
          drafts={drafts}
          setDrafts={setDrafts}
          recipeMenus={recipeMenus}
          saving={saving}
          saveError={saveError}
          onSave={save}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Step 1 — the prompt
// ------------------------------------------------------------

function PromptCard({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  return (
    <section className="card grid content-start gap-3 !p-4 sm:!p-5">
      <span className="font-display text-[12.5px] font-semibold tracking-[0.08em] text-warn">ขั้น 1 · เตรียมไฟล์ด้วย AI ของร้าน</span>
      <p className="text-sm text-muted-foreground">คัดลอกคำสั่งนี้ไปใช้กับ AI ที่ร้านใช้ พร้อมแนบไฟล์ Excel, Word, PDF หรือรูปถ่ายสมุดสูตร</p>
      <pre
        ref={pre}
        className={`m-0 whitespace-pre-wrap rounded-xl border border-border bg-surface-sunk px-3.5 py-3 font-sans text-[13.5px] leading-relaxed ${
          open ? "max-h-[420px] overflow-auto" : "max-h-[150px] overflow-hidden [mask-image:linear-gradient(#000_55%,transparent)]"
        }`}
      >
        {prompt}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            navigator.clipboard.writeText(prompt).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2400);
              },
              () => {
                // The browser refused the clipboard: select the text instead.
                setOpen(true);
                const r = document.createRange();
                if (pre.current) r.selectNodeContents(pre.current);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
              }
            )
          }
        >
          คัดลอกคำสั่ง
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-sm underline decoration-dotted underline-offset-4 hover:text-warn">
          {open ? "ย่อคำสั่ง" : "ดูคำสั่งทั้งหมด"}
        </button>
        {copied && (
          <span role="status" className="text-[13px] text-good">
            คัดลอกแล้ว
          </span>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        ไม่ใช้ AI ก็ได้:{" "}
        <a href="/api/products/import?what=template" className="text-foreground underline decoration-dotted underline-offset-4 hover:text-warn">
          ดาวน์โหลดแม่แบบ Excel
        </a>{" "}
        แล้วกรอกเอง
      </p>
    </section>
  );
}

// ------------------------------------------------------------
// Step 2 — the file, or a pasted table
// ------------------------------------------------------------

function UploadCard({ busy, error, onSend }: { busy: boolean; error: string | null; onSend: (b: FormData, label: string) => void }) {
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const sendFile = (f: File | undefined) => {
    if (!f) return;
    const b = new FormData();
    b.set("file", f);
    onSend(b, f.name);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    sendFile(e.dataTransfer.files[0]);
  };

  return (
    <section className="card grid content-start gap-3 !p-4 sm:!p-5">
      <span className="font-display text-[12.5px] font-semibold tracking-[0.08em] text-warn">ขั้น 2 · อัปโหลดผลลัพธ์</span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`grid justify-items-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          over ? "border-warn bg-warn-bg" : "border-border-strong bg-surface-sunk"
        }`}
      >
        <b className="font-display font-semibold">{busy ? "กำลังอ่านไฟล์…" : "ลากไฟล์มาวางที่นี่"}</b>
        <span className="text-[13.5px] text-muted-foreground">หรือ</span>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn-secondary btn-sm">
          เลือกไฟล์
        </button>
        <span className="text-[13.5px] text-muted-foreground">Excel (.xlsx) หรือ CSV</span>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            sendFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => setPasting((v) => !v)}
        aria-expanded={pasting}
        className="justify-self-center text-sm underline decoration-dotted underline-offset-4 hover:text-warn"
      >
        ได้ผลลัพธ์เป็นตาราง? วางตารางแทน
      </button>
      {pasting && (
        <div className="grid gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            autoFocus
            aria-label="วางตารางจาก AI"
            placeholder="เลือกตารางที่ AI ตอบมา คัดลอก แล้ววางที่นี่ (Ctrl+V)"
            className="input min-h-[110px] resize-y font-sans"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || text.trim() === ""}
              onClick={() => {
                const b = new FormData();
                b.set("text", text);
                onSend(b, "ตารางที่วาง");
              }}
              className="btn btn-sm"
            >
              {busy ? "กำลังอ่าน…" : "อ่านตาราง"}
            </button>
            <span className="text-[13px] text-muted-foreground">ถ้าได้มาสองตาราง วางทั้งหมดได้เลย ระบบอ่านเฉพาะตารางวัตถุดิบ</span>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------
// Step 3 — review
// ------------------------------------------------------------

function Review({
  ctx,
  drafts,
  setDrafts,
  recipeMenus,
  saving,
  saveError,
  onSave,
}: {
  ctx: Context;
  drafts: ImportDraft[];
  setDrafts: (f: (d: ImportDraft[]) => ImportDraft[]) => void;
  recipeMenus: number;
  saving: boolean;
  saveError: string | null;
  onSave: (rows: ReturnType<typeof toCreate>[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const matches = useMemo(() => matchDrafts(drafts, ctx.existing), [drafts, ctx.existing]);
  const statuses = useMemo(() => drafts.map((d, i) => draftStatus(d, matches[i], ctx.templates)), [drafts, matches, ctx.templates]);

  const counts = useMemo(() => {
    const c = { create: 0, review: 0, need: 0, skip: 0, exists: 0 };
    for (const s of statuses) {
      if (s.kind === "CREATE") {
        c.create++;
        if (s.review) c.review++;
      } else if (s.kind === "NEED") c.need++;
      else if (s.why === "EXISTS" || s.why === "SAME_AS_SIMILAR") c.exists++;
      else c.skip++;
    }
    return c;
  }, [statuses]);

  const shown = drafts
    .map((d, i) => ({ d, m: matches[i], s: statuses[i], i }))
    .filter(({ s }) =>
      filter === "all"
        ? true
        : filter === "need"
          ? s.kind === "NEED"
          : filter === "review"
            ? s.kind === "CREATE" && s.review
            : filter === "create"
              ? s.kind === "CREATE"
              : s.kind === "SKIP"
    );

  const edit = (i: number, patch: Partial<ImportDraft>) => setDrafts((all) => all.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const creates = drafts.filter((_, i) => statuses[i].kind === "CREATE").map(toCreate);

  const FILTERS: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "ทั้งหมด", n: drafts.length },
    { key: "need", label: "ต้องแก้", n: counts.need },
    { key: "review", label: "ควรตรวจ", n: counts.review },
    { key: "create", label: "จะเพิ่ม", n: counts.create },
    { key: "skip", label: "ข้าม", n: counts.exists + counts.skip },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-sunk px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[12.5px] font-semibold tracking-[0.08em] text-warn">ขั้น 3 · ตรวจทาน</span>
          <div className="seg" role="group" aria-label="แสดงแถว">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`seg-item ${filter === f.key ? "is-on" : ""}`} disabled={f.n === 0 && f.key !== "all"}>
                {f.label} {f.n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip chip-good">ใหม่ {counts.create}</span>
          {counts.exists > 0 && <span className="chip">มีอยู่แล้ว {counts.exists}</span>}
          {counts.review > 0 && <span className="chip chip-warn">ควรตรวจ {counts.review}</span>}
          {counts.need > 0 && <span className="chip chip-bad">ต้องแก้ {counts.need}</span>}
        </div>
      </div>
      {recipeMenus > 0 && (
        <p className="border-b border-border px-4 py-2.5 text-[13px] text-muted-foreground">
          ไฟล์นี้มีแผ่นสูตร {recipeMenus.toLocaleString("th-TH")} เมนูด้วย — ตอนนี้นำเข้าเฉพาะวัตถุดิบ
        </p>
      )}

      <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_150px_180px_minmax(0,1.4fr)] gap-3 border-b border-border px-4 py-2 font-display text-[12.5px] font-semibold text-muted-foreground lg:grid">
        <span>ชื่อ</span>
        <span>ซื้อเป็น</span>
        <span>นับสต๊อกเป็น</span>
        <span>หมวด</span>
        <span>ผลการตรวจ</span>
      </div>
      <ol className="divide-y divide-border">
        {shown.map(({ d, m, s, i }) => (
          <ReviewRow key={d.line} d={d} m={m} s={s} ctx={ctx} onEdit={(p) => edit(i, p)} />
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">ไม่มีแถวในกลุ่มนี้</li>}
      </ol>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <p className="max-w-[620px] text-[13.5px] text-muted-foreground">
          {counts.need > 0 ? (
            <span className="font-medium text-bad">ยังมี {counts.need} แถวที่ต้องแก้หรือกดข้ามก่อนบันทึก · </span>
          ) : null}
          ของที่มีอยู่แล้วข้าม ไม่สร้างซ้ำ · วัตถุดิบเข้าระบบแบบยังไม่มีราคา ราคามาเองเมื่อรับของ ·{" "}
          <span className="text-warn">ข้อความสีเหลืองคือที่ AI แจ้งว่าไม่แน่ใจ</span>
        </p>
        <div className="grid justify-items-end gap-1">
          <button type="button" className="btn" disabled={saving || counts.need > 0 || creates.length === 0} onClick={() => onSave(creates)}>
            {saving ? "กำลังบันทึก…" : `เพิ่มวัตถุดิบ ${creates.length.toLocaleString("th-TH")} รายการ`}
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

function ReviewRow({
  d,
  m,
  s,
  ctx,
  onEdit,
}: {
  d: ImportDraft;
  m: DraftMatch;
  s: DraftStatus;
  ctx: Context;
  onEdit: (p: Partial<ImportDraft>) => void;
}) {
  const skipped = s.kind === "SKIP";
  const needUnit = s.kind === "NEED" && s.why === "UNIT";
  const needName = s.kind === "NEED" && s.why === "NAME";
  const needRatio = s.kind === "NEED" && s.why === "RATIO";
  const label = "text-[11.5px] font-semibold text-muted-foreground lg:hidden";
  const dims = [...new Set(ctx.templates.map((t) => t.unitDimension))];
  const cols = "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_150px_180px_minmax(0,1.4fr)]";

  // A row nothing will be written for has nothing to fix: one compact line.
  if (skipped) {
    const category = ctx.categories.find((c) => c.id === d.categoryId)?.label;
    return (
      <li className={`grid gap-x-3 gap-y-1.5 bg-surface-sunk/60 px-4 py-2.5 text-sm ${cols}`}>
        <div className="grid min-w-0 content-start gap-0.5">
          <span className="font-medium text-muted-foreground">{d.name.trim() || "(ไม่มีชื่อ)"}</span>
          {d.original !== "" && <span className="text-[12.5px] text-muted-subtle">“{d.original}” · แถว {d.line}</span>}
        </div>
        <span className="text-[13px] text-muted-subtle lg:col-span-3">
          {[d.buyUnit && `ซื้อเป็น ${d.buyUnit}`, d.baseUnit && `นับเป็น ${d.baseUnit}`, category].filter(Boolean).join(" · ")}
        </span>
        <div className="grid min-w-0 content-start justify-items-start gap-1.5">
          <Verdict d={d} m={m} s={s} onEdit={onEdit} />
        </div>
      </li>
    );
  }

  return (
    <li className={`grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3 text-sm lg:gap-3 ${cols} ${s.kind === "NEED" ? "border-l-[3px] border-l-bad" : ""}`}>
      <div className="col-span-2 grid min-w-0 content-start gap-1 max-lg:order-1 lg:col-span-1">
        <span className={label}>ชื่อ</span>
        <input
          value={d.name}
          onChange={(e) => onEdit({ name: e.target.value })}
          aria-label={`ชื่อ แถว ${d.line}`}
          placeholder="กรอกชื่อ"
          className={`input h-9 py-1 ${needName ? "border-bad" : ""}`}
        />
        {d.original !== "" && (
          <span className="text-[12.5px] text-muted-foreground">
            “{d.original}” <span className="text-muted-subtle">· แถว {d.line}</span>
          </span>
        )}
      </div>

      <div className="col-span-2 grid min-w-0 content-start gap-1 max-lg:order-3 lg:col-span-1">
        <span className={label}>ซื้อเป็น</span>
        <span>{d.buyUnit ?? "—"}</span>
        {d.extraUnit !== null && d.extraUnit !== d.baseUnit && (
          <label className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
            1 {d.extraUnit} =
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={d.extraRatio ?? ""}
              onChange={(e) => onEdit({ extraRatio: e.target.value === "" ? null : Number(e.target.value) })}
              aria-label={`1 ${d.extraUnit} เท่ากับกี่ ${d.baseUnit ?? "หน่วยนับ"}`}
              className={`input h-8 w-20 px-2 py-1 ${needRatio ? "border-bad" : ""}`}
            />
            {d.baseUnit ?? "…"}
          </label>
        )}
        {d.packUnreadable && <span className="text-[12.5px] text-warn">อ่านขนาดบรรจุไม่ได้</span>}
      </div>

      <div className="grid min-w-0 content-start gap-1 max-lg:order-4">
        <span className={label}>นับสต๊อกเป็น</span>
        <select
          value={d.baseUnit ?? ""}
          onChange={(e) => onEdit({ baseUnit: e.target.value === "" ? null : e.target.value })}
          aria-label={`หน่วยนับสต๊อก แถว ${d.line}`}
          className={`input h-9 py-1 ${needUnit ? "border-bad" : ""}`}
        >
          <option value="">เลือกหน่วย</option>
          {dims.map((dim) => (
            <optgroup key={dim} label={DIMENSION_TH[dim] ?? dim}>
              {ctx.templates
                .filter((t) => t.unitDimension === dim)
                .map((t) => (
                  <option key={t.unitName} value={t.unitName}>
                    {t.unitName}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="grid min-w-0 content-start gap-1 max-lg:order-5">
        <span className={label}>หมวด</span>
        <select
          value={d.categoryId ?? ""}
          onChange={(e) => onEdit({ categoryId: e.target.value === "" ? null : e.target.value, categoryText: "" })}
          aria-label={`หมวด แถว ${d.line}`}
          className="input h-9 py-1"
        >
          <option value="">ไม่ระบุหมวด</option>
          {ctx.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {d.categoryText !== "" && <span className="text-[12.5px] text-warn">AI เขียนว่า “{d.categoryText}” ซึ่งไม่ตรงกับหมวดของร้าน</span>}
      </div>

      <div className="col-span-2 flex min-w-0 flex-wrap content-start items-center gap-1.5 max-lg:order-2 lg:col-span-1 lg:grid lg:justify-items-start">
        <Verdict d={d} m={m} s={s} onEdit={onEdit} />
      </div>
    </li>
  );
}

function Verdict({ d, m, s, onEdit }: { d: ImportDraft; m: DraftMatch; s: DraftStatus; onEdit: (p: Partial<ImportDraft>) => void }) {
  const choice = (on: boolean) =>
    `rounded-lg border px-2.5 py-0.5 text-[12.5px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`;
  const skipBtn = (
    <button type="button" onClick={() => onEdit({ skip: !d.skip })} className="text-[12.5px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
      {d.skip ? "นำกลับมา" : "ข้ามแถวนี้"}
    </button>
  );
  // "พบในวิธีทำ" already has its own chip; show only what else the AI said.
  const doubt = d.unsure.replace(FROM_METHOD_MARK, "").replace(/^[\s,·;:–-]+|[\s,·;:–-]+$/g, "");
  const unsure = doubt !== "" && <span className="text-[12.5px] text-warn">AI: “{doubt}”</span>;

  if (d.skip) {
    return (
      <>
        <span className="chip">ข้ามแถวนี้</span>
        {skipBtn}
      </>
    );
  }
  if (m?.kind === "EXISTS") {
    return (
      <>
        <span className="chip">มีอยู่แล้ว · ข้าม</span>
        <span className="text-[12.5px] text-muted-foreground">
          {m.product.name} ({m.product.sku}) ไม่สร้างซ้ำ
        </span>
      </>
    );
  }
  if (m?.kind === "DUPLICATE") {
    return (
      <>
        <span className="chip">ชื่อซ้ำกับแถว {m.line} · ข้าม</span>
      </>
    );
  }
  return (
    <>
      {m?.kind === "SIMILAR" && (
        <>
          <span className="chip chip-warn">ชื่อใกล้ “{m.product.name}” ที่มีอยู่</span>
          <span className="flex flex-wrap gap-1.5">
            <button type="button" className={choice(d.sameAsSimilar)} onClick={() => onEdit({ sameAsSimilar: true })}>
              ใช่ตัวเดียวกัน · ข้าม
            </button>
            <button type="button" className={choice(!d.sameAsSimilar)} onClick={() => onEdit({ sameAsSimilar: false })}>
              ไม่ใช่ · สร้างใหม่
            </button>
          </span>
        </>
      )}
      {s.kind === "NEED" && (
        <span className="chip chip-bad whitespace-normal">
          {s.why === "NAME" ? "ต้องกรอกชื่อ" : s.why === "UNIT" ? (d.extraUnit !== null ? `“${d.extraUnit}” ไม่ใช่หน่วยมาตรฐาน · เลือกหน่วยนับ` : "ต้องเลือกหน่วยนับ") : "จำนวนต่อหน่วยต้องมากกว่า 0"}
        </span>
      )}
      {s.kind === "CREATE" && m?.kind !== "SIMILAR" && <span className={`chip ${s.review ? "chip-warn" : "chip-good"}`}>{s.review ? "ใหม่ · ควรตรวจ" : "ใหม่"}</span>}
      {d.fromMethod && <span className="chip chip-warn">พบในวิธีทำ</span>}
      {unsure}
      {s.kind !== "SKIP" && skipBtn}
    </>
  );
}

// ------------------------------------------------------------
// After the save
// ------------------------------------------------------------

function Done({ done, recipeMenus, onAgain }: { done: { created: number; skipped: string[] }; recipeMenus: number; onAgain: () => void }) {
  return (
    <section className="card grid gap-3">
      <h3 className="text-xl font-semibold">เพิ่มวัตถุดิบแล้ว {done.created.toLocaleString("th-TH")} รายการ</h3>
      {done.skipped.length > 0 && (
        <p className="text-sm text-muted-foreground">
          ข้าม {done.skipped.length} รายการที่มีชื่ออยู่แล้วตอนกดบันทึก: {done.skipped.slice(0, 8).join(", ")}
          {done.skipped.length > 8 ? ` และอีก ${done.skipped.length - 8} รายการ` : ""}
        </p>
      )}
      <ul className="grid gap-1 text-sm text-muted-foreground">
        <li>· ยังไม่มีราคา ราคาจะเข้ามาเองเมื่อรับของตามใบสั่งซื้อ</li>
        <li>· ผู้ขายเพิ่มได้ที่หน้าผู้ขาย แล้วค่อยผูกกับวัตถุดิบภายหลัง</li>
        {recipeMenus > 0 && <li>· ไฟล์นี้มีแผ่นสูตร {recipeMenus.toLocaleString("th-TH")} เมนูด้วย — ตอนนี้นำเข้าเฉพาะวัตถุดิบ</li>}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/products" className="btn">
          ดูรายการวัตถุดิบ
        </Link>
        <Link href="/dashboard" className="btn-secondary">
          ไปขั้นต่อไปของการตั้งร้าน
        </Link>
        <button type="button" onClick={onAgain} className="btn-secondary">
          นำเข้าไฟล์อื่น
        </button>
      </div>
    </section>
  );
}
