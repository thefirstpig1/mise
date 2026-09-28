"use client";

// ADR 0035 — staff meal tickets, on one screen for everyone.
//
//  - Everyone: ขอเบิกอาหารพนักงาน. The eater is the account pressing the button
//    — there is no one to pick (Q1). The date is today and the branch is the
//    account's own unless it reaches several (Q6).
//  - Everyone: ตั๋วของฉัน — big cards to show to whoever approves, whose status
//    changes on its own (the page polls, as the count sheet does).
//  - Approvers: รออนุมัติ — each ticket with the eater's quota today, and
//    อนุมัติ / ไม่อนุมัติ. Never your own (the server refuses; the button is
//    not even offered).

import { useActionState, useCallback, useEffect, useState } from "react";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import type {
  RequestStaffMealActionState,
  TicketActionState,
  TicketBoard as Board,
  TicketView,
} from "../actions";

const POLL_MS = 10_000;

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
}

const STATUS: Record<TicketView["status"], { label: string; cls: string }> = {
  PENDING: { label: "รออนุมัติ", cls: "border-warn-border bg-warn-bg text-warn" },
  APPROVED: { label: "อนุมัติแล้ว", cls: "border-good-border bg-good-bg text-good" },
  REJECTED: { label: "ไม่อนุมัติ", cls: "border-bad-border bg-bad-bg text-bad" },
};

