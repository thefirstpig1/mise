"use client";

// Sprint 5 Part 25 L5 — declaring that two rows are one dish (ADR 0026).
//
// The hardest thing this form has to do is not the write. It is saying, before
// anybody presses anything, what a merge is NOT:
//
//   * It does not delete the other row. The losing menu stays alive, keeps its
//     POS code and goes on collecting sales tomorrow (Q1) — because the code is
//     unreclaimable and soft-deleting it would break the next import. A shop
//     that reads "รวมเมนู" as "ยุบเหลือรายการเดียว" will go looking for the row
//     that vanished, and then delete it by hand.
//   * It does not overwrite a recipe. A losing menu that already has one keeps
//     it (Q2), so merging can only ADD costing where there was none.
//   * It does not do the same thing to reports and to stock. Reports fold
//     retroactively and always; the ledger folds only from the effective date
//     (Q5). One date, two meanings, and the sentence under the field is the only
//     place a person ever finds that out.
//
// WHO IS THE DISH AND WHO IS THE SPELLING IS THE WHOLE DECISION, so the form
// makes it switchable and never guesses. Q7: it offers, it does not decide. The
// row a person happened to click is not evidence that it is the canonical one —
// for a multi-branch shop the duplicate exists because two branches each have a
// POS, and neither is more real than the other.
//
// The two refusals from L3a arrive here as `needsAcknowledgement`, and the
// second submit carries the flag. A tick box present from the start is a tick
// box people tick without reading.
//
// `submit_key` is minted HERE and becomes the `menu_merge` row's id (Part 13.5),
// so a double POST finds the row it already wrote instead of tripping the chain
// guard against itself. It rotates after a success: the next merge is its own
// document.

import { useActionState, useState } from "react";
import {
  MERGE_DIFFERENT_RECIPE_HINT_TH,
  MERGE_KEEPS_LOSER_HINT_TH,
  MERGE_NOT_SAME_DISH_WARNING_TH,
  MERGE_REPORT_VS_STOCK_HINT_TH,
} from "@/lib/validations/menu-merge";
import {
  mergeMenusAction,
  type MenuMergeActionState,
} from "@/app/menus/merges/actions";
import type {
  MergeCandidateRowView,
  MergeSubjectView,
} from "./menu-merge-view";

/** A fresh `submit_key` — the id the server will give the `menu_merge` row. */
function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}


