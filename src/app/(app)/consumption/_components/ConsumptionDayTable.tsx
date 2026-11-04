"use client";

// ============================================================
// Mise — the posting queue and its coverage (Part 22 L5, ADR 0022)
// ============================================================
// One table, because the queue and the report are one row seen from two sides:
// a day with sales, and what a posting has or has not done to it.
//
// The whole screen is organised around one refusal being useful. Pressing on a
// day already posted takes a real result back, so the first press is REFUSED and
// this component renders what it would discard (Q2b) — the confirmation is the
// feature, not the friction.
//
// Queue item 9 (Kong 2026-11-04, "เอาตามแนะนำ"): the yellow box said "2 days not
// posted" while the only button said "post 23 days" — it sent every day in the
// window, the 21 already posted included, so posting the two meant confirming a
// re-post of all 23. Each box now carries the press for its own days; re-posting
// the whole window is the secondary button, and still asks first.
// ============================================================

import { useActionState, useMemo, useState, type ReactNode } from "react";
import {
  postConsumptionAction,
  type PostConsumptionActionState,
} from "@/app/(app)/consumption/actions";
import {
  CONSUMPTION_DAY_STATE_CHIP,
  CONSUMPTION_DAY_STATE_HINTS_TH,
  CONSUMPTION_DAY_STATE_LABELS_TH,
  type ConsumptionDayState,
  type ConsumptionDayView,
  type PostedDaySummaryView,
} from "@/app/(app)/consumption/_components/consumption-view";
import {
  CONSUMPTION_SKIP_REASON_HINTS_TH,
  CONSUMPTION_SKIP_REASON_LABELS_TH,
} from "@/lib/validations/consumption";
import { useKeepForm } from "@/lib/keep-form";
import WaitingFor from "@/components/ui/WaitingFor";
import ShowMore from "@/components/ui/ShowMore";

