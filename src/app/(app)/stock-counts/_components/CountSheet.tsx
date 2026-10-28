"use client";

import { orStale } from "@/lib/stale-tab";

// ADR 0034 — the count sheet, counted by many devices at once.
//
// Kong's flow: one host opens the sheet; everyone else opens the app and joins
// it. Every product is a row with its own ยืนยัน; a confirmed row turns green on
// EVERY device with the counter's name, so whoever is walking can see at a
// glance what is left. The host (or an owner / manager / head of department)
// closes the sheet when the shelves are done.
//
// What this component owns:
//  1. **No page reloads while counting.** A row sends its count and the sheet
//     takes the returned state; the old full re-render cost 1–2 s per press.
//  2. **Polling** every 5 s while the tab is visible, and at once when it comes
//     back — how other devices' green reaches this one (Q7).
//  3. **Blind counting** (ADR 0015 Q7): with `showExpected` off, the expected
//     and variance figures are not rendered at all.
//  4. **The partial-count warning** at close. It never blocks — a partial count
//     is the normal case, and only the person closing knows why.
//  5. **A phone in one hand** (Kong 2026-10-27, mockup NBRTCZ2dkWty1n4fu7nUw4):
//     the header, progress and filters stay on screen while the list scrolls,
//     the help folds to one line, and closing is a bar at the bottom that opens
//     a sheet saying what closing does — not a form after the last row.

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StockCountActionState } from "../actions";
import StatusBadge from "./StatusBadge";
import CountRow, { type CountProduct, type RowSubmit } from "./CountRow";
import { formatMoney, formatQty } from "./stock-count-view";
import type { StockCountDetailView } from "./stock-count-view";
import { readApi } from "@/lib/read-api";
import EmptyState from "@/components/ui/EmptyState";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";

const POLL_MS = 5_000;
const NO_CATEGORY = "ไม่มีหมวด";
type Show = "all" | "todo" | "done";

const chip = (active: boolean, small = false) =>
  `pill ${small ? "h-7 px-2.5 text-xs" : ""} ${active ? "is-on" : ""}`;

/** The poll (ADR 0034 Q7) — a GET, so it never queues behind this device's saves (§5c). */
async function poll(countId: string): Promise<StockCountDetailView | null> {
  const r = await readApi<{ ok: true; detail: StockCountDetailView | null }>("/api/stock-counts", "sheet", countId);
  return r.ok ? r.detail : null;
}