export default function MergeForm({
  subject,
  candidates,
  todayIso,
}: {
  subject: MergeSubjectView;
  candidates: MergeCandidateRowView[];
  /** Today in Bangkok, from the server — never `new Date()` in the browser. */
  todayIso: string;
}) {
  const [state, formAction, isPending] = useActionState(mergeMenusAction, {
    ok: false,
  } as MenuMergeActionState);

  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  const [otherId, setOtherId] = useState<string | null>(null);
  /** false = the menu on screen is the spelling (the ordinary case). */
  const [subjectIsWinner, setSubjectIsWinner] = useState(false);
  const [handled, setHandled] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso);

  const succeeded = state.ok === true;
  if (succeeded && !handled) {
    setHandled(true);
    setSubmitKey(newSubmitKey());
    setOtherId(null);
  }
  if (!succeeded && handled) setHandled(false);

  const other = candidates.find((c) => c.id === otherId) ?? null;
  const winner = subjectIsWinner ? subject : other;
  const loser = subjectIsWinner ? other : subject;

  // The same two rules `mergeMenusLogic` enforces, asked of the pair the person
  // has actually assembled. The server refuses anyway; this is so a blocked
  // combination never reaches a button that looks pressable.
  const blocked =
    (loser?.blockedAsLoserReason ?? null) ??
    (winner?.blockedAsWinnerReason ?? null);

  const needsAck = state.ok ? undefined : state.needsAcknowledgement;
  const backdateAck =
    needsAck !== undefined && needsAck.kind === "backdate" ? needsAck : undefined;
  const formError = state.ok ? undefined : state.formError;
  const fieldErrors = state.ok ? undefined : state.fieldErrors;
  const existingMerge = state.ok ? undefined : state.existingMerge;

  const isBackdated = effectiveFrom < todayIso;

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p className="font-medium">ไม่พบเมนูที่ชื่อใกล้เคียงกับรายการนี้</p>
        <p className="mt-1 text-muted-foreground">
          ถ้ารู้ว่าซ้ำกับเมนูไหน ให้เปิดจากเมนูนั้นแทน — ระบบค้นจากความคล้ายของชื่อ
          เมนูที่ตั้งชื่อไว้คนละแบบจึงอาจไม่ขึ้นในรายการนี้
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="submit_key" value={submitKey} />
      <input type="hidden" name="losing_menu_id" value={loser?.id ?? ""} />
      <input type="hidden" name="winning_menu_id" value={winner?.id ?? ""} />
      {/* Only after the server has refused once and named the days at stake. */}
      {backdateAck ? (
        <input type="hidden" name="acknowledge_backdate" value="on" />
      ) : null}

      {/* ---------- the pair ---------- */}
      <div>
        <p className="text-sm font-medium">เมนูนี้ซ้ำกับรายการไหน</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {MERGE_NOT_SAME_DISH_WARNING_TH}
        </p>

        <ul className="mt-3 space-y-1">
          {candidates.map((c) => {
            const unusable = subjectIsWinner
              ? c.blockedAsLoserReason
              : c.blockedAsWinnerReason;
            return (
              <li key={c.id}>
                <label
                  className={`flex flex-wrap items-baseline gap-2 rounded-lg border p-2 text-sm ${
                    otherId === c.id ? "border-primary bg-primary/5" : "border-border"
                  } ${unusable ? "opacity-60" : "cursor-pointer"}`}
                >
                  <input
                    type="radio"
                    name="candidate"
                    value={c.id}
                    checked={otherId === c.id}
                    disabled={unusable !== null}
                    onChange={() => setOtherId(c.id)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium">{c.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.originLabel} · {c.badge}
                  </span>
                  {c.isPosStub ? (
                    <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[10px]">
                      รอตรวจ
                    </span>
                  ) : null}
                  {unusable ? (
                    <span className="w-full text-xs text-warn">{unusable}</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ---------- which one is the dish ---------- */}
      <div className="rounded-lg border border-border bg-background p-3">
        <p className="text-sm font-medium">รายการไหนคือเมนูหลัก</p>
        <p className="mt-1 text-xs text-muted-foreground">
          เมนูหลักคือชื่อที่ทุกหน้าจะใช้เรียกจานนี้ อีกรายการจะกลายเป็น
          “ชื่อที่รวมแล้ว” — ทั้งคู่ยังอยู่ในระบบเหมือนเดิม
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="which_is_winner"
              checked={!subjectIsWinner}
              onChange={() => setSubjectIsWinner(false)}
              className="h-4 w-4"
            />
            {other ? other.label : "รายการที่เลือกด้านบน"}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="which_is_winner"
              checked={subjectIsWinner}
              onChange={() => setSubjectIsWinner(true)}
              className="h-4 w-4"
            />
            {subject.label}
          </label>
        </div>
        {winner && loser ? (
          <p className="mt-2 text-xs">
            <strong>{loser.label}</strong> จะถูกนับเป็น{" "}
            <strong>{winner.label}</strong>
          </p>
        ) : null}
      </div>

      {/* ---------- the date that means two things ---------- */}
      <div>
        <label className="text-sm font-medium">
          มีผลกับการตัดสต๊อกตั้งแต่
          <input
            type="date"
            name="effective_from"
            value={effectiveFrom}
            max={todayIso}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className={"input mt-1 block"}
          />
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {MERGE_REPORT_VS_STOCK_HINT_TH}
        </p>
        {isBackdated ? (
          <p className="mt-1 text-xs text-warn">
            วันที่ย้อนหลัง — ถ้าย้อนไปถึงวันที่ตัดสต๊อกไปแล้ว
            ระบบจะบอกก่อนว่ากี่วัน แล้วให้ยืนยันอีกครั้ง
          </p>
        ) : null}
        {fieldErrors?.effectiveFrom ? (
          <p className="mt-1 text-xs text-bad">{fieldErrors.effectiveFrom}</p>
        ) : null}
      </div>

      {/* ---------- what a merge is not ---------- */}
      <div className="space-y-1 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        <p>{MERGE_KEEPS_LOSER_HINT_TH}</p>
        <p>{MERGE_DIFFERENT_RECIPE_HINT_TH}</p>
      </div>

      {/* ---------- refusals ---------- */}
      {fieldErrors?.losingMenuId ? (
        <p className="text-sm text-bad">
          {fieldErrors.losingMenuId}
          {existingMerge ? (
            <a href="/menus/merges" className="ml-1 underline">
              ดูการรวมที่มีอยู่ →
            </a>
          ) : null}
        </p>
      ) : null}
      {fieldErrors?.winningMenuId ? (
        <p className="text-sm text-bad">{fieldErrors.winningMenuId}</p>
      ) : null}

      {formError ? (
        <div
          className={`rounded-lg border p-3 text-sm ${
            needsAck
              ? "border-warn-border bg-warn-bg text-warn"
              : "border-bad-border bg-bad-bg text-bad"
          }`}
        >
          <p>{formError}</p>
          {backdateAck ? (
            <p className="mt-1 text-xs">
              วันแรกที่กระทบคือ {backdateAck.earliestBusinessDate} — ถ้าต้องการให้ยอด
              ของวันเหล่านั้นตรงด้วย ต้องไปยกเลิกการตัดสต๊อกแล้วโพสต์ใหม่ที่หน้าตัดสต๊อก
            </p>
          ) : null}
        </div>
      ) : null}

      {blocked ? <p className="text-sm text-warn">{blocked}</p> : null}

      {succeeded ? (
        <p className="text-sm text-good">
          รวมแล้ว — ทุกหน้าจะนับสองรายการนี้เป็นเมนูเดียวตั้งแต่ตอนนี้
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending || other === null || blocked !== null}
        className="btn"
      >
        {isPending
          ? "กำลังรวม…"
          : backdateAck
            ? "เข้าใจแล้ว — รวมย้อนหลังตามวันที่เลือก"
            : "รวมเป็นเมนูเดียว"}
      </button>
    </form>
  );
}
