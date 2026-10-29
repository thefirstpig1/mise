"use client";

// ADR 0040 step 7 — หน้า "การผลิต" (mockup 5rcGTWvS3qBw5dNUhoLxa6).
// What was made at the branch, newest first, grouped by day; a document the
// SYSTEM wrote (from a count, a waste, a transfer) says where it came from and
// links there. The "ระบบตัดแทน" card shows only prepped items somebody recorded
// making in the last 30 days (Q1) — to everyone who can record (Kong: "เอาตาม
// แนะนำ", it carries no money). Money only for cost:view.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Portal, ConfirmDialog, type ConfirmSpec, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { orStale } from "@/lib/stale-tab";
import EmptyState from "@/components/ui/EmptyState";
import type { PickableProduct, ProductionRowView, ShortfallRowView } from "@/server/production-read";
import { voidProductionAction } from "../actions";
import RecordProductionSheet from "./RecordProductionSheet";

const ORIGIN_ICON: Record<ProductionRowView["origin"], string> = {
  MANUAL: "🍲",
  STOCK_COUNT: "📋",
  WASTE: "🗑️",
  ADJUSTMENT: "✏️",
  TRANSFER: "🚚",
};
const ORIGIN_TH: Record<Exclude<ProductionRowView["origin"], "MANUAL">, string> = {
  STOCK_COUNT: "จากใบนับ",
  WASTE: "จากของเสีย",
  ADJUSTMENT: "จากการปรับสต๊อก",
  TRANSFER: "จากการโอน",
};
const WHY_SYSTEM: Record<Exclude<ProductionRowView["origin"], "MANUAL">, string> = {
  STOCK_COUNT: "นับได้มากกว่าในระบบ — ทำเพิ่มแต่ไม่ได้บันทึก",
  WASTE: "ทิ้งมากกว่าที่มี — ต้องเคยถูกทำ",
  ADJUSTMENT: "ปรับลดมากกว่าที่มี — ต้องเคยถูกทำ",
  TRANSFER: "ส่งมากกว่าที่มี — ครัวทำแต่ไม่ได้บันทึก",
};

const show = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const baht = (v: number) => `฿${v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const bkkDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const time = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
// Spelled out, not `weekday: "short"`: Node's ICU says พฤหัส where Chrome's
// says พฤ., and the heading is rendered on both — a hydration mismatch.
const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const dayTitle = (d: string, today: string) => {
  const date = new Date(`${d}T00:00:00Z`);
  const label = `${WD[date.getUTCDay()]} ${date.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  const yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  return d === today ? `วันนี้ · ${label}` : d === yesterday ? `เมื่อวาน · ${label}` : label;
};

