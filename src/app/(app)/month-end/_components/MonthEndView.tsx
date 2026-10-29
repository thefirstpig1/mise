"use client";

// ============================================================
// ปิดเดือน · ส่งให้บัญชี — the page body (Kong 2026-10-29)
// ============================================================
// Answers, in order, what an accountant asks at the end of a month:
//   1. can I trust these figures yet        → ก่อนส่ง ตรวจ…
//   2–3. what is the stock worth, what did the food cost and where from
//                                            → the equation, which ties
//   4. how much of that cost was loss       → the parts under it
//   5. give me the file                     → the journal + ส่งออกไฟล์
// The journal preview and the file are built by the same function
// (src/lib/month-end-journal.ts), so what is shown is what downloads.
// ============================================================

import { use, useMemo, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import Seg from "@/components/ui/Seg";
import { buildMonthEndJournal, fromSatang, sumFigures, type JournalMode, type JournalScope } from "@/lib/month-end-journal";
import {
  dayLabelTh,
  journalFigures,
  monthTitleTh,
  readinessOf,
  shrinkageOf,
  type MonthEndBranchView,
  type MonthEndView as View,
} from "@/lib/month-end-view";
import type { AccountingExportSettings } from "@/lib/validations/accounting-export";
import ExportDialog from "./ExportDialog";

const fmt = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const baht = (n: number) => `${n < 0 ? "−" : ""}฿${fmt(Math.abs(n))}`;
const signed = (n: number) => (n < 0 ? `−${fmt(-n)}` : fmt(n));
const cents = (n: number) => Math.round(n * 100);

export function MonthEndSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="กำลังคำนวณสต๊อกและต้นทุน">
      <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface-sunk" />
      <div className="h-56 animate-pulse rounded-2xl border border-border bg-surface-sunk" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-2xl border border-border bg-surface-sunk" />
        <div className="h-72 animate-pulse rounded-2xl border border-border bg-surface-sunk" />
      </div>
      <p className="text-center text-sm text-muted-subtle">กำลังคำนวณสต๊อกและต้นทุนของเดือน…</p>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export default function MonthEndView({
  data,
  settings: settingsPromise,
  canEditSettings,
}: {
  data: Promise<View | null>;
  settings: Promise<AccountingExportSettings>;
  canEditSettings: boolean;
}) {
  const v = use(data);
  const saved = use(settingsPromise);
  const [settings, setSettings] = useState(saved);
  const [mode, setMode] = useState<JournalMode>(saved.mode);
  const [split, setSplit] = useState(saved.split);
  const [scope, setScope] = useState<JournalScope>(saved.scope);
  const [exporting, setExporting] = useState(false);

  const journal = useMemo(
    () =>
      v
        ? buildMonthEndJournal({
            branches: journalFigures(v),
            mode,
            split: split && v.recipeMethod,
            scope: v.branches.length > 1 ? scope : "company",
            accounts: settings.accounts,
          })
        : null,
    [v, mode, split, scope, settings.accounts]
  );

  if (!v || !journal) {
    return (
      <div className="card text-sm text-muted-foreground">
        คำนวณตัวเลขของเดือนนี้ไม่สำเร็จในครั้งนี้ กรุณารีเฟรชหน้าอีกครั้ง
      </div>
    );
  }

  const t = v.total;
  const nothing = t.opening === 0 && t.closing === 0 && t.purchases === 0 && t.cogs === 0;
  if (nothing) {
    return (
      <EmptyState art="none">
        เดือน {monthTitleTh(v.month)} ยังไม่มีสต๊อก บิลซื้อ หรือการนับในสาขาที่คุณดูได้ — เลือกเดือนอื่นด้านบน
      </EmptyState>
    );
  }

  const notes = readinessOf(v);
  const warnings = notes.filter((n) => n.tone === "warn").length;
  const multi = v.branches.length > 1;
  const openExport = () => setExporting(true);

  return (
    <div className="space-y-5">
      {/* 1 — can these figures be trusted yet */}
      <section className="card space-y-3" aria-labelledby="me-ready">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="me-ready" className="font-display text-lg font-semibold">
              ก่อนส่ง ตรวจ {notes.length} เรื่องนี้
            </h2>
            <span className={`chip ${warnings ? "chip-warn" : "chip-good"}`}>
              {warnings ? `ส่งได้ · มีข้อควรรู้ ${warnings} เรื่อง` : "พร้อมส่ง"}
            </span>
          </div>
          <button type="button" onClick={openExport} className="btn hidden sm:inline-flex">
            <DownloadIcon />
            ส่งออกไฟล์ให้บัญชี
          </button>
        </div>
        <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-3 border-t border-border py-2.5 first:border-t-0 md:[&:nth-child(2)]:border-t-0">
              <span
                aria-hidden
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-xs font-semibold ${
                  n.tone === "ok" ? "bg-good-bg text-good" : n.tone === "warn" ? "border border-warn-border bg-warn-bg text-warn" : "border border-border bg-surface-sunk text-muted-subtle"
                }`}
              >
                {n.tone === "ok" ? "✓" : n.tone === "warn" ? "!" : "i"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.detail}</p>
              </div>
              {n.href && n.action && (
                <a href={n.href} className="chip shrink-0 hover:bg-muted">
                  {n.action}
                </a>
              )}
            </li>
          ))}
        </ul>
        <p className="border-t border-dashed border-border-strong pt-2.5 text-xs text-muted-subtle">
          ข้อควรรู้ไม่ห้ามส่ง — ไฟล์ที่ได้จะมีหมายเหตุนี้ติดไปให้นักบัญชีด้วย
        </p>
      </section>

      {/* 2–4 — the equation and what the cost was made of */}
      <Equation v={v} />

      {multi && <BranchTable v={v} />}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* 5 — the entry the file carries */}
        <section className="card space-y-3" aria-labelledby="me-jv">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="me-jv" className="font-display text-lg font-semibold">
              รายการปรับปรุงสิ้นเดือน
            </h2>
            <span className="text-xs text-muted-subtle">สิ่งที่จะอยู่ในไฟล์</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Seg
              label="วิธีลงบัญชี"
              value={mode}
              onChange={setMode}
              items={[
                ["full", "ปิดบัญชีซื้อด้วย (แนะนำ)"],
                ["diff", "ปรับเฉพาะส่วนต่างสต๊อก"],
              ]}
            />
            {multi && (
              <Seg
                label="รวมหรือแยกสาขา"
                value={scope}
                onChange={setScope}
                items={[
                  ["company", "รวมทั้งร้าน"],
                  ["branch", "แยกสาขา"],
                ]}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "full"
              ? "ใช้เมื่อระหว่างเดือนนักบัญชีลงบิลซื้อเข้าบัญชี “ซื้อวัตถุดิบ” (ระบบสินค้าคงเหลือแบบสิ้นงวด — แบบที่ร้านส่วนใหญ่ใช้)"
              : `ใช้เมื่อนักบัญชีปิดบัญชีซื้อเข้าต้นทุนขายเองแล้ว รายการนี้ปรับแค่สต๊อกให้ตรงกับยอดสิ้นเดือน (${baht(t.opening)} → ${baht(t.closing)})`}
            {scope === "branch" && multi && " · แยกสาขาใช้บัญชีพักระหว่างสาขาให้ของที่โอนกันหักล้างกัน"}
          </p>
          {v.recipeMethod && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="mt-1" checked={split} onChange={(e) => setSplit(e.target.checked)} />
              แยกของขาดจากการนับไปบัญชีของตัวเอง ({baht(sumFigures(journalFigures(v)).shrinkage)} ไม่รวมในต้นทุนขาย)
            </label>
          )}
          <div className="overflow-hidden rounded-xl border border-border-strong">
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border bg-surface-sunk px-3.5 py-2 text-xs text-muted-foreground">
              <span>
                วันที่ <b className="font-display font-medium text-foreground">{dayLabelTh(v.to)} {Number(v.to.slice(0, 4)) + 543}</b>
              </span>
              <span>ปรับปรุงสินค้าคงเหลือปลายงวด {monthTitleTh(v.month)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] border-collapse text-sm">
                <thead>
                  <tr className="text-xs text-muted-subtle">
                    <th className="px-3.5 py-2 text-left font-medium">รหัส</th>
                    <th className="px-3.5 py-2 text-left font-medium">ชื่อบัญชี</th>
                    <th className="px-3.5 py-2 text-right font-medium">เดบิต</th>
                    <th className="px-3.5 py-2 text-right font-medium">เครดิต</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.groups.map((g) => (
                    <JournalRows key={g.no} group={g} showBranch={journal.groups.length > 1} />
                  ))}
                  <tr className="bg-surface-sunk font-semibold">
                    <td />
                    <td className="px-3.5 py-2">รวม</td>
                    <td className="px-3.5 py-2 text-right font-display tabular-nums">{fmt(fromSatang(journal.totalDebit))}</td>
                    <td className="px-3.5 py-2 text-right font-display tabular-nums">{fmt(fromSatang(journal.totalCredit))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`inline-flex -rotate-2 items-center gap-1 rounded-lg border-[1.5px] px-2 py-px font-display text-xs font-medium ${
                journal.totalDebit === journal.totalCredit ? "border-good text-good" : "border-bad text-bad"
              }`}
            >
              {journal.totalDebit === journal.totalCredit ? "เดบิต = เครดิต ✓" : "ไม่สมดุล"}
            </span>
            <button type="button" onClick={openExport} className="text-xs text-primary underline-offset-2 hover:underline">
              {Object.values(settings.accounts).some((a) => a.code) ? "รหัสบัญชีตามผังของร้าน · แก้รหัส" : "ยังไม่ได้ใส่รหัสบัญชีของร้าน · ใส่รหัส"}
            </button>
          </div>
        </section>

        <StockCard v={v} />
      </div>

      {/* On a phone the button lives at the bottom of the screen, where the thumb is. */}
      <div className="sticky bottom-3 z-20 sm:hidden">
        <button type="button" onClick={openExport} className="btn w-full shadow-lg">
          <DownloadIcon />
          ส่งออกไฟล์ให้บัญชี
        </button>
      </div>

      {exporting && (
        <ExportDialog
          view={v}
          settings={settings}
          onSettingsSaved={setSettings}
          canEditSettings={canEditSettings}
          mode={mode}
          split={split && v.recipeMethod}
          scope={multi ? scope : "company"}
          onScope={setScope}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

function JournalRows({ group, showBranch }: { group: ReturnType<typeof buildMonthEndJournal>["groups"][number]; showBranch: boolean }) {
  return (
    <>
      {showBranch && (
        <tr>
          <td colSpan={4} className="border-t border-border bg-highlight-soft px-3.5 py-1.5 text-xs font-medium">
            {group.branchName ?? "ทั้งร้าน"}
          </td>
        </tr>
      )}
      {group.lines.map((l, i) => (
        <tr key={i} className="border-t border-border">
          <td className="px-3.5 py-2 font-display text-muted-subtle">{l.code || "—"}</td>
          <td className={`px-3.5 py-2 ${l.credit ? "pl-8" : ""}`}>
            {l.name}
            <span className="block text-xs text-muted-subtle">{l.memo}</span>
          </td>
          <td className="px-3.5 py-2 text-right font-display tabular-nums">{l.debit ? fmt(fromSatang(l.debit)) : ""}</td>
          <td className="px-3.5 py-2 text-right font-display tabular-nums">{l.credit ? fmt(fromSatang(l.credit)) : ""}</td>
        </tr>
      ))}
    </>
  );
}

function Tile({ label, value, sub, result = false }: { label: string; value: number; sub: string; result?: boolean }) {
  return (
    <div className={`grid min-w-0 content-start gap-0.5 rounded-2xl px-4 py-3 ${result ? "bg-primary text-primary-foreground" : "bg-surface-sunk"}`}>
      <span className={`text-xs ${result ? "opacity-80" : "text-muted-foreground"}`}>{label}</span>
      <span className={`whitespace-nowrap font-display font-semibold tabular-nums ${result ? "text-2xl" : "text-xl"}`}>{baht(value)}</span>
      <span className={`text-[11px] ${result ? "opacity-75" : "text-muted-subtle"}`}>{sub}</span>
    </div>
  );
}

const Op = ({ children }: { children: string }) => (
  <span aria-hidden className="hidden place-items-center font-display text-xl text-muted-subtle md:grid">
    {children}
  </span>
);

type Part = { key: string; label: string; value: number; sub: string; color: string };

function partsOf(b: MonthEndBranchView, recipeMethod: boolean): Part[] {
  const cogs = b.cogs;
  const pct = (n: number) => (cogs > 0 ? `${((n / cogs) * 100).toFixed(1)}%` : "");
  const parts: Part[] = [];
  if (recipeMethod) {
    if (b.sold !== null) parts.push({ key: "sold", label: "ขายไปตามสูตร", value: b.sold, sub: `${pct(b.sold)} · ตัดสต๊อกจากยอดขาย`, color: "bg-gradient-to-r from-[#9DAA55] to-[#5E6B14]" });
    const shrink = shrinkageOf(b, true);
    if (b.waste) parts.push({ key: "waste", label: "ทิ้ง", value: b.waste, sub: `${pct(b.waste)} · มีใบบันทึกของเสีย`, color: "bg-wash ring-2 ring-inset ring-sage" });
    if (b.staffMeals) parts.push({ key: "meals", label: "มื้อพนักงาน", value: b.staffMeals, sub: `${pct(b.staffMeals)} · ตามที่บันทึกมื้อพนักงาน`, color: "bg-[#E7C860]" });
    if (shrink)
      parts.push({
        key: "shrink",
        label: "ของขาดจากการนับ",
        value: shrink,
        sub: `${pct(shrink)} · ขาด ${fmt(b.shortage)}${b.other ? ` · เจอเกินและปรับยอด ${signed(b.other)}` : ""}`,
        color: "bg-gradient-to-r from-[#E8A76F] to-[#C0692B]",
      });
  } else {
    const used = (cents(cogs) - cents(b.waste) - cents(b.staffMeals)) / 100;
    parts.push({ key: "used", label: "ใช้ไปทั้งหมด", value: used, sub: `${pct(used)} · ขายและขาดรวมกัน (วิธีนับสต๊อกแยกไม่ได้)`, color: "bg-gradient-to-r from-[#9DAA55] to-[#5E6B14]" });
    if (b.waste) parts.push({ key: "waste", label: "ทิ้ง", value: b.waste, sub: `${pct(b.waste)} · มีใบบันทึกของเสีย`, color: "bg-wash ring-2 ring-inset ring-sage" });
    if (b.staffMeals) parts.push({ key: "meals", label: "มื้อพนักงาน", value: b.staffMeals, sub: pct(b.staffMeals), color: "bg-[#E7C860]" });
  }
  return parts;
}

function Equation({ v }: { v: View }) {
  const t = v.total;
  const parts = partsOf(t, v.recipeMethod);
  const bar = parts.filter((p) => p.value > 0);
  const barTotal = bar.reduce((s, p) => s + p.value, 0);
  const transfersNet = cents(t.transfersIn) - cents(t.transfersOut);
  // The parts sum to the cost by construction (rule ME3); said here because a
  // reader who checks it with a calculator deserves to be told it will tie.
  const ties = parts.reduce((s, p) => s + cents(p.value), 0) === cents(t.cogs);
  const where = v.branches.length > 1 ? `รวม ${v.branches.length} สาขา` : v.branches[0]?.branchName ?? "";
  return (
    <section className="card space-y-4" aria-labelledby="me-eq">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="me-eq" className="font-display text-lg font-semibold">
          ต้นทุนขายเดือนนี้มาจากไหน
        </h2>
        <span className="text-xs text-muted-subtle">
          {where} · 1–{Number(v.to.slice(8))} {monthTitleTh(v.month)}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1.15fr)]">
        <Tile label="สต๊อกต้นเดือน" value={t.opening} sub="ยอดสิ้นเดือนก่อน" />
        <Op>+</Op>
        <Tile label="ซื้อเข้า" value={t.purchases} sub={v.vatRegistered ? "บิลวัตถุดิบ ไม่รวม VAT" : "บิลวัตถุดิบ รวม VAT"} />
        <Op>−</Op>
        <Tile label="สต๊อกสิ้นเดือน" value={t.closing} sub={`${v.stock.length} รายการ ณ ${dayLabelTh(v.to)}`} />
        <Op>=</Op>
        <Tile label="ต้นทุนขาย" value={t.cogs} sub="ยอดที่ลงบัญชี" result />
      </div>
      {transfersNet !== 0 && (
        <p className="text-xs text-muted-foreground">
          รวมของที่โอนกับสาขานอกสิทธิ์ของคุณ {signed(transfersNet / 100)} — ต้นทุนขาย = ยกมา + ซื้อ + รับโอน − โอนออก − คงเหลือ
        </p>
      )}
      {t.cogs > 0 && bar.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
            <span>ต้นทุนขาย {baht(t.cogs)} ประกอบด้วย</span>
            {ties && <span className="text-xs text-good">✓ ลงตัว — ส่วนประกอบรวมกันเท่าต้นทุนขายพอดี</span>}
          </div>
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-wash" role="img" aria-label={parts.map((p) => `${p.label} ${fmt(p.value)}`).join(" · ")}>
            {bar.map((p, i) => (
              <i
                key={p.key}
                className={`block h-full animate-grow-x ${p.color}`}
                style={{ width: `${Math.max((p.value / barTotal) * 100, 0.6)}%`, transformOrigin: "left", animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            {parts.map((p) => (
              <div key={p.key} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-x-2">
                <span aria-hidden className={`h-2.5 w-2.5 translate-y-px rounded-[3px] ${p.color}`} />
                <dt className="text-sm">{p.label}</dt>
                <dd className={`whitespace-nowrap font-display text-sm font-medium tabular-nums ${p.value < 0 ? "text-bad" : ""}`}>{baht(p.value)}</dd>
                <span className="col-start-2 col-end-4 text-[11px] text-muted-subtle">{p.sub}</span>
              </div>
            ))}
          </dl>
        </div>
      )}
      {t.cogs <= 0 && (
        <p className="rounded-xl border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn">
          ต้นทุนขายของเดือนนี้ไม่เป็นบวก — สต๊อกสิ้นเดือนมากกว่ายกมาบวกที่ซื้อ ตรวจบิลซื้อและการนับในหัวข้อ “ก่อนส่ง” ก่อนส่งให้บัญชี
        </p>
      )}
    </section>
  );
}

function Money({ n, empty }: { n: number; empty?: string }) {
  if (n === 0 && empty) {
    return (
      <>
        <span className="text-muted-subtle">—</span>
        <span className="block text-[11px] text-muted-subtle">{empty}</span>
      </>
    );
  }
  return <span className={`font-display font-medium tabular-nums ${n < 0 ? "text-bad" : ""}`}>{signed(n)}</span>;
}

function BranchTable({ v }: { v: View }) {
  const rows = [...v.branches, v.total];
  return (
    <section className="space-y-2" aria-labelledby="me-br">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="me-br" className="font-display text-lg font-semibold">
          แยกสาขา
        </h2>
        <span className="text-xs text-muted-subtle">ของที่โอนระหว่างสาขาหักล้างกันในยอดรวม</span>
      </div>
      <div className="data-table">
        <table className="min-w-[820px]">
          <thead>
            <tr>
              <th>สาขา</th>
              <th className="text-right">สต๊อกต้นเดือน</th>
              <th className="text-right">ซื้อเข้า</th>
              <th className="text-right">โอนเข้า / ออก</th>
              <th className="text-right">สต๊อกสิ้นเดือน</th>
              <th className="text-right">ต้นทุนขาย</th>
              {v.recipeMethod && <th className="text-right">ในนั้นเป็นของขาดจากการนับ</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const total = b.branchId === "ALL";
              const net = (cents(b.transfersIn) - cents(b.transfersOut)) / 100;
              const shrink = shrinkageOf(b, v.recipeMethod);
              return (
                <tr key={b.branchId} className={total ? "bg-surface-sunk font-semibold" : "hover:bg-muted/50"}>
                  <td>
                    {b.branchName}
                    {!total && (
                      <span className="block text-[11px] font-normal text-muted-subtle">
                        {b.lastCountDate ? `นับล่าสุด ${dayLabelTh(b.lastCountDate)}` : "ยังไม่เคยนับ"}
                      </span>
                    )}
                  </td>
                  <td className="text-right"><Money n={b.opening} empty={total ? undefined : "ยังไม่มีสต๊อก"} /></td>
                  <td className="text-right"><Money n={b.purchases} empty={total ? undefined : "ไม่มีบิลซื้อ"} /></td>
                  <td className="text-right">
                    {total ? (
                      <span className="text-muted-subtle">{net === 0 ? "หักล้างกัน" : signed(net)}</span>
                    ) : net === 0 ? (
                      <span className="text-muted-subtle">—</span>
                    ) : (
                      <>
                        <span className="font-display font-medium tabular-nums">{net > 0 ? "+" : ""}{signed(net)}</span>
                        <span className="block text-[11px] text-muted-subtle">{net > 0 ? "รับโอน" : "โอนออก"}</span>
                      </>
                    )}
                  </td>
                  <td className="text-right">
                    <Money n={b.closing} />
                    {!total && b.unpricedProducts > 0 && <span className="block text-[11px] text-warn">ไม่มีราคา {b.unpricedProducts} รายการ</span>}
                  </td>
                  <td className="text-right"><Money n={b.cogs} /></td>
                  {v.recipeMethod && (
                    <td className="text-right">
                      <Money n={shrink} />
                      <span className="block text-[11px] font-normal text-muted-subtle">
                        ขาด {fmt(b.shortage)}
                        {b.other ? ` · เจอเกิน/ปรับ ${signed(b.other)}` : ""}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StockCard({ v }: { v: View }) {
  const [all, setAll] = useState(false);
  const shown = all ? v.stock : v.stock.slice(0, 8);
  const rest = v.stock.slice(8);
  const restValue = rest.reduce((s, r) => s + cents(r.value), 0) / 100;
  const multi = v.branches.length > 1;
  return (
    <section className="card space-y-3" aria-labelledby="me-stock">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="me-stock" className="font-display text-lg font-semibold">
          สต๊อกสิ้นเดือนรายสินค้า
        </h2>
        <span className="text-xs text-muted-subtle">
          {v.stock.length} รายการ · {baht(v.total.closing)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">แนบไปในไฟล์เป็นเอกสารประกอบ — ราคาทุนแบบเข้าก่อนออกก่อน (FIFO)</p>
      {v.stock.length === 0 ? (
        <p className="text-sm text-muted-subtle">ไม่มีของในสต๊อก ณ สิ้นเดือน</p>
      ) : (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>สินค้า</th>
                {multi && <th>สาขา</th>}
                <th className="text-right">คงเหลือ</th>
                <th className="text-right">มูลค่า</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s, i) => (
                <tr key={i}>
                  <td>
                    {s.productName}
                    {s.unpriced && <span className="ml-1.5 chip chip-warn">ไม่มีราคา</span>}
                  </td>
                  {multi && <td className="text-muted-foreground">{s.branchName.replace(/^สาขา/, "")}</td>}
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {s.qty.toLocaleString("th-TH", { maximumFractionDigits: 3 })} {s.unitName}
                  </td>
                  <td className="text-right font-display font-medium tabular-nums">{s.value ? fmt(s.value) : <span className="text-muted-subtle">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rest.length > 0 && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs text-primary underline-offset-2 hover:underline">
          {all ? "ย่อ" : `และอีก ${rest.length} รายการ ${baht(restValue)} — ดูทั้งหมด`}
        </button>
      )}
    </section>
  );
}
