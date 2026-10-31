"use client";

// ADR 0037 Q5 — "ค้างคืนพนักงาน" (mockup L7p9q52ENkn1cwKUPYCwSm, desktop).
// People on the left, ordered by what the shop owes them; the chosen person's
// bills on the right with their proof. Only bills whose proof is complete can
// be ticked, and one repayment covers the ticked bills of ONE person with one
// slip. A cash bill with no slip is endorsed case by case, with a reason kept
// (Kong: "ให้บัญชีตัดสินใจว่ามีความน่าเชื่อถือแค่ไหน case by case").

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, Portal, useTopLayer, type ConfirmSpec } from "@/app/(app)/menus/_components/sheet-parts";
import { orStale } from "@/lib/stale-tab";
import { PAYMENT_METHOD_LABEL, baht, monthLabel, shortDate } from "@/lib/advance-labels";
import type { ClaimView } from "@/server/staff-advance";
import { MissingPhoto, PhotoButton, PhotoThumb, StatusChip } from "./claim-parts";
import { approveClaimAction, endorseClaimAction, refundClaimsAction, voidRefundAction } from "../actions";

type Tab = "open" | "refunded";
const daysSince = (ymd: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);

export default function AdvancesBoard({ claims, today, months, meId, canApprove }: { claims: ClaimView[]; today: string; months: string[]; meId: string; canApprove: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("open");
  const [personId, setPersonId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [endorsing, setEndorsing] = useState<ClaimView | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [ask, setAsk] = useState<ConfirmSpec | null>(null);
  const [voiding, setVoiding] = useState<{ id: string; who: string; amount: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [month, setMonth] = useState(months[0]);
  const [, startRefresh] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const open = useMemo(() => claims.filter((c) => c.status !== "REFUNDED"), [claims]);
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; branches: Set<string>; amount: number; count: number; oldest: string }>();
    for (const c of open) {
      const p = m.get(c.payer.id) ?? { id: c.payer.id, name: c.payer.name, branches: new Set<string>(), amount: 0, count: 0, oldest: c.billDate };
      p.amount += c.amount;
      p.count += 1;
      p.branches.add(c.branchName);
      if (c.billDate < p.oldest) p.oldest = c.billDate;
      m.set(c.payer.id, p);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [open]);
  const person = people.find((p) => p.id === personId) ?? people[0] ?? null;
  const rows = person ? open.filter((c) => c.payer.id === person.id).sort((a, b) => a.billDate.localeCompare(b.billDate)) : [];

  // A person's READY bills start ticked — the usual case is "pay them everything that is ready".
  useEffect(() => {
    setPicked(new Set(rows.filter((r) => r.status === "READY").map((r) => r.paymentId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person?.id, claims]);

  const sum = (cs: ClaimView[]) => cs.reduce((s, c) => s + c.amount, 0);
  const tiles = [
    { k: "ค้างคืนทั้งหมด", v: sum(open), s: `${people.length} คน · ${open.length} บิล` },
    { k: "พร้อมคืน (หลักฐานครบ)", v: sum(open.filter((c) => c.status === "READY")), s: `${open.filter((c) => c.status === "READY").length} บิล` },
    {
      k: "รอคุณรับรอง / อนุมัติ",
      v: sum(open.filter((c) => c.status === "NEEDS_ENDORSE" || c.status === "NEEDS_APPROVAL")),
      s: `${open.filter((c) => c.status === "NEEDS_ENDORSE" || c.status === "NEEDS_APPROVAL").length} บิล — ตรวจก่อนคืน`,
    },
    {
      k: "ขาดหลักฐาน",
      v: sum(open.filter((c) => c.status === "NO_BILL" || c.status === "NO_SLIP")),
      s: `${open.filter((c) => c.status === "NO_BILL" || c.status === "NO_SLIP").length} บิล — พนักงานต้องถ่ายเพิ่ม`,
    },
  ];
  const pickedRows = rows.filter((r) => picked.has(r.paymentId));
  const refunded = useMemo(() => {
    const m = new Map<string, { id: string; at: string; method: ClaimView["method"]; who: string; slipIds: string[]; claims: ClaimView[] }>();
    for (const c of claims) {
      if (!c.refund) continue;
      const r = m.get(c.refund.id) ?? { id: c.refund.id, at: c.refund.at, method: c.refund.method, who: c.payer.name, slipIds: c.refund.slipIds, claims: [] };
      r.claims.push(c);
      m.set(c.refund.id, r);
    }
    return [...m.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [claims]);

  const after = (res: { ok: true; message?: string } | { ok: false; formError: string }, fallback: string) => {
    if (!res.ok) return setToast(res.formError);
    setToast(res.message ?? fallback);
    startRefresh(() => router.refresh());
  };

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">ค้างคืนพนักงาน</h2>
          <p className="mt-1 text-sm text-muted-foreground">เงินที่พนักงานออกไปก่อนและร้านยังไม่ได้คืน · เรียงตามยอด</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label="แสดง">
            <button type="button" onClick={() => setTab("open")} className={`seg-item ${tab === "open" ? "is-on" : ""}`}>
              ค้างคืน
            </button>
            <button type="button" onClick={() => setTab("refunded")} className={`seg-item ${tab === "refunded" ? "is-on" : ""}`}>
              คืนแล้ว
            </button>
          </div>
          <span className="flex items-center gap-1.5">
            <select className="input h-9 w-auto py-0 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="เดือน">
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <a href={`/api/advances/export?month=${month}`} className="btn-secondary btn-sm" title="บิล สลิป และสลิปคืนเงินของเดือนนี้ จัดโฟลเดอร์ต่อบิล พร้อมไฟล์ Excel สรุป">
              ⬇ รูปทั้งเดือน (.zip)
            </a>
          </span>
        </div>
      </div>

      {tab === "open" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.k} className="card space-y-0.5 p-4">
                <p className="text-sm text-muted-foreground">{t.k}</p>
                <p className="text-2xl font-semibold tabular-nums">{baht(t.v)}</p>
                <p className="text-xs text-muted-subtle">{t.s}</p>
              </div>
            ))}
          </div>

          {people.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">ไม่มีเงินที่ค้างคืนพนักงาน</p>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
              <section className="card space-y-1 p-3">
                <h3 className="px-2 pb-1 font-semibold">ต่อคน</h3>
                {people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPersonId(p.id)}
                    className={`grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors ${p.id === person?.id ? "border-border-strong bg-primary-soft" : "border-transparent hover:bg-muted/50"}`}
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-full border border-border bg-surface-sunk font-display font-semibold text-primary">{p.name.slice(0, 1)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[...p.branches].join(" · ")} · เก่าสุด {daysSince(p.oldest, today) === 0 ? "วันนี้" : `${daysSince(p.oldest, today)} วัน`}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{baht(p.amount)}</span>
                  </button>
                ))}
              </section>

              {person && (
                <section className="card min-w-0 space-y-3 p-4">
                  <h3 className="font-semibold">
                    {person.name} · {baht(person.amount)} · {person.count} บิล
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="data-table w-full min-w-[560px]">
                      <thead>
                        <tr>
                          <th className="w-8"></th>
                          <th>บิล</th>
                          <th>หลักฐาน</th>
                          <th>สถานะ</th>
                          <th className="text-right">ยอด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.paymentId}>
                            <td>
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary"
                                disabled={r.status !== "READY"}
                                checked={picked.has(r.paymentId)}
                                onChange={(e) =>
                                  setPicked((s) => {
                                    const n = new Set(s);
                                    if (e.target.checked) n.add(r.paymentId);
                                    else n.delete(r.paymentId);
                                    return n;
                                  })
                                }
                                aria-label={`เลือก ${r.what}`}
                              />
                            </td>
                            <td>
                              {r.what}
                              <span className="block text-xs text-muted-foreground">
                                {shortDate(r.billDate)} · {r.place} · {PAYMENT_METHOD_LABEL[r.method]}
                                {r.noSlipReason ? ` · “${r.noSlipReason}”` : ""}
                              </span>
                            </td>
                            <td>
                              <span className="flex gap-1">
                                {r.billPhotoIds.length ? r.billPhotoIds.slice(0, 2).map((id) => <PhotoThumb key={id} id={id} label="บิล" size="sm" />) : <MissingPhoto label="บิล" size="sm" />}
                                {r.slipIds.length ? r.slipIds.slice(0, 1).map((id) => <PhotoThumb key={id} id={id} label="สลิป" size="sm" />) : <MissingPhoto label="—" size="sm" />}
                              </span>
                            </td>
                            <td>
                              {r.status === "NEEDS_ENDORSE" && r.payer.id !== meId ? (
                                <button type="button" className="btn-secondary btn-sm" onClick={() => setEndorsing(r)}>
                                  รับรอง…
                                </button>
                              ) : r.status === "NEEDS_APPROVAL" && canApprove && r.payer.id !== meId ? (
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm"
                                  onClick={() =>
                                    setAsk({
                                      title: `อนุมัติบิล ${baht(r.amount)}?`,
                                      lines: [`${r.what} · ${shortDate(r.billDate)} · ${r.place}`],
                                      money: null,
                                      who: `อนุมัติแล้วบิลนี้เข้าคิวคืนเงิน${r.payer.name}`,
                                      go: "อนุมัติ",
                                      onGo: async () => after(await orStale(approveClaimAction({ paymentId: r.paymentId })), "อนุมัติแล้ว"),
                                    })
                                  }
                                >
                                  อนุมัติ…
                                </button>
                              ) : (
                                <StatusChip status={r.status} />
                              )}
                            </td>
                            <td className="text-right tabular-nums">{baht(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                    <span>
                      เลือก {pickedRows.length} บิล · <b className="tabular-nums">{baht(sum(pickedRows))}</b>
                      <span className="text-muted-subtle"> · บิลที่ยังไม่พร้อมคืนเลือกไม่ได้</span>
                    </span>
                    {person.id === meId ? (
                      <span className="text-xs text-muted-foreground">เป็นบิลของคุณเอง — ให้คนอื่นคืนเงินให้</span>
                    ) : (
                      <button type="button" className="btn" disabled={pickedRows.length === 0} onClick={() => setRefunding(true)}>
                        คืนเงิน{person.name} {baht(sum(pickedRows))} · แนบสลิปโอนคืน
                      </button>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      ) : refunded.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">ยังไม่มีการคืนเงินใน 60 วันที่ผ่านมา</p>
      ) : (
        <ul className="space-y-2">
          {refunded.map((r) => (
            <li key={r.id} className="card flex flex-wrap items-center gap-3 p-4">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {r.who} · {baht(sum(r.claims))}
                </span>
                <span className="block text-xs text-muted-foreground">
                  คืนเมื่อ {shortDate(new Date(new Date(r.at).getTime() + 7 * 3600_000).toISOString().slice(0, 10))} · {PAYMENT_METHOD_LABEL[r.method]} · {r.claims.length} บิล:{" "}
                  {r.claims.map((c) => c.what).join(", ")}
                </span>
              </span>
              <span className="flex gap-1">
                {r.slipIds.length ? r.slipIds.map((id) => <PhotoThumb key={id} id={id} label="สลิปคืนเงิน" size="sm" />) : <MissingPhoto label="—" size="sm" />}
              </span>
              <button type="button" className="text-xs text-muted-foreground underline hover:text-bad" onClick={() => setVoiding({ id: r.id, who: r.who, amount: sum(r.claims) })}>
                ยกเลิกการคืนเงิน
              </button>
            </li>
          ))}
        </ul>
      )}

      {endorsing && (
        <TextDialog
          title={`รับรองบิลเงินสด ${baht(endorsing.amount)}`}
          lines={[`${endorsing.what} · ${shortDate(endorsing.billDate)} · ${endorsing.place}`, endorsing.noSlipReason ? `เหตุผลที่ไม่มีสลิป: “${endorsing.noSlipReason}”` : "ไม่ได้ให้เหตุผล"]}
          photos={endorsing.billPhotoIds}
          label="บันทึกเหตุผลที่รับรอง (เก็บไว้ให้ตรวจย้อนหลัง)"
          placeholder="เช่น ราคาตรงกับตลาด รูปบิลชัด"
          go="รับรอง"
          onClose={() => setEndorsing(null)}
          onGo={async (note) => {
            const c = endorsing;
            setEndorsing(null);
            after(await orStale(endorseClaimAction({ paymentId: c.paymentId, note })), "รับรองแล้ว");
          }}
        />
      )}
      {voiding && (
        <TextDialog
          title={`ยกเลิกการคืนเงิน${voiding.who} ${baht(voiding.amount)}?`}
          lines={["บิลทั้งหมดในการคืนเงินนี้กลับไปเป็น “รอคืนเงิน” · ประวัติยังอยู่ ไม่ถูกลบ"]}
          photos={[]}
          label="เหตุผล"
          placeholder="เช่น โอนผิดคน"
          go="ยกเลิกการคืนเงิน"
          required
          onClose={() => setVoiding(null)}
          onGo={async (reason) => {
            const v = voiding;
            setVoiding(null);
            after(await orStale(voidRefundAction({ refundId: v.id, reason })), "ยกเลิกการคืนเงินแล้ว");
          }}
        />
      )}
      {refunding && person && (
        <RefundDialog
          who={person.name}
          claims={pickedRows}
          today={today}
          onClose={() => setRefunding(false)}
          onError={setToast}
          onGo={async (input) => {
            const res = await orStale(refundClaimsAction({ ...input, paymentIds: pickedRows.map((r) => r.paymentId) }));
            if (res.ok) setRefunding(false);
            after(res, "คืนเงินแล้ว");
          }}
        />
      )}
      {ask && <ConfirmDialog spec={ask} onClose={() => setAsk(null)} />}
      {toast && (
        <Portal>
          <div role="status" className="fixed inset-x-0 bottom-6 z-[70] mx-auto w-fit max-w-[90vw] animate-pop-in rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg">
            {toast}
          </div>
        </Portal>
      )}
    </div>
  );
}

function DialogFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useTopLayer(onClose);
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] grid place-items-center p-4">
        <div className="absolute inset-0 animate-fade-in bg-black/25" onMouseDown={onClose} aria-hidden />
        <div role="dialog" aria-modal="true" aria-label={title} className="relative w-full max-w-md animate-pop-in space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-2xl">
          <h3 className="text-lg font-semibold">{title}</h3>
          {children}
        </div>
      </div>
    </Portal>
  );
}