export default function ProductionScreen({
  rows,
  shortfalls,
  costs,
  branches,
  defaultBranchId,
  make,
  trim,
  today,
  canRecord,
}: {
  rows: ProductionRowView[];
  shortfalls: ShortfallRowView[];
  /** Cost per unit per output, streamed after paint; null = no cost:view. */
  costs: Promise<Record<string, Record<string, number>>> | null;
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  make: PickableProduct[];
  trim: PickableProduct[];
  today: string;
  canRecord: boolean;
}) {
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const [costMap, setCostMap] = useState<Record<string, Record<string, number>> | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let on = true;
    // A promise handed from the server arrives as a bare thenable whose
    // `.then` returns nothing — adopt it into a real Promise before chaining.
    if (costs) void Promise.resolve(costs).then((c) => on && setCostMap(c)).catch(() => undefined);
    return () => {
      on = false;
    };
  }, [costs]);

  const days = useMemo(() => {
    const m = new Map<string, ProductionRowView[]>();
    for (const r of rows) {
      const d = bkkDay(r.producedAt);
      m.set(d, [...(m.get(d) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);

  const open = rows.find((r) => r.id === openId) ?? null;
  const multiBranch = branches.length > 1;

  const done = (message: string) => {
    setRecording(false);
    setOpenId(null);
    setToast(message);
    startRefresh(() => router.refresh());
  };

  return (
    <div className="max-w-3xl space-y-5 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">การผลิต</h2>
          <p className="mt-1 text-sm text-muted-foreground">ของแปรรูปที่ทำในครัว — บันทึกแล้วขึ้นชั้นพร้อมต้นทุนของวัตถุดิบที่ใช้ทำ</p>
        </div>
        {canRecord && (
          <button type="button" onClick={() => setRecording(true)} className="btn max-sm:hidden">
            ＋ บันทึกการผลิต
          </button>
        )}
      </div>

      {shortfalls.length > 0 && (
        <section className="space-y-1.5 rounded-2xl border border-warn-border bg-warn-bg p-4 text-sm">
          <h3 className="font-semibold text-warn">ระบบตัดแทน 30 วัน</h3>
          <ul className="space-y-0.5">
            {shortfalls.map((s) => (
              <li key={s.productId} className="flex justify-between gap-3">
                <span>{s.name}</span>
                <span className="tabular-nums">
                  {s.days} วัน · {show(s.qty)} {unitTh(s.unitName)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-warn">ขายหรือใช้มากกว่าที่บันทึกว่าทำ ระบบจึงตัดวัตถุดิบตามสูตรแทน — อาจลืมบันทึกหม้อไหน</p>
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState art="setup">
          ยังไม่มีการบันทึกการผลิตใน 30 วันที่ผ่านมา — ต้มซุปหรือแล่ปลาเสร็จ กด “บันทึกการผลิต” แล้วของจะขึ้นชั้นพร้อมต้นทุน
        </EmptyState>
      ) : (
        days.map(([d, list]) => (
          <section key={d} className="space-y-2">
            <h3 className="text-xs font-medium text-muted-subtle">{dayTitle(d, today)}</h3>
            <ul className="space-y-2">
              {list.map((r) => {
                const out = r.outputs;
                const title =
                  r.kind === "TRIM"
                    ? `แล่${r.inputs[0]?.name ?? ""} ${show(r.inputs[0]?.qty ?? 0)} ${unitTh(r.inputs[0]?.unitName)}`
                    : `${out[0]?.name ?? ""} ${show(out[0]?.qty ?? 0)} ${unitTh(out[0]?.unitName)}`;
                const sub =
                  r.kind === "TRIM"
                    ? out.map((o) => `${o.name} ${show(o.qty)}`).join(" · ")
                    : r.inputs
                        .slice(0, 2)
                        .map((i) => `${i.name} ${show(i.qty)} ${unitTh(i.unitName)}`)
                        .join(" · ") + (r.inputs.length > 2 ? ` · +${r.inputs.length - 2}` : "");
                const perUnit = r.kind === "PRODUCE" && out[0] ? costMap?.[r.id]?.[out[0].productId] : undefined;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(r.id)}
                      className={`grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border p-3 text-left transition-colors hover:bg-muted/50 ${r.voided ? "bg-muted/30 text-muted-foreground" : "bg-surface"}`}
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-surface-sunk text-lg" aria-hidden>
                        {ORIGIN_ICON[r.origin]}
                      </span>
                      <span className="min-w-0">
                        <span className={`block font-medium ${r.voided ? "line-through" : ""}`}>{title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-subtle">
                          {r.origin !== "MANUAL" && <span className="chip">{`${ORIGIN_TH[r.origin]} ${r.originLabel ?? ""}`}</span>}
                          {r.inputsUnconfirmed && !r.voided && <span className="chip chip-warn">ไม่ได้ยืนยันวัตถุดิบ</span>}
                          {r.voided && <span className="chip chip-bad">ยกเลิกแล้ว</span>}
                          <span>
                            {time(r.producedAt)} · {r.recordedBy} · {r.pdNumber}
                            {multiBranch ? ` · ${r.branchName}` : ""}
                          </span>
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground">
                        {r.kind === "TRIM"
                          ? `${out.length} ส่วน`
                          : costs === null
                            ? ""
                            : perUnit !== undefined
                              ? `${baht(perUnit)}/${unitTh(out[0]?.unitName)}`
                              : costMap === null && !r.voided
                                ? "…"
                                : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {canRecord && (
        <div className="fixed inset-x-4 bottom-4 z-30 sm:hidden">
          <button type="button" onClick={() => setRecording(true)} className="btn h-12 w-full shadow-card">
            ＋ บันทึกการผลิต
          </button>
        </div>
      )}

      {recording && (
        <RecordProductionSheet
          branches={branches}
          defaultBranchId={defaultBranchId}
          make={make}
          trim={trim}
          today={today}
          costHidden={costs === null}
          onClose={() => setRecording(false)}
          onDone={done}
        />
      )}

      {open && (
        <ProductionDetail
          row={open}
          perUnit={costMap?.[open.id] ?? null}
          costHidden={costs === null}
          canVoid={canRecord}
          onClose={() => setOpenId(null)}
          onDone={done}
          onError={setToast}
        />
      )}

      {toast && (
        <Portal>
          <div role="status" className="fixed bottom-20 left-1/2 z-[80] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-card sm:bottom-6">
            {toast}
          </div>
        </Portal>
      )}
    </div>
  );
}

function ProductionDetail({
  row,
  perUnit,
  costHidden,
  canVoid,
  onClose,
  onDone,
  onError,
}: {
  row: ProductionRowView;
  perUnit: Record<string, number> | null;
  costHidden: boolean;
  canVoid: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  useTopLayer(onClose);
  const [ask, setAsk] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const askVoid = () =>
    setAsk({
      title: `ยกเลิก ${row.pdNumber}?`,
      lines: [
        ...row.outputs.map((o) => `นำ${o.name} ${show(o.qty)} ${unitTh(o.unitName)} ออกจากชั้น`),
        ...row.inputs.map((i) => `คืน${i.name} ${show(i.qty)} ${unitTh(i.unitName)}`),
      ],
      money: null,
      who: "ใบผลิตไม่ถูกลบ ยังเห็นในรายการพร้อมป้ายยกเลิก · วันขายที่ใช้ของจากใบนี้ ระบบตัดสต๊อกใหม่ให้เอง",
      go: "ยกเลิกใบผลิต",
      onGo: async () => {
        setBusy(true);
        const res = await orStale(voidProductionAction({ id: row.id }));
        setBusy(false);
        if (!res.ok) return onError(res.formError);
        const reposted = res.reposted.filter((r) => r.outcome === "REPOSTED").length;
        onDone(`ยกเลิก ${row.pdNumber} แล้ว${reposted ? ` · ตัดสต๊อกของวันขายใหม่ ${reposted} วัน` : ""}`);
      },
    });

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 animate-fade-in bg-black/25" onMouseDown={onClose} aria-hidden />
        <div role="dialog" aria-modal="true" aria-labelledby="pd-detail-title" className="relative w-full max-w-md animate-pop-in space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 id="pd-detail-title" className="text-lg font-semibold">
                {row.pdNumber}
              </h3>
              <p className="text-xs text-muted-foreground">
                {new Date(row.producedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })} · {row.branchName} ·{" "}
                {row.recordedBy}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-2 text-xl text-muted-foreground hover:bg-muted" aria-label="ปิด">
              ×
            </button>
          </div>

          {row.origin !== "MANUAL" && (
            <p className="rounded-xl border border-border bg-surface-sunk p-3 text-sm">
              ระบบเขียนใบนี้ให้ — {WHY_SYSTEM[row.origin]}
              {row.originHref && (
                <>
                  {" · "}
                  <a href={row.originHref} className="text-primary underline decoration-dotted underline-offset-4">
                    ดู{row.originLabel}
                  </a>
                </>
              )}
            </p>
          )}
          {row.inputsUnconfirmed && (
            <p className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">ไม่ได้ยืนยันวัตถุดิบ — ตอนนับไม่ได้นับวัตถุดิบหลักในใบเดียวกัน ระบบตัดตามสูตร</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-subtle">ใช้</p>
              <ul className="space-y-0.5 text-sm">
                {row.inputs.map((i) => (
                  <li key={i.productId} className="flex justify-between gap-2">
                    <span>{i.name}</span>
                    <span className="tabular-nums">
                      {show(i.qty)} {unitTh(i.unitName)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-subtle">ได้</p>
              <ul className="space-y-0.5 text-sm">
                {row.outputs.map((o) => (
                  <li key={o.productId} className="flex justify-between gap-2">
                    <span>{o.name}</span>
                    <span className="tabular-nums">
                      {show(o.qty)} {unitTh(o.unitName)}
                      {!costHidden && perUnit?.[o.productId] !== undefined && (
                        <span className="block text-xs text-muted-foreground">{baht(perUnit[o.productId])}/{unitTh(o.unitName)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {row.voided ? (
            <p className="text-sm text-bad">ยกเลิกแล้ว{row.voidReason ? ` — ${row.voidReason}` : ""}</p>
          ) : (
            canVoid && (
              <div className="flex justify-end">
                <button type="button" onClick={askVoid} disabled={busy} className="btn-danger btn-sm">
                  {busy ? "กำลังยกเลิก…" : "ยกเลิกใบผลิต"}
                </button>
              </div>
            )
          )}
        </div>
      </div>
      {ask && <ConfirmDialog spec={ask} onClose={() => setAsk(null)} />}
    </Portal>
  );
}