/** Same local helper the recipe forms use — no lib for one line. */
function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** "฿19,500", satang only when there are some. */
const baht = (v: string) => {
  const n = Number(v);
  return `฿${n.toLocaleString("th-TH", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** Up to three days by name, more as first – last. */
const daysLabel = (ds: ConsumptionDayView[]) =>
  ds.length <= 3 ? ds.map((d) => d.businessDateLabel).join(" · ") : `${ds[0].businessDateLabel} – ${ds[ds.length - 1].businessDateLabel}`;

const POST_CONSUMPTION_INIT: PostConsumptionActionState = { ok: false };

/** How many already-posted days the confirmation names before "ดูอีก". */
const ACK_SHOWN = 5;

const ackLine = (d: PostedDaySummaryView) => (
  <p key={d.businessDate}>
    {d.businessDateLabel} — ตัดเมื่อ {d.postedAtLabel} · ครอบคลุม {baht(d.coveredNetAmount)} จาก {baht(d.totalNetAmount)}
  </p>
);

/** Which days one press sends. */
type Scope = "unposted" | "stale" | "all";

/** The legend's order: what needs doing first. */
const LEGEND_ORDER: ConsumptionDayState[] = ["NOT_POSTED", "POSTED_STALE", "POSTED_PARTIAL", "OUT_OF_WINDOW", "POSTED"];

export function ConsumptionDayTable({
  days,
  branchId,
  children,
}: {
  days: ConsumptionDayView[];
  branchId: string;
  /** Rendered between the box of things to do and the day table. */
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(
    postConsumptionAction,
    POST_CONSUMPTION_INIT
  );
  // Nothing is typed here, so the form never needs resetting — no ref.
  const { action, onSubmit } = useKeepForm(formAction, state);
  const [open, setOpen] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");

  // A day past the backdate window can never post, so it is never offered — a
  // button that cannot work is worse than the sentence saying why (rule N9).
  const sets = useMemo(() => {
    const inWindow = days.filter((d) => d.withinWindow);
    // Oldest first, the order the table does not use but a sentence does.
    const asc = (ds: ConsumptionDayView[]) => [...ds].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    return {
      unposted: asc(inWindow.filter((d) => d.state === "NOT_POSTED")),
      stale: asc(inWindow.filter((d) => d.state === "POSTED_STALE")),
      all: inWindow,
    } satisfies Record<Scope, ConsumptionDayView[]>;
  }, [days]);

  // Minted per render of the days, not per press: a retry of the SAME press
  // must carry the same key, which is what stops a double-submit consuming
  // twice. One per scope, so two different presses never share a run id.
  const keys = useMemo(
    () => ({ unposted: newSubmitKey(), stale: newSubmitKey(), all: newSubmitKey() }) satisfies Record<Scope, string>,
    [days]
  );

  // "ไม่ตัดใหม่" hides this refusal; the next press brings a new one.
  const [dismissed, setDismissed] = useState<PostConsumptionActionState | null>(null);
  const needsAck = !state.ok && state !== dismissed ? state.needsAcknowledgement : undefined;

  /** One press: its own form, its own days, its own key. */
  const press = (s: Scope, label: string, className: string, ack = false) => (
    <form action={action} onSubmit={onSubmit} className="contents">
      <input type="hidden" name="submit_key" value={keys[s]} />
      <input type="hidden" name="branch_id" value={branchId} />
      {sets[s].map((d) => (
        <input key={d.businessDate} type="hidden" name="business_date" value={d.businessDate} />
      ))}
      {/* Never defaulted on: it takes real ledger rows back (Q2b). */}
      {ack && <input type="hidden" name="acknowledge_repost" value="on" />}
      <button type="submit" disabled={pending || sets[s].length === 0} onClick={() => setScope(s)} className={className}>
        {pending && scope === s ? "กำลังตัดสต๊อก…" : label}
      </button>
    </form>
  );

  const allLabel = `ตัดใหม่ทั้งช่วง ${sets.all.length} วัน`;
  const todo = sets.unposted.length > 0 || sets.stale.length > 0;
  const present = new Set(days.map((d) => d.state));

  return (
    <div className="space-y-4">
      {state.ok && state.days.length > 0 && (
        <div className="rounded-[18px] border border-good-border bg-good-bg p-4 text-sm">
          <p className="font-display font-semibold text-good">ตัดสต๊อกเรียบร้อย {state.days.length} วัน</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {state.days.map((d) => (
              <li key={d.businessDate}>
                {d.businessDateLabel} — ตัดได้ {d.menusPosted} เมนู
                {d.menusSkipped > 0 && ` · ตัดไม่ได้ ${d.menusSkipped} เมนู`}
                {d.coveragePercent !== null &&
                  ` · ครอบคลุม ${d.coveragePercent}% ของยอดขาย`}
                {d.replaced && " · แทนที่ของเดิม"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!state.ok && state.formError && (
        <p className="rounded-[18px] border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {state.formError}
        </p>
      )}

      {needsAck && (
        <div className="space-y-3 rounded-[18px] border border-warn-border bg-warn-bg p-4 text-sm">
          <div>
            <p className="font-display text-[15px] font-semibold text-foreground">
              {needsAck.days.length} วันนี้ตัดสต๊อกไปแล้ว — กดยืนยันจะยกเลิกของเดิมทั้งวัน แล้วตัดใหม่
            </p>
            {/* Twenty days is a wall; five say what it is, the rest on request. */}
            <ShowMore
              className="mt-1.5 space-y-0.5 text-muted-foreground"
              head={needsAck.days.slice(0, ACK_SHOWN).map(ackLine)}
              tail={needsAck.days.slice(ACK_SHOWN).map(ackLine)}
              more={needsAck.days.length > ACK_SHOWN ? `ดูอีก ${needsAck.days.length - ACK_SHOWN} วัน` : ""}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              ของเดิมไม่ได้ถูกลบ — ระบบออกรายการกลับให้ครบทุกแถว แล้วบันทึกชุดใหม่ทับ
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {press(scope, `ยืนยัน — ตัดใหม่ ${sets[scope].length} วัน`, "btn btn-sm", true)}
            <button type="button" onClick={() => setDismissed(state)} disabled={pending} className="btn-secondary btn-sm">
              ไม่ตัดใหม่
            </button>
          </div>
        </div>
      )}

      {todo ? (
        <div className="space-y-3 rounded-[18px] border border-warn-border bg-warn-bg p-4">
          {sets.unposted.length > 0 && (
            <div>
              <p className="font-display text-[15px] font-semibold">
                ยังไม่ได้ตัดสต๊อก {sets.unposted.length} วัน · {daysLabel(sets.unposted)}
              </p>
              <p className="text-[13px] text-muted-foreground">
                ต้นทุนของวันเหล่านั้นยังไม่ถูกนับ กำไรขั้นต้นแบบสูตรอาหารจึงยังดูดีเกินจริง
              </p>
            </div>
          )}
          {sets.stale.length > 0 && (
            <div>
              <p className="font-display text-[15px] font-semibold">
                {sets.stale.length} วันถูกตัดไว้ก่อนที่สูตรจะเปลี่ยน · {daysLabel(sets.stale)}
              </p>
              <p className="text-[13px] text-muted-foreground">
                มีสูตรที่มีผลกับวันเหล่านั้นถูกเขียนหรือแก้หลังจากตัดไปแล้ว · ระบบไม่ตัดใหม่ให้เอง
                เพราะจะเป็นการเขียนทับงวดที่ร้านอาจปิดบัญชีไปแล้ว
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {sets.unposted.length > 0 && press("unposted", `ตัด ${sets.unposted.length} วันที่ยังไม่ได้ตัด`, "btn btn-sm")}
            {sets.stale.length > 0 &&
              press("stale", `ตัดใหม่ ${sets.stale.length} วันที่สูตรเปลี่ยน`, sets.unposted.length > 0 ? "btn-secondary btn-sm" : "btn btn-sm")}
            {press("all", allLabel, "btn-secondary btn-sm")}
            <span className="text-xs text-muted-foreground">ตัดใหม่ใช้หลังเขียนหรือแก้สูตร · ถามยืนยันก่อนทุกครั้ง</span>
          </div>
        </div>
      ) : sets.all.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {press("all", allLabel, "btn-secondary btn-sm")}
          <span className="text-xs text-muted-foreground">ทุกวันในช่วงนี้ตัดแล้ว · ใช้ปุ่มนี้หลังเขียนหรือแก้สูตร ระบบจะถามยืนยันก่อน</span>
        </div>
      ) : (
        days.length > 0 && <p className="text-xs text-muted-foreground">ไม่มีวันที่ตัดสต๊อกได้ในช่วงนี้</p>
      )}

      {children}

      {days.length === 0 ? (
        <div className="card">
          {/* Queue item 10: say what fills the table, and where. */}
          <WaitingFor figure="consumptionDays" needs={["sales", "recipe"]} reason="ยังไม่มียอดขายนำเข้าในช่วงนี้" outline={false} />
        </div>
      ) : (
        <>
          {/* Queue item 9: on a phone each day is a card — a table row stood
              ~110px tall, its chip broke in two and the hint repeated per row. */}
          <ul className="space-y-2 sm:hidden">
            {days.map((d) => (
              <DayCard
                key={d.businessDate}
                day={d}
                open={open === d.businessDate}
                onToggle={() => setOpen(open === d.businessDate ? null : d.businessDate)}
              />
            ))}
          </ul>
          <div className="data-table hidden sm:block">
            <table>
              <thead>
                <tr>
                  <th>วันขาย</th>
                  <th className="text-right">ยอดขาย</th>
                  <th>สถานะ</th>
                  <th className="text-right">ครอบคลุม</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <DayRow
                    key={`${d.branchId}-${d.businessDate}`}
                    day={d}
                    open={open === d.businessDate}
                    onToggle={() =>
                      setOpen(open === d.businessDate ? null : d.businessDate)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          {/* Said once, here, instead of under every row. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {LEGEND_ORDER.filter((s) => present.has(s)).map((s) => (
              <span key={s} className="mr-3 inline-block">
                <b className="font-medium text-foreground">{CONSUMPTION_DAY_STATE_LABELS_TH[s]}</b> = {CONSUMPTION_DAY_STATE_HINTS_TH[s]}
              </span>
            ))}
            <span className="inline-block">
              <b className="font-medium text-foreground">ครอบคลุม</b> = ส่วนของยอดขายที่ตัดตามสูตรได้
            </span>
          </p>
        </>
      )}
    </div>
  );
}

function SkipToggle({ day, open, onToggle }: { day: ConsumptionDayView; open: boolean; onToggle: () => void }) {
  if (day.skipped.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="text-xs text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid"
    >
      {open ? "ซ่อน" : `${day.skipped.length} เมนูตัดไม่ได้`}
    </button>
  );
}

function SkipList({ day }: { day: ConsumptionDayView }) {
  return (
    <ul className="space-y-2">
      {day.skipped.map((s) => (
        <li key={s.menuId} className="text-xs">
          <span className="font-medium">{s.menuName}</span>{" "}
          <span className="text-muted-foreground">
            ({Number(s.qty).toLocaleString("th-TH")} ที่ · {baht(s.netAmount)})
          </span>
          <br />
          <span className="text-muted-foreground">
            {CONSUMPTION_SKIP_REASON_LABELS_TH[s.reason]}
            {s.detail && `: ${s.detail}`} —{" "}
            {CONSUMPTION_SKIP_REASON_HINTS_TH[s.reason]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DayCard({ day, open, onToggle }: { day: ConsumptionDayView; open: boolean; onToggle: () => void }) {
  const meta = [
    day.coveragePercent !== null ? `ครอบคลุม ${day.coveragePercent}%` : null,
    day.postedAtLabel ? `ตัดเมื่อ ${day.postedAtLabel}` : null,
  ].filter(Boolean);
  return (
    <li className="rounded-[18px] border border-border/70 bg-surface p-3.5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <b className="font-display font-semibold">{day.businessDateLabel}</b>
        <span className="font-display font-semibold tabular-nums">{baht(day.netAmount)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          {meta.length > 0 ? meta.join(" · ") : CONSUMPTION_DAY_STATE_HINTS_TH[day.state]}
        </span>
        <span className={`shrink-0 ${CONSUMPTION_DAY_STATE_CHIP[day.state]}`}>{CONSUMPTION_DAY_STATE_LABELS_TH[day.state]}</span>
      </div>
      {day.skipped.length > 0 && (
        <div className="mt-1.5">
          <SkipToggle day={day} open={open} onToggle={onToggle} />
          {open && (
            <div className="mt-2 rounded-xl bg-surface-sunk p-3">
              <SkipList day={day} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function DayRow({
  day,
  open,
  onToggle,
}: {
  day: ConsumptionDayView;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="align-middle">
        <td>
          <span className="font-display font-semibold">{day.businessDateLabel}</span>
          {day.postedAtLabel && (
            <span className="block text-xs text-muted-foreground">
              ตัดเมื่อ {day.postedAtLabel}
            </span>
          )}
        </td>
        <td className="text-right tabular-nums">{baht(day.netAmount)}</td>
        <td>
          <span className={CONSUMPTION_DAY_STATE_CHIP[day.state]}>
            {CONSUMPTION_DAY_STATE_LABELS_TH[day.state]}
          </span>
        </td>
        <td className="text-right tabular-nums">
          {day.coveragePercent === null ? "—" : `${day.coveragePercent}%`}
        </td>
        <td className="text-right">
          <SkipToggle day={day} open={open} onToggle={onToggle} />
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-sunk">
          <td colSpan={5} className="px-3 py-3">
            <SkipList day={day} />
          </td>
        </tr>
      )}
    </>
  );
}