function TicketCard({ t }: { t: TicketView }) {
  const s = STATUS[t.status];
  return (
    <li className={`rounded-xl border-2 p-4 ${s.cls.split(" ")[0]} bg-surface`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">ตั๋วเบิกอาหารพนักงาน</p>
          <p className="text-2xl font-bold tabular-nums">{t.ticketNo ?? "—"}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-medium ${s.cls}`}>{s.label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold">
        {t.menuName}
        {t.servings !== "1" && ` × ${Number(t.servings)}`}
      </p>
      <p className="text-sm text-muted-foreground">
        {t.businessDateLabel} · {t.requestedAtLabel} น. · {t.branchName} · ผู้เบิก {t.eaterName ?? "—"}
      </p>
      {t.status === "APPROVED" && (
        <p className="mt-1 text-sm text-good">
          อนุมัติโดย {t.approvedByName}
          {!t.stockPosted && " · สต๊อกตัดผ่าน POS"}
        </p>
      )}
      {t.status === "REJECTED" && (
        <p className="mt-1 text-sm text-bad">
          ไม่อนุมัติโดย {t.approvedByName} — {t.rejectedReason}
        </p>
      )}
    </li>
  );
}

function PendingRow({
  t,
  approve,
  reject,
  onDone,
}: {
  t: TicketView;
  approve: (id: string) => Promise<TicketActionState>;
  reject: (id: string, reason: string) => Promise<TicketActionState>;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (call: () => Promise<TicketActionState>) => {
    setBusy(true);
    setError(null);
    const res = await call().catch(() => ({ ok: false as const, formError: "เชื่อมต่อไม่ได้ ลองใหม่" }));
    setBusy(false);
    if (!res.ok) setError(res.formError ?? "ทำรายการไม่สำเร็จ");
    else onDone();
  };

  const q = t.quota;
  return (
    <li className="rounded-xl border border-warn-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {t.eaterName} · {t.menuName}
            {t.servings !== "1" && ` × ${Number(t.servings)}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {t.ticketNo} · {t.businessDateLabel} {t.requestedAtLabel} น. · {t.branchName}
            {t.unitPrice !== null && ` · ฿${Number(t.unitPrice) * Number(t.servings)}`}
          </p>
          {q && (
            <p className={`text-xs ${q.over ? "font-medium text-warn" : "text-muted-foreground"}`}>
              {q.quota === null
                ? `ใช้ไปวันนี้ ฿${q.used} (ร้านไม่ได้ตั้งโควตา)`
                : `โควตาวันนี้ ใช้ไป ฿${q.used} จาก ฿${q.quota}${q.over ? " — เกินแล้ว" : ""}`}
              {q.unpriced > 0 && ` · อีก ${q.unpriced} มื้อยังไม่มีราคา`}
            </p>
          )}
        </div>
        {t.isOwn ? (
          <p className="shrink-0 text-xs text-muted-foreground">ตั๋วของคุณเอง — ให้หัวหน้าคนอื่นอนุมัติ</p>
        ) : !rejecting && (
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn" disabled={busy} onClick={() => run(() => approve(t.id))}>
              {busy ? "กำลังบันทึก…" : "อนุมัติ"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(true)}
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              ไม่อนุมัติ
            </button>
          </div>
        )}
      </div>
      {rejecting && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เหตุผล เช่น เกินโควตา, เมนูนี้ไม่อยู่ในสวัสดิการ"
            className="input min-w-[14rem] flex-1 placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            disabled={busy || reason.trim() === ""}
            onClick={() => run(() => reject(t.id, reason))}
            className="rounded-lg bg-bad px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            ยืนยันไม่อนุมัติ
          </button>
          <button type="button" onClick={() => setRejecting(false)} className="px-2 text-sm text-muted-foreground">
            ยกเลิก
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </li>
  );
}

export default function TicketBoard({
  branches,
  defaultBranchId,
  menus,
  todayIso,
  canBackdate,
  initial,
  request,
  approve,
  reject,
  refresh,
}: {
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  menus: PickerProduct[];
  todayIso: string;
  canBackdate: boolean;
  initial: Board;
  request: (prev: RequestStaffMealActionState, fd: FormData) => Promise<RequestStaffMealActionState>;
  approve: (id: string) => Promise<TicketActionState>;
  reject: (id: string, reason: string) => Promise<TicketActionState>;
  refresh: () => Promise<Board>;
}) {
  const [board, setBoard] = useState(initial);
  const [state, formAction, pending] = useActionState(request, { ok: false } as RequestStaffMealActionState);
  const [submitKey, setSubmitKey] = useState(newKey);
  const [menuId, setMenuId] = useState("");
  const [branchId, setBranchId] = useState(defaultBranchId);

  const reload = useCallback(async () => {
    const next = await refresh().catch(() => null);
    if (next) setBoard(next);
  }, [refresh]);

  // A ticket just issued: show it, clear the form, mint the next key.
  useEffect(() => {
    if (!state.ok) return;
    setMenuId("");
    setSubmitKey(newKey());
    void reload();
  }, [state, reload]);

  // Status changes arrive on their own while the screen is being looked at.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";

  return (
    <div className="space-y-6">
      {board.pending && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">
            รออนุมัติ{" "}
            <span className={board.pending.length ? "text-warn" : "text-muted-foreground"}>
              {board.pending.length} ใบ
            </span>
          </h2>
          {board.pending.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface p-3 text-sm text-muted-foreground">
              ไม่มีตั๋วรออนุมัติ
            </p>
          ) : (
            <ul className="space-y-2">
              {board.pending.map((t) => (
                <PendingRow key={t.id} t={t} approve={approve} reject={reject} onDone={reload} />
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-base font-semibold">ขอเบิกอาหารพนักงาน</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          เลือกเมนูแล้วกดขอเบิก ระบบจะออกตั๋วให้ — นำตั๋วไปให้หัวหน้าหรือผู้จัดการกดอนุมัติ
        </p>
        <form action={formAction} className="mt-3 space-y-3">
          <input type="hidden" name="submit_key" value={submitKey} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="label">สาขา</span>
              {branches.length > 1 ? (
                <select
                  name="branch_id"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="input mt-1 w-full"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input type="hidden" name="branch_id" value={branchId} />
                  <p className="mt-1 py-2 text-sm">{branchName}</p>
                </>
              )}
            </div>
            <div>
              <span className="label">วันที่</span>
              {canBackdate ? (
                <input name="business_date" type="date" defaultValue={todayIso} max={todayIso} className="input mt-1 w-full" />
              ) : (
                <>
                  <input type="hidden" name="business_date" value={todayIso} />
                  <p className="mt-1 py-2 text-sm">วันนี้</p>
                </>
              )}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ticket-menu">
              เมนู
            </label>
            <ProductPicker
              products={menus}
              value={menuId}
              onChange={setMenuId}
              name="menu_id"
              inputId="ticket-menu"
              placeholder="พิมพ์ชื่อเมนู — หรือกดเพื่อดูทั้งหมดตามหมวด"
              invalid={!!fieldErrors?.menuId}
            />
            {fieldErrors?.menuId && <p className="mt-1 text-xs text-bad">{fieldErrors.menuId}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <div>
              <label className="label" htmlFor="ticket-servings">
                จำนวนที่
              </label>
              <input id="ticket-servings" name="servings" type="number" min="1" step="1" defaultValue={1} className="input mt-1 w-full" />
            </div>
            <div>
              <label className="label" htmlFor="ticket-notes">
                หมายเหตุ
              </label>
              <input
                id="ticket-notes"
                name="notes"
                maxLength={500}
                placeholder="เช่น ไม่ใส่ผัก, กินรอบบ่าย"
                className="input mt-1 w-full placeholder:text-muted-foreground/60"
              />
            </div>
          </div>
          {state.ok === false && state.formError && <p className="text-sm text-bad">{state.formError}</p>}
          <button type="submit" className="btn w-full py-3 text-base" disabled={pending || !menuId}>
            {pending ? "กำลังออกตั๋ว…" : "ขอเบิก"}
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">ตั๋วของฉัน</h2>
        {board.mine.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-3 text-sm text-muted-foreground">
            ยังไม่มีตั๋วตั้งแต่เมื่อวาน
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {board.mine.map((t) => (
              <TicketCard key={t.id} t={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
