"use client";

// ============================================================
// ส่งออกไฟล์ปิดเดือน — choose the accounting program, get its file
// (Kong 2026-10-29: "เลือกได้ว่าจะให้มันformatไปโปรแกรมไหน")
// ============================================================
// The preview is built by the same functions the download route writes
// (src/lib/accounting-formats.ts), so the cells shown are the cells sent.
// A program that READS the file needs account codes; until they are there
// the button says what is missing instead of producing a file the program
// would import with blank accounts. Rendered through a portal: the page
// frame animates in with a transform, and `fixed` inside it is fixed to
// the frame (mise-ui-review §7).
// ============================================================

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { orStale } from "@/lib/stale-tab";
import Seg from "@/components/ui/Seg";
import { PROGRAMS, fileNameFor, journalSheet, programOf, type Cell } from "@/lib/accounting-formats";
import { missingCodes } from "@/lib/accounting-codes";
import { accountsUsed, buildMonthEndJournal, type AccountKey, type JournalMode, type JournalScope } from "@/lib/month-end-journal";
import { journalFigures, monthTitleTh, readinessOf, type MonthEndView } from "@/lib/month-end-view";
import { DEFAULT_ACCOUNT_NAMES, type AccountingExportSettings, type AccountingProgram } from "@/lib/validations/accounting-export";
import { saveAccountingExportAction } from "../actions";

const COLS = "ABCDEFGHIJKLMNOP";
const cellText = (c: Cell) =>
  c === null ? "" : typeof c === "number" && !Number.isInteger(c) ? c.toLocaleString("th-TH", { minimumFractionDigits: 2 }) : String(c);

const ACCOUNT_ORDER: AccountKey[] = ["inventory", "purchases", "cogs", "shrinkage", "interBranch"];