export default function CountSheet({
  initial,
  products,
  costByProduct,
  stockedProductIds,
  currentUserId,
  canCloseAny,
  confirmCount,
  editContribution,
  deleteContribution,
  removeLine,
  close,
  voidCount,
}: {
  initial: StockCountDetailView;
  products: CountProduct[];
  /**
   * Cost per base unit, as a string, for valuing a variance (ADR 0015 Q4).
   * `null` for a reader without cost:view — the money card is not shown.
   */
  costByProduct: Record<string, string> | null;
  /** Products holding stock at this branch — for the "not counted" warning at close. */
  stockedProductIds: string[];
  currentUserId: string;
  canCloseAny: boolean;
  confirmCount: (input: {
    stockCountId: string;
    productId: string;
    mode: "new" | "add";
    entries: { productUnitId: string; qtyInUnit: string }[];
    notes: string | null;
  }) => Promise<StockCountActionState>;
  editContribution: (input: {
    stockCountId: string;
    contributionId: string;
    entries: { productUnitId: string; qtyInUnit: string }[];
    notes: string | null;
  }) => Promise<StockCountActionState>;
  deleteContribution: (countId: string, contributionId: string) => Promise<StockCountActionState>;
  removeLine: (countId: string, itemId: string) => Promise<StockCountActionState>;
  close: (prev: StockCountActionState, fd: FormData) => Promise<StockCountActionState>;
  voidCount: (prev: StockCountActionState, fd: FormData) => Promise<StockCountActionState>;
}) {
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [search, setSearch] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const [closeState, closeAction, closing] = useActionState(close, { ok: false } as StockCountActionState);
  const [voidState, voidAction, voiding] = useActionState(voidCount, { ok: false } as StockCountActionState);

  // A close or void returns the new document; adopt it.
  useEffect(() => {
    if (closeState.ok && closeState.detail) {
      setDetail(closeState.detail);
      setCloseOpen(false);
    }
  }, [closeState]);
  useEffect(() => {
    if (voidState.ok && voidState.detail) setDetail(voidState.detail);
  }, [voidState]);

  const isDraft = detail.status === "DRAFT";
  const isHost = detail.startedByUserId === currentUserId;
  const canClose = isHost || canCloseAny;

  // ---------- polling (ADR 0034 Q7) ----------
  const inFlight = useRef(0);
  const refresh = useCallback(async () => {
    // A poll that lands after a save would briefly show the older sheet; skip
    // while this device is itself writing — its own answer is newer.
    if (inFlight.current > 0) return;
    const fresh = await poll(detail.id).catch(() => null);
    if (fresh && inFlight.current === 0) setDetail(fresh);
  }, [detail.id]);

  useEffect(() => {
    if (!isDraft) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isDraft, refresh]);

  // ---------- writes ----------
  const run = async (productId: string, call: () => Promise<StockCountActionState>) => {
    inFlight.current += 1;
    setBusy((b) => new Set(b).add(productId));
    setMessages((m) => {
      const { [productId]: _drop, ...rest } = m;
      return rest;
    });
    setSheetError(null);
    try {
      const res = await orStale(call());
      if (res.detail) setDetail(res.detail);
      if (!res.ok) {
        const text =
          res.formError ??
          (res.fieldErrors ? Object.values(res.fieldErrors).join(" · ") : "บันทึกไม่สำเร็จ");
        setMessages((m) => ({ ...m, [productId]: text }));
      }
      return res.ok;
    } catch {
      setMessages((m) => ({ ...m, [productId]: "เชื่อมต่อไม่ได้ — ลองกดอีกครั้ง" }));
      return false;
    } finally {
      inFlight.current -= 1;
      setBusy((b) => {
        const next = new Set(b);
        next.delete(productId);
        return next;
      });
    }
  };

  const submitRow = (productId: string) => (s: RowSubmit) =>
    run(productId, () =>
      s.mode === "edit"
        ? editContribution({
            stockCountId: detail.id,
            contributionId: s.contributionId!,
            entries: s.entries,
            notes: s.notes,
          })
        : confirmCount({
            stockCountId: detail.id,
            productId,
            mode: s.mode,
            entries: s.entries,
            notes: s.notes,
          })
    );

  // ---------- what is on screen ----------
  const lineByProduct = useMemo(() => {
    const m = new Map<string, StockCountDetailView["items"][number]>();
    for (const i of detail.items) if (!i.isReversal) m.set(i.productId, i);
    return m;
  }, [detail.items]);

  // A line whose product was since deleted still has to show.
  const rows: CountProduct[] = useMemo(() => {
    const known = new Set(products.map((p) => p.id));
    const orphans = detail.items
      .filter((i) => !i.isReversal && !known.has(i.productId))
      .map((i) => ({
        id: i.productId,
        name: i.productName,
        sku: i.productSku,
        imageUrl: null,
        section: null,
        group: null,
        prepped: false,
        units: i.entries.map((e) => ({ id: e.unitId, unitName: e.unitName, isBase: false })),
      }));
    // A closed sheet is a record of what was counted, not a list to count from.
    return isDraft ? [...products, ...orphans] : [...products, ...orphans].filter((p) => lineByProduct.has(p.id));
  }, [products, detail.items, isDraft, lineByProduct]);

  const sectionOf = (p: CountProduct) => p.section ?? NO_CATEGORY;
  const sections = useMemo(() => {
    const s = [...new Set(rows.map(sectionOf))];
    return [...s.filter((x) => x !== NO_CATEGORY), ...s.filter((x) => x === NO_CATEGORY)];
  }, [rows]);
  const groups = useMemo(
    () =>
      section && section !== NO_CATEGORY
        ? [...new Set(rows.filter((p) => sectionOf(p) === section).map((p) => p.group ?? NO_CATEGORY))]
        : [],
    [rows, section]
  );

  const term = search.trim().toLowerCase();
  const shown = rows.filter((p) => {
    if (section && sectionOf(p) !== section) return false;
    if (group && (p.group ?? NO_CATEGORY) !== group) return false;
    const done = lineByProduct.has(p.id);
    if (show === "todo" && done) return false;
    if (show === "done" && !done) return false;
    return !term || `${p.name} ${p.sku}`.toLowerCase().includes(term);
  });

  // Kong (2026-09-28): the list is split by category, so a counter working
  // the dry store sees the dry store together — with how far through it they are.
  // Products arrive sorted account → section → group → name, so grouping in
  // order of first appearance keeps that order.
  const grouped = useMemo(() => {
    const m = new Map<string, CountProduct[]>();
    for (const p of shown) {
      const key = p.section ? `${p.section} · ${p.group ?? NO_CATEGORY}` : NO_CATEGORY;
      m.set(key, [...(m.get(key) ?? []), p]);
    }
    const entries = [...m.entries()];
    return [...entries.filter(([k]) => k !== NO_CATEGORY), ...entries.filter(([k]) => k === NO_CATEGORY)];
  }, [shown]);

  const countedCount = [...lineByProduct.keys()].length;
  // ADR 0021 Q11 — say it on screen until production is recorded.
  const preppedRows = rows.filter((p) => p.prepped);
  const preppedCounted = preppedRows.filter((p) => lineByProduct.has(p.id)).length;
  const uncountedStocked = stockedProductIds.filter((id) => !lineByProduct.has(id)).length;
  const varianceValue =
    costByProduct &&
    detail.items
      .filter((i) => !i.isReversal)
      .reduce((sum, i) => sum + Number(i.variance) * Number(costByProduct[i.productId] ?? 0), 0);

  const closeError = closeState.ok === false ? closeState.formError : undefined;
  const voidError = voidState.ok === false ? voidState.formError : undefined;

  return (
    <div className="space-y-5">
      {/* --- header + filters: stay on screen while the list scrolls --- */}
      <div className="sticky top-[3.6rem] z-20 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 pb-3 pt-2 backdrop-blur lg:top-0 lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-3">
          <a
            href="/stock-counts"
            aria-label="กลับไปรายการใบนับ"
            className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </a>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold leading-tight">
              {detail.scNumber}
              <StatusBadge status={detail.status} />
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {detail.branchName} · {detail.countDateLabel}
              {detail.startedBy && ` · เจ้าภาพ ${isHost ? "คุณ" : detail.startedBy}`}
              {!detail.showExpected && " · ไม่เห็นจำนวนในระบบ"}
            </p>
          </div>
          {isDraft && (
            <p className="shrink-0 text-right leading-none">
              <span className="text-xl font-semibold tabular-nums">{countedCount}</span>
              <span className="text-sm text-muted-foreground"> / {rows.length}</span>
              <span className="mt-1 block text-[11px] text-muted-foreground">นับแล้ว</span>
            </p>
          )}
        </div>
        {isDraft && (
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-1 rounded-full bg-good transition-[width] duration-500"
              style={{ width: `${rows.length ? (countedCount / rows.length) * 100 : 0}%` }}
            />
          </div>
        )}

        {isDraft && (
          <button
            type="button"
            onClick={() => setHelpOpen((o) => !o)}
            aria-expanded={helpOpen}
            className="block w-full text-left text-xs text-muted-foreground"
          >
            กรอกจำนวนแล้วกดยืนยัน · ไม่ได้นับไม่ต้องใส่
            {preppedRows.length > 0 && <span className="text-warn"> · ของแปรรูปส่วนต่างยังเชื่อไม่ได้</span>}{" "}
            <span className="underline">{helpOpen ? "ย่อ" : "อ่านต่อ"}</span>
          </button>
        )}
        {isDraft && helpOpen && (
          <div className="space-y-1 rounded-lg border border-warn-border bg-warn-bg p-3 text-xs text-warn">
            <p>
              ยืนยันแล้วรายการจะเป็นสีเขียวบนทุกเครื่องที่เปิดใบนี้อยู่ พร้อมชื่อคนนับ · ของที่ไม่ได้นับ ไม่ต้องใส่
            </p>
            {preppedRows.length > 0 && (
              <p>
                ของแปรรูป (ป้ายเหลือง): ระบบยังไม่มีบันทึกการผลิต ยอดในระบบจึงไม่เพิ่มตอนทำ และไม่ลดตอนขาย
                ยอดเปลี่ยนตอนนับ ลงของเสีย หรือโอนของ — <strong>นับครั้งแรกจึงขึ้นว่าเกินเสมอ</strong>
                และครั้งต่อ ๆ ไปส่วนต่างก็ไม่ได้แปลว่าของหายหรือเกิน
              </p>
            )}
          </div>
        )}

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="หมวดหมู่">
          <button type="button" className={`shrink-0 ${chip(section === null)}`} onClick={() => { setSection(null); setGroup(null); }}>
            ทั้งหมด
          </button>
          {sections.map((s) => (
            <button key={s} type="button" className={`shrink-0 whitespace-nowrap ${chip(section === s)}`} onClick={() => { setSection(s); setGroup(null); }}>
              {s}
            </button>
          ))}
        </div>
        {groups.length > 1 && (
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="หมวดย่อย">
            <button type="button" className={`shrink-0 whitespace-nowrap ${chip(group === null, true)}`} onClick={() => setGroup(null)}>
              ทุกหมวดย่อย
            </button>
            {groups.map((g) => (
              <button key={g} type="button" className={`shrink-0 whitespace-nowrap ${chip(group === g, true)}`} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อหรือรหัสสินค้า"
            aria-label="ค้นหาชื่อหรือรหัสสินค้า"
            className="input h-9 min-w-0 flex-1"
          />
          {isDraft && (
            <div className="flex shrink-0 rounded-lg bg-muted p-0.5" role="group" aria-label="สถานะการนับ">
              {(
                [
                  ["all", "ทั้งหมด"],
                  ["todo", "ยังไม่นับ"],
                  ["done", "นับแล้ว"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={show === v}
                  onClick={() => setShow(v)}
                  className={`h-8 rounded-md px-2.5 text-xs ${show === v ? "bg-surface font-semibold text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {detail.status === "VOIDED" && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          ใบนับนี้ถูกยกเลิกเมื่อ {detail.voidedAtLabel}
          {detail.voidedBy && ` โดย ${detail.voidedBy}`} — เหตุผล: {detail.voidReason}
          <span className="mt-1 block text-xs text-muted-foreground">
            รายการเดิมยังอยู่ครบ ระบบเพิ่มรายการกลับรายการเข้าไปเพื่อคืนสต๊อก
          </span>
        </div>
      )}
      {detail.status === "CLOSED" && (
        <div className="rounded-lg border border-good-border bg-good-bg p-3 text-sm text-good">
          ปิดใบแล้วเมื่อ {detail.closedAtLabel}
          {detail.closedBy && ` โดย ${detail.closedBy}`} — ส่วนต่างถูกบันทึกเข้าคลังเรียบร้อย
        </div>
      )}
      {!isDraft && preppedCounted > 0 && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          ใบนี้มีของแปรรูป {preppedCounted} รายการ — ส่วนต่างของรายการเหล่านั้นเชื่อไม่ได้
          เพราะระบบยังไม่มีบันทึกการผลิต
        </div>
      )}
      {sheetError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{sheetError}</div>
      )}

      {/* --- the rows --- */}
      {rows.length === 0 ? (
        <EmptyState art="none">{isDraft ? "ยังไม่มีวัตถุดิบในระบบ" : "ใบนี้ไม่มีรายการที่นับ"}</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState art="none">ไม่พบรายการที่ตรงกับตัวกรอง</EmptyState>
      ) : (
        <div className="space-y-5">
          {grouped.map(([heading, list]) => {
            const done = list.filter((p) => lineByProduct.has(p.id)).length;
            return (
              <section key={heading} className="space-y-2">
                <h3 className="flex items-baseline justify-between gap-3 px-1">
                  <span className="text-sm font-semibold">{heading}</span>
                  {isDraft && (
                    <span className={`text-xs tabular-nums ${done === list.length ? "font-medium text-good" : "text-muted-foreground"}`}>
                      {done === list.length ? "✓ ครบแล้ว" : `นับแล้ว ${done} / ${list.length}`}
                    </span>
                  )}
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                  {list.map((p) => (
            <CountRow
              key={p.id}
              product={p}
              item={lineByProduct.get(p.id)}
              editable={isDraft}
              showExpected={detail.showExpected}
              currentUserId={currentUserId}
              canRemoveLine={canClose}
              busy={busy.has(p.id)}
              message={messages[p.id] ?? null}
              onSubmit={submitRow(p.id)}
              onDeleteContribution={(cid) => void run(p.id, () => deleteContribution(detail.id, cid))}
              onRemoveLine={(itemId) => void run(p.id, () => removeLine(detail.id, itemId))}
            />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* --- summary (money computed, never stored — ADR 0015 Q4) --- */}
      {detail.showExpected && countedCount > 0 && (
        <div className={`grid gap-3 ${varianceValue !== null ? "sm:grid-cols-2" : ""}`}>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">ขาด / เกิน (จำนวน)</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {/* Over is warn, not good: a surplus is evidence the ledger was wrong. */}
              <span className="text-bad">−{formatQty(detail.totalShortQty)}</span>
              {" / "}
              <span className="text-warn">+{formatQty(detail.totalOverQty)}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              คนละหน่วยกัน — ดูเป็นรายรายการด้านบน
              {preppedCounted > 0 && ` · รวมของแปรรูป ${preppedCounted} รายการ ซึ่งส่วนต่างยังเชื่อไม่ได้`}
            </p>
          </div>
          {varianceValue !== null && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">มูลค่าส่วนต่าง (ประมาณ)</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${varianceValue < 0 ? "text-bad" : ""}`}>
                {formatMoney(String(varianceValue))}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">คิดจากต้นทุนล่าสุด · ตัวเลขจริงดูที่หน้าต้นทุน</p>
            </div>
          )}
        </div>
      )}

      {/* --- void --- */}
      {detail.status === "CLOSED" && canClose && (
        <div className="rounded-lg border border-border p-4">
          {!voidOpen ? (
            <button type="button" onClick={() => setVoidOpen(true)} className="text-sm text-bad hover:underline">
              ยกเลิกใบนับนี้
            </button>
          ) : (
            <form action={voidAction} className="space-y-3">
              <input type="hidden" name="id" value={detail.id} />
              <h3 className="text-sm font-medium">ยกเลิกใบนับ</h3>
              <p className="text-sm text-muted-foreground">
                ระบบจะเพิ่มรายการกลับรายการเพื่อคืนสต๊อกให้เหมือนก่อนปิดใบ รายการเดิมจะยังอยู่ครบ
              </p>
              {voidError && (
                <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{voidError}</div>
              )}
              <div>
                <label htmlFor="void_reason" className="label">
                  เหตุผล <span className="text-bad">*</span>
                </label>
                <input
                  id="void_reason"
                  name="void_reason"
                  type="text"
                  maxLength={500}
                  required
                  className="input mt-1 w-full"
                  placeholder="เช่น นับซ้ำช่องเดิม / ลืมว่ายกของไปสาขาอื่น"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={voiding}
                  className="rounded-lg bg-bad px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {voiding ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
                </button>
                <button type="button" onClick={() => setVoidOpen(false)} className="btn-secondary">
                  ไม่ยกเลิก
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* --- close (host, or count:close — ADR 0034 Q5): a bar that stays at the bottom --- */}
      {isDraft && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface/95 px-4 pb-3 pt-2.5 backdrop-blur lg:-mx-8 lg:px-8">
          {canClose ? (
            <button
              type="button"
              onClick={() => setCloseOpen(true)}
              disabled={countedCount === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-primary font-semibold text-primary hover:bg-primary-soft disabled:border-border disabled:text-muted-foreground"
            >
              ปิดใบนับ
              <span className="text-sm font-normal text-muted-foreground">
                · นับแล้ว {countedCount} จาก {rows.length}
              </span>
            </button>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              เมื่อนับเสร็จ {detail.startedBy ?? "เจ้าภาพ"} (ผู้เปิดใบนับ) หรือผู้จัดการจะเป็นคนปิดใบนับ
            </p>
          )}
        </div>
      )}
      {isDraft && canClose && closeOpen && (
        <CloseSheet onClose={() => setCloseOpen(false)}>
          <form action={closeAction} className="space-y-4">
            <input type="hidden" name="id" value={detail.id} />
            <h3 id="close-title" className="text-lg font-semibold">
              ปิดใบนับ {detail.scNumber}?
            </h3>
            <p className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{countedCount}</span>
              <span className="text-muted-foreground">จาก {rows.length} รายการที่นับแล้ว</span>
            </p>
            {uncountedStocked > 0 && (
              <div className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
                ยังมี <strong>{uncountedStocked} รายการ</strong>ที่มีของอยู่แต่ไม่ได้นับรอบนี้
                ของพวกนี้จะไม่ถูกแตะต้อง ปิดได้ตามปกติถ้าตั้งใจนับแค่บางส่วน
                <button
                  type="button"
                  onClick={() => {
                    setShow("todo");
                    setCloseOpen(false);
                  }}
                  className="mt-1 block font-semibold underline"
                >
                  ดูรายการที่ยังไม่นับ
                </button>
              </div>
            )}
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>ปิดแล้วระบบบันทึกส่วนต่างเข้าคลังทันที และแก้ใบนี้ไม่ได้อีก</li>
              <li>ถ้าปิดผิด ยกเลิกทั้งใบได้ ระบบจะคืนสต๊อกให้เหมือนเดิม</li>
            </ul>
            {closeError && (
              <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{closeError}</div>
            )}
            <div className="space-y-2">
              <button type="submit" disabled={closing} className="btn h-12 w-full text-base">
                {closing ? "กำลังปิด…" : "ปิดใบนับและบันทึกส่วนต่าง"}
              </button>
              <button
                type="button"
                onClick={() => setCloseOpen(false)}
                className="h-11 w-full rounded-xl border border-border-strong text-sm font-medium"
              >
                นับต่อ
              </button>
            </div>
          </form>
        </CloseSheet>
      )}
    </div>
  );
}

/** A sheet that rises from the bottom (a phone's natural reach), centred on a wide screen. */
function CloseSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useTopLayer(onClose);
  return (
    <Portal>
      <div
        className="fixed inset-0 z-[70] flex animate-fade-in items-end justify-center bg-black/40 sm:items-center sm:p-4"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-title"
          className="w-full max-w-md animate-pop-in rounded-t-2xl bg-surface p-5 pb-6 shadow-2xl sm:rounded-2xl"
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden />
          {children}
        </div>
      </div>
    </Portal>
  );
}
