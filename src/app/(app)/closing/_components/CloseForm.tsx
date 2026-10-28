"use client";

// ปิดร้านประจำวัน — the form the closer fills on a phone (ADR 0042, mockup
// L7xH4nsUVuc5xGwZocrrEj v3). One long page, one required field (the till
// total, unless a POS file already locked it), every other blank saved as
// "not recorded".

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { saveDailyCloseAction } from "../actions";
import { DAILY_ISSUE_CATEGORY_LABELS_TH, DAILY_ISSUE_CATEGORY_VALUES, MIX_PARTS, cashDifference, type DailyIssueCategoryValue } from "@/lib/validations/daily-close";
import type { DailyCloseDay } from "@/server/daily-close";
import { colorOf } from "./mix";
import ClosingUpload from "./ClosingUpload";

type IssueDraft = { key: string; id: string | null; category: DailyIssueCategoryValue; body: string; followUp: boolean };
let seq = 0;
const s = (n: number | null) => (n === null ? "" : String(n));
const toNum = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function CloseForm({
  day,
  branchName,
  dateLabel,
  profiles = [],
}: {
  day: DailyCloseDay;
  branchName: string;
  dateLabel: string;
  /** This branch's POS file formats — step 5 uploads the day's file (Kong 2026-10-25). */
  profiles?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pulse, setPulse] = useState(s(day.pulseAmount));
  const [guests, setGuests] = useState(s(day.guestCount));
  const [cashFloat, setCashFloat] = useState(s(day.close?.cashFloat ?? null));
  const [cashSales, setCashSales] = useState(s(day.close?.cashSales ?? null));
  const [cashCounted, setCashCounted] = useState(s(day.close?.cashCounted ?? null));
  const [cashNote, setCashNote] = useState(day.close?.cashNote ?? "");
  const [mix, setMix] = useState<Record<string, number>>(() => Object.fromEntries(day.mix.map((m) => [m.customerTypeId, m.parts])));
  const [issues, setIssues] = useState<IssueDraft[]>(() =>
    day.issues.map((i) => ({ key: i.id, id: i.id, category: i.category as DailyIssueCategoryValue, body: i.body, followUp: i.followUp }))
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const used = Object.values(mix).reduce((t, n) => t + n, 0);
  const order = useMemo(() => day.customerTypes.map((t) => t.id), [day.customerTypes]);
  const diff = cashDifference({ cashFloat: toNum(cashFloat), cashSales: toNum(cashSales), cashCounted: toNum(cashCounted) });
  const guestsFromPos = day.guestCountSource === "POS";

  const bump = (id: string, d: number) =>
    setMix((m) => {
      const cur = m[id] ?? 0;
      const next = Math.max(0, Math.min(cur + d, cur + (MIX_PARTS - used)));
      return { ...m, [id]: next };
    });

  const submit = () => {
    setError(null);
    setFieldErrors({});
    start(async () => {
      const res = await orStale(
        saveDailyCloseAction({
          branchId: day.branchId,
          businessDate: day.businessDate,
          pulseAmount: day.pulseLocked ? null : pulse,
          guestCount: guests,
          cashFloat,
          cashSales,
          cashCounted,
          cashNote,
          mix: Object.entries(mix).map(([customerTypeId, parts]) => ({ customerTypeId, parts })),
          issues: issues.filter((i) => i.body.trim() !== "").map(({ id, category, body, followUp }) => ({ id, category, body, followUp })),
        })
      );
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.formError ?? null);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  };

  const field = "input w-36 text-right tabular-nums";
  const err = (k: string) => fieldErrors[k] && <p className="text-xs text-bad">{fieldErrors[k]}</p>;
  const Sec = ({ n, title, optional }: { n: number; title: string; optional?: boolean }) => (
    <h3 className="flex items-center gap-2 font-semibold">
      <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">{n}</span>
      {title}
      {optional && <span className="text-xs font-normal text-muted-subtle">ไม่กรอกก็ได้</span>}
    </h3>
  );

  return (
    <div className="mx-auto max-w-md space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">ปิดร้าน · {branchName}</h2>
        <span className="text-sm text-muted-foreground">{dateLabel}</span>
      </div>

      <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
        <Sec n={1} title="ยอดขายวันนี้" />
        <div className="flex items-center justify-between gap-3 text-sm">
          <label htmlFor="pulse">
            ยอดรวมจาก POS{!day.pulseLocked && <span className="ml-0.5 font-bold text-bad">*</span>}
            <span className="block text-xs text-muted-subtle">ที่ลูกค้าจ่าย รวม VAT และค่าบริการ</span>
          </label>
          {day.pulseLocked ? (
            <span className="text-right text-sm text-muted-foreground">ล็อกแล้ว — ใช้ยอดจากไฟล์</span>
          ) : (
            <input id="pulse" inputMode="decimal" value={pulse} onChange={(e) => setPulse(e.target.value)} onFocus={(e) => e.target.select()} className={field} required />
          )}
        </div>
        {err("pulseAmount")}
        <p className="text-xs text-muted-subtle">
          {day.pulseLocked ? "ไฟล์ยอดขายของวันนี้เข้ามาแล้ว ยอดในไฟล์เป็นหลักฐาน" : "ช่องเดียวที่ต้องกรอก · ไฟล์ยอดขายเข้าแล้วช่องนี้จะล็อก"}
        </p>
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
        <Sec n={2} title="เงินสด" optional />
        {(
          [
            ["cashFloat", "เงินทอนตั้งต้น", cashFloat, setCashFloat, null],
            ["cashSales", "เงินสดจากการขาย", cashSales, setCashSales, "ยอดที่ลูกค้าจ่ายเป็นเงินสด ดูจากเครื่อง POS"],
            ["cashCounted", "นับได้จริง", cashCounted, setCashCounted, null],
          ] as const
        ).map(([k, label, v, set, hint]) => (
          <div key={k}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label htmlFor={k}>
                {label}
                {hint && <span className="block text-xs text-muted-subtle">{hint}</span>}
              </label>
              <input id={k} inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} onFocus={(e) => e.target.select()} className={field} />
            </div>
            {err(k)}
          </div>
        ))}
        {diff !== null && (
          <div className={`flex justify-between rounded-xl px-3 py-2 text-sm ${diff === 0 ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}>
            <span>
              ควรมี {baht((toNum(cashFloat) ?? 0) + (toNum(cashSales) ?? 0))} · นับได้ {baht(toNum(cashCounted) ?? 0)}
            </span>
            <b>{diff === 0 ? "ตรง" : diff < 0 ? `ขาด ${baht(-diff)}` : `เกิน ${baht(diff)}`}</b>
          </div>
        )}
        <input value={cashNote} onChange={(e) => setCashNote(e.target.value)} maxLength={200} placeholder="หมายเหตุส่วนต่าง เช่น ทอนผิดโต๊ะ 7" className="input w-full text-sm" />
        <div className="rounded-xl border border-dashed border-border-strong p-2.5 text-center text-xs text-muted-subtle">📷 แนบรูปเงินที่นับ — เร็ว ๆ นี้</div>
        <p className="text-xs text-muted-subtle">เว้นช่องไหนไว้ = ไม่มีข้อมูล ไม่ใช่ 0 · กรอกไม่ครบสามช่อง ระบบไม่คิดขาด/เกิน</p>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <Sec n={3} title="ลูกค้า" optional />
        <div className="flex items-center justify-between gap-3 text-sm">
          <label htmlFor="guests">
            <b>จำนวนลูกค้าทั้งหมด</b>
            <span className="block text-xs text-muted-subtle">ตัวเลขจริงจาก POS</span>
          </label>
          {guestsFromPos ? (
            <span className="tabular-nums font-medium">{day.guestCount} คน</span>
          ) : (
            <input id="guests" inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value)} onFocus={(e) => e.target.select()} className={field} />
          )}
        </div>
        {err("guestCount")}
        {day.customerTypes.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-semibold">
              ถ้าลูกค้า 10 คน ส่วนใหญ่เป็นใคร? <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[11px] font-normal text-warn">ประมาณ</span>
            </p>
            {day.customerTypes.map((t) => {
              const n = mix[t.id] ?? 0;
              return (
                <div key={t.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {t.name}
                      {t.archived && <span className="ml-1 text-xs text-muted-subtle">(เลิกใช้แล้ว)</span>}
                    </span>
                    <span className="inline-flex items-center overflow-hidden rounded-full border border-border-strong">
                      <button type="button" onClick={() => bump(t.id, -1)} className="bg-muted px-3 py-0.5 text-muted-foreground disabled:opacity-40" disabled={n === 0} aria-label={`ลด ${t.name}`}>
                        −
                      </button>
                      <span className="min-w-[2rem] text-center font-semibold tabular-nums">{n}</span>
                      <button type="button" onClick={() => bump(t.id, 1)} className="bg-muted px-3 py-0.5 text-muted-foreground disabled:opacity-40" disabled={used >= MIX_PARTS} aria-label={`เพิ่ม ${t.name}`}>
                        +
                      </button>
                    </span>
                  </div>
                  <div className="flex gap-0.5">
                    {Array.from({ length: MIX_PARTS }, (_, i) => (
                      <i key={i} className={`h-1.5 flex-1 rounded-sm ${i < n ? "" : "bg-muted"}`} style={i < n ? { background: colorOf(order, t.id) } : undefined} />
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-subtle">
              {used === MIX_PARTS ? "ครบ 10 ส่วน" : `แบ่งแล้ว ${used} จาก 10 — ที่เหลือนับเป็น “ไม่แน่ใจ”`} · ระบบแสดงเป็นสัดส่วนประมาณ ไม่ใช่จำนวนคน
            </p>
          </div>
        )}
        <p className="text-xs text-muted-subtle">ช่องทาง (นั่งร้าน/กลับบ้าน/Grab…) ไม่ต้องกรอก — มาจากไฟล์ POS เมื่อไฟล์มีคอลัมน์ช่องทาง</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
        <Sec n={4} title="ปัญหาวันนี้" optional />
        {issues.map((i) => (
          <div key={i.key} className="space-y-1.5 rounded-xl border border-border p-2.5">
            <div className="flex flex-wrap gap-1.5">
              {DAILY_ISSUE_CATEGORY_VALUES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setIssues((xs) => xs.map((x) => (x.key === i.key ? { ...x, category: c } : x)))}
                  className={`pill ${i.category === c ? "is-on" : ""}`}
                >
                  {DAILY_ISSUE_CATEGORY_LABELS_TH[c]}
                </button>
              ))}
            </div>
            <textarea
              value={i.body}
              onChange={(e) => setIssues((xs) => xs.map((x) => (x.key === i.key ? { ...x, body: e.target.value } : x)))}
              rows={2}
              maxLength={500}
              placeholder="เกิดอะไรขึ้น — บอกอาการ ไม่ใช่แค่ “เสีย”"
              className="input w-full text-sm"
            />
            <div className="flex items-center justify-between text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={i.followUp} onChange={(e) => setIssues((xs) => xs.map((x) => (x.key === i.key ? { ...x, followUp: e.target.checked } : x)))} />
                ต้องตามต่อ (ค้างให้ทุกคนเห็นจนกว่าจะจัดการ)
              </label>
              <button type="button" onClick={() => setIssues((xs) => xs.filter((x) => x.key !== i.key))} className="text-muted-foreground hover:text-bad">
                ลบ
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setIssues((xs) => [...xs, { key: `n${++seq}`, id: null, category: "OTHER", body: "", followUp: false }])}
          className="btn-secondary btn-sm"
        >
          + เพิ่มปัญหา
        </button>
        {err("issues")}
      </section>

      <section className="space-y-1 rounded-2xl border border-border bg-surface p-4 text-sm">
        <h3 className="font-semibold">ระบบเติมให้ <span className="text-xs font-normal text-muted-subtle">ไม่ต้องกรอก</span></h3>
        <ul className="divide-y divide-border">
          <li className="flex justify-between py-1.5">
            <span>ของเสีย</span>
            <span>{day.auto.wasteCount} รายการ</span>
          </li>
          <li className="flex justify-between py-1.5">
            <span>มื้อพนักงาน</span>
            <span>{day.auto.staffMealCount} รายการ</span>
          </li>
          <li className="flex justify-between py-1.5">
            <span>ตัดสต๊อกตามยอดขาย</span>
            <span>{day.auto.consumptionPosted === null ? "ยังไม่มีไฟล์ยอดขาย" : day.auto.consumptionPosted ? "ตัดแล้ว" : "ยังไม่ได้ตัด"}</span>
          </li>
        </ul>
      </section>

      {error && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</p>}
      {saved && !pending && !error && <p className="rounded-xl bg-good-bg p-3 text-sm text-good">บันทึกปิดร้านแล้ว</p>}
      <button type="button" onClick={submit} disabled={pending} className="btn w-full py-3 text-base">
        {pending ? "กำลังบันทึก…" : day.close ? "บันทึกการแก้ไข" : "บันทึกปิดร้าน"}
      </button>
      <p className="text-center text-xs text-muted-subtle">แก้ได้ถึงเที่ยงคืนของวันถัดไป · หลังจากนั้นเขียนความเห็นต่อได้ แต่ตัวเลขไม่เปลี่ยน</p>

      <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
        <Sec n={5} title="อัปโหลดไฟล์ยอดขายจาก POS" />
        <p className="text-xs text-muted-subtle">หลังบันทึกยอดปิดร้านแล้ว — ระบบเทียบไฟล์กับยอดที่คีย์ให้ทันที แล้วตัดสต๊อกตามสูตร</p>
        <ClosingUpload profiles={profiles} businessDate={day.businessDate} pulseSaved={day.pulseAmount !== null || day.pulseLocked} pulseLocked={day.pulseLocked} />
      </section>
    </div>
  );
}