function TextDialog({
  title,
  lines,
  photos,
  label,
  placeholder,
  go,
  required,
  onClose,
  onGo,
}: {
  title: string;
  lines: string[];
  photos: string[];
  label: string;
  placeholder: string;
  go: string;
  required?: boolean;
  onClose: () => void;
  onGo: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <DialogFrame title={title} onClose={onClose}>
      <ul className="space-y-1 text-sm">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((id) => (
            <PhotoThumb key={id} id={id} label="บิล" />
          ))}
        </div>
      )}
      <label className="block space-y-1">
        <span className="text-sm font-semibold">{label}</span>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          กลับ
        </button>
        <button type="button" className="btn" disabled={required && !text.trim()} onClick={() => onGo(text)}>
          {go}
        </button>
      </div>
    </DialogFrame>
  );
}

function RefundDialog({
  who,
  claims,
  today,
  onClose,
  onError,
  onGo,
}: {
  who: string;
  claims: ClaimView[];
  today: string;
  onClose: () => void;
  onError: (m: string) => void;
  onGo: (input: { method: "TRANSFER" | "CASH"; refundedOn: string; note: string | null; slipFileIds: string[] }) => Promise<void>;
}) {
  const [method, setMethod] = useState<"TRANSFER" | "CASH">("TRANSFER");
  const [on, setOn] = useState(today);
  const [slips, setSlips] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const total = claims.reduce((s, c) => s + c.amount, 0);
  return (
    <DialogFrame title={`คืนเงิน${who} ${baht(total)}`} onClose={onClose}>
      <ul className="max-h-32 space-y-0.5 overflow-y-auto text-sm">
        {claims.map((c) => (
          <li key={c.paymentId} className="flex justify-between gap-3">
            <span className="truncate">
              {shortDate(c.billDate)} · {c.what}
            </span>
            <span className="tabular-nums">{baht(c.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="seg" role="group" aria-label="วิธีคืนเงิน">
        <button type="button" onClick={() => setMethod("TRANSFER")} className={`seg-item ${method === "TRANSFER" ? "is-on" : ""}`}>
          โอน
        </button>
        <button type="button" onClick={() => setMethod("CASH")} className={`seg-item ${method === "CASH" ? "is-on" : ""}`}>
          เงินสด
        </button>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">วันที่คืน</span>
        <input type="date" className="input" max={today} value={on} onChange={(e) => e.target.value && setOn(e.target.value)} />
      </label>
      <div className="space-y-1">
        <span className="text-sm font-semibold">สลิปโอนคืน{method === "TRANSFER" ? "" : " (ถ้ามี)"}</span>
        <div className="flex flex-wrap items-center gap-2">
          {slips.map((id) => (
            <PhotoThumb key={id} id={id} label="สลิปคืนเงิน" />
          ))}
          <PhotoButton kind="REFUND_SLIP" label={slips.length ? "＋ อีกรูป" : "แนบสลิป"} onUploaded={(r) => setSlips((s) => [...s, r.file.id])} onError={onError} />
        </div>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">หมายเหตุ</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ไม่บังคับ" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          กลับ
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || (method === "TRANSFER" && slips.length === 0)}
          onClick={async () => {
            setBusy(true);
            await onGo({ method, refundedOn: on, note: note.trim() || null, slipFileIds: slips });
            setBusy(false);
          }}
        >
          {busy ? "กำลังบันทึก…" : `บันทึกการคืนเงิน ${baht(total)}`}
        </button>
      </div>
      {method === "TRANSFER" && slips.length === 0 && <p className="text-right text-xs text-muted-foreground">โอนคืนต้องแนบสลิปก่อน</p>}
    </DialogFrame>
  );
}