export default function ExportDialog({
  view,
  settings,
  onSettingsSaved,
  canEditSettings,
  mode,
  split,
  scope,
  onScope,
  onClose,
}: {
  view: MonthEndView;
  settings: AccountingExportSettings;
  onSettingsSaved: (s: AccountingExportSettings) => void;
  canEditSettings: boolean;
  mode: JournalMode;
  split: boolean;
  scope: JournalScope;
  onScope: (s: JournalScope) => void;
  onClose: () => void;
}) {
  const [program, setProgram] = useState<AccountingProgram>(settings.program);
  const [include, setInclude] = useState({ stock: true, branches: view.branches.length > 1, bills: false });
  const [remember, setRemember] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings.accounts);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const spec = programOf(program);
  const journal = useMemo(
    () => buildMonthEndJournal({ branches: journalFigures(view), mode, split, scope, accounts: settings.accounts }),
    [view, mode, split, scope, settings.accounts]
  );
  const sheet = useMemo(() => journalSheet(program, view, journal), [program, view, journal]);
  const missing = missingCodes(spec, journal);
  const used = accountsUsed(journal);
  const warnings = readinessOf(view).filter((n) => n.tone === "warn").length;
  const name = fileNameFor(program, view.month);
  const multi = view.branches.length > 1;

  const href =
    `/api/month-end/export?month=${view.month}&program=${program}&mode=${mode}&split=${split ? 1 : 0}&scope=${scope}` +
    `&stock=${include.stock ? 1 : 0}&branches=${include.branches ? 1 : 0}&bills=${include.bills ? 1 : 0}`;

  const saveCodes = () => {
    setSaveError(null);
    startSave(async () => {
      const res = await orStale(saveAccountingExportAction({ ...settings, accounts: draft }));
      if (res.ok) {
        onSettingsSaved(res.settings);
        setDraft(res.settings.accounts);
        setEditing(false);
      } else setSaveError(res.formError);
    });
  };

  const onDownload = () => {
    const changed = program !== settings.program || mode !== settings.mode || split !== settings.split || scope !== settings.scope;
    if (canEditSettings && remember && changed) {
      const next = { ...settings, program, mode, split, scope };
      void orStale(saveAccountingExportAction(next)).then((res) => res.ok && onSettingsSaved(res.settings));
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="me-export-title"
    >
      <div className="relative my-auto grid w-full max-w-5xl animate-pop-in grid-cols-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="me-export-title" className="font-display text-lg font-semibold">
              ส่งออกไฟล์ปิดเดือน {monthTitleTh(view.month)}
            </h2>
            <p className="text-sm text-muted-foreground">เลือกโปรแกรมบัญชีที่ร้านใช้ ระบบจะจัดไฟล์ให้ตรงกับรูปแบบของโปรแกรมนั้น</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground">
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
          {/* the program */}
          <div className="grid grid-cols-2 content-start gap-2 border-b border-border bg-background p-4 md:grid-cols-1 md:border-b-0 md:border-r">
            <p className="col-span-full text-xs font-medium text-muted-subtle">โปรแกรมบัญชีของร้าน</p>
            {PROGRAMS.map((p) => {
              const on = p.id === program;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setProgram(p.id)}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    on ? "border-primary bg-surface shadow-[inset_0_0_0_1.5px_theme(colors.primary.DEFAULT)]" : "border-border bg-surface hover:border-border-strong"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`hidden h-8 w-8 shrink-0 place-items-center rounded-lg font-display text-xs font-semibold sm:grid ${
                      on ? "bg-primary text-primary-foreground" : "border border-border bg-surface-sunk text-primary"
                    }`}
                  >
                    {p.mono}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-sm font-medium">{p.label}</span>
                    <span className={`block text-[11px] ${p.kind === "import" ? "text-good" : "text-muted-subtle"}`}>
                      {p.kind === "import" ? "● " : "○ "}
                      {p.howLabel}
                    </span>
                  </span>
                </button>
              );
            })}
            {canEditSettings && (
              <label className="col-span-full mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                จำไว้สำหรับเดือนหน้า
              </label>
            )}
          </div>

          {/* the file */}
          <div className="grid min-w-0 grid-cols-1 content-start gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-sunk px-3.5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative grid h-11 w-9 shrink-0 place-items-end justify-center rounded-md border border-border-strong bg-surface pb-1 font-display text-[9.5px] font-semibold text-primary">
                  {spec.ext.toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="break-all font-display text-sm font-medium">{name.thai}</p>
                  <p className="text-xs text-muted-foreground">{spec.what}</p>
                </div>
              </div>
              <span className={`chip ${spec.kind === "import" ? "chip-good" : ""}`}>{spec.howLabel}</span>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-subtle">หน้าตาในไฟล์</p>
              <div className="overflow-x-auto rounded-lg border border-border-strong">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-surface-sunk text-muted-subtle">
                      <th className="w-7 border-b border-r border-border px-1.5 py-0.5 font-display font-medium" />
                      {sheet.columns.map((_, i) => (
                        <th key={i} className="border-b border-r border-border px-2 py-0.5 text-center font-display font-medium">
                          {COLS[i]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-primary-soft font-semibold">
                      <td className="border-b border-r border-border bg-surface-sunk px-1.5 text-center font-display text-muted-subtle">1</td>
                      {sheet.columns.map((c, i) => (
                        <td key={i} className="whitespace-nowrap border-b border-r border-border px-2 py-1">
                          {c.header}
                        </td>
                      ))}
                    </tr>
                    {sheet.rows.slice(0, 8).map((r, ri) => (
                      <tr key={ri}>
                        <td className="border-b border-r border-border bg-surface-sunk px-1.5 text-center font-display text-muted-subtle">{ri + 2}</td>
                        {r.map((c, ci) => (
                          <td key={ci} className={`whitespace-nowrap border-b border-r border-border px-2 py-1 ${typeof c === "number" ? "text-right font-display tabular-nums" : ""}`}>
                            {cellText(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sheet.rows.length > 8 && <p className="text-[11px] text-muted-subtle">และอีก {sheet.rows.length - 8} แถวในไฟล์</p>}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-subtle">{spec.kind === "import" ? `วิธีนำเข้าใน ${spec.label}` : spec.kind === "key" ? `วิธีลงใน ${spec.label}` : "ใช้ไฟล์นี้อย่างไร"}</p>
              <ol className="space-y-1.5">
                {spec.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border-strong font-display text-[11px] text-muted-foreground">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
              {spec.note && <p className="rounded-lg border border-warn-border bg-warn-bg px-3 py-2 text-xs text-warn">{spec.note}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {spec.ext === "xlsx" ? (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1.5 text-xs font-medium text-muted-subtle">ใส่อะไรไปบ้าง</legend>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked disabled /> รายการปรับปรุงสิ้นเดือน
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={include.stock} onChange={(e) => setInclude({ ...include, stock: e.target.checked })} /> สต๊อกสิ้นเดือนรายสินค้า ({view.stock.length} รายการ)
                  </label>
                  {multi && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={include.branches} onChange={(e) => setInclude({ ...include, branches: e.target.checked })} /> ตารางแยกสาขา
                    </label>
                  )}
                  {view.billCount > 0 && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={include.bills} onChange={(e) => setInclude({ ...include, bills: e.target.checked })} /> บิลซื้อและค่าใช้จ่ายของเดือน ({view.billCount} ใบ)
                    </label>
                  )}
                </fieldset>
              ) : (
                <p className="text-xs text-muted-subtle">ไฟล์ CSV มีได้ตารางเดียว — ไฟล์นี้จึงมีแค่รายการปรับปรุง</p>
              )}
              {multi && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-subtle">ลงบัญชีแบบ</p>
                  <Seg
                    label="รวมหรือแยกสาขา"
                    value={scope}
                    onChange={onScope}
                    items={[
                      ["company", "รวมทั้งร้าน"],
                      ["branch", "แยกสาขา"],
                    ]}
                  />
                  <p className="text-[11px] text-muted-subtle">แยกสาขาใช้บัญชีพักระหว่างสาขา เพราะของที่โอนกันต้องหักล้างกัน</p>
                </div>
              )}
            </div>

            {/* the shop's account codes */}
            <div className={`space-y-2 rounded-xl border p-3.5 ${missing.length ? "border-warn-border bg-warn-bg/60" : "border-border"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">รหัสบัญชีของร้าน</p>
                {canEditSettings && !editing && (
                  <button type="button" onClick={() => setEditing(true)} className="text-xs text-primary underline-offset-2 hover:underline">
                    {used.some((a) => settings.accounts[a].code) ? "แก้" : "ใส่รหัส"}
                  </button>
                )}
              </div>
              {missing.length > 0 && (
                <p className="text-xs text-warn">
                  {spec.label} ต้องมีรหัสบัญชีก่อนนำเข้า: {missing.map((a) => settings.accounts[a].name).join(", ")}
                  {spec.codeHint ? ` · ${spec.codeHint}` : ""}
                  {!canEditSettings && " — ให้ผู้ที่ตั้งค่าร้านได้ใส่รหัสให้ก่อน"}
                </p>
              )}
              {editing ? (
                <div className="space-y-2">
                  {ACCOUNT_ORDER.filter((a) => used.includes(a) || a === "shrinkage" || (a === "interBranch" && multi)).map((a) => (
                    <div key={a} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
                      <input
                        className="input h-9 px-2 font-display text-sm"
                        value={draft[a].code}
                        placeholder="รหัส"
                        aria-label={`รหัสบัญชี ${draft[a].name}`}
                        onChange={(e) => setDraft({ ...draft, [a]: { ...draft[a], code: e.target.value } })}
                      />
                      <input
                        className="input h-9 px-2 text-sm"
                        value={draft[a].name}
                        placeholder={DEFAULT_ACCOUNT_NAMES[a]}
                        aria-label={`ชื่อบัญชี ${DEFAULT_ACCOUNT_NAMES[a]}`}
                        onChange={(e) => setDraft({ ...draft, [a]: { ...draft[a], name: e.target.value } })}
                      />
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-subtle">
                    เอารหัสและชื่อจากผังบัญชีในโปรแกรมบัญชีของร้าน ให้นักบัญชีช่วยดูได้ — ตั้งครั้งเดียวใช้ทุกเดือน
                  </p>
                  {saveError && <p className="text-xs text-bad">{saveError}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={saveCodes} disabled={saving} className="btn btn-sm">
                      {saving ? "กำลังบันทึก…" : "บันทึกรหัสบัญชี"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(settings.accounts);
                        setEditing(false);
                      }}
                      className="btn-secondary btn-sm"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-sm">
                  {used.map((a) => (
                    <div key={a} className="contents">
                      <dt className="font-display">
                        <span className="rounded-md border border-border bg-surface-sunk px-1.5 text-[13px]">{settings.accounts[a].code || "—"}</span>
                      </dt>
                      <dd className="text-muted-foreground">{settings.accounts[a].name}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-5 py-3.5">
          <span className="text-xs text-muted-subtle">
            {warnings > 0 ? `มีข้อควรรู้ ${warnings} เรื่อง — ${spec.ext === "xlsx" ? "ใส่เป็นหมายเหตุในไฟล์ให้แล้ว" : "ดูได้ที่หัวข้อ “ก่อนส่ง”"}` : "ไม่มีข้อควรรู้"}
          </span>
          {missing.length > 0 ? (
            <button type="button" disabled className="btn">
              ใส่รหัสบัญชีก่อนดาวน์โหลด
            </button>
          ) : (
            <a href={href} download={name.thai} onClick={onDownload} className="btn">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              ดาวน์โหลด .{spec.ext}
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
