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

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StockCountActionState } from "../actions";
import StatusBadge from "./StatusBadge";
import CountRow, { type CountProduct, type RowSubmit } from "./CountRow";
import { formatMoney, formatQty } from "./stock-count-view";
import type { StockCountDetailView } from "./stock-count-view";
import EmptyState from "@/components/ui/EmptyState";

const POLL_MS = 5_000;
const NO_CATEGORY = "ไม่มีหมวด";
type Show = "all" | "todo" | "done";

const chip = (active: boolean, small = false) =>
  `rounded-full border transition-colors ${small ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"} ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border-strong bg-surface hover:bg-muted"
  }`;

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
  poll,
  close,
  voidCount,
}: {
  initial: StockCountDetailView;
  products: CountProduct[];
  /** Cost per base unit, as a string, for valuing a variance (ADR 0015 Q4). */
  costByProduct: Record<string, string>;
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
  poll: (countId: string) => Promise<StockCountDetailView | null>;
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
  const [confirmClose, setConfirmClose] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const [closeState, closeAction, closing] = useActionState(close, { ok: false } as StockCountActionState);
  const [voidState, voidAction, voiding] = useActionState(voidCount, { ok: false } as StockCountActionState);

  // A close or void returns the new document; adopt it.
  useEffect(() => {
    if (closeState.ok && closeState.detail) setDetail(closeState.detail);
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
  }, [poll, detail.id]);

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
  const uncountedStocked = stockedProductIds.filter((id) => !lineByProduct.has(id)).length;
  const varianceValue = detail.items
    .filter((i) => !i.isReversal)
    .reduce((sum, i) => sum + Number(i.variance) * Number(costByProduct[i.productId] ?? 0), 0);

  const closeError = closeState.ok === false ? closeState.formError : undefined;
  const voidError = voidState.ok === false ? voidState.formError : undefined;

  return (
    <div className="space-y-5">
      {/* --- header --- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/stock-counts" className="text-sm text-muted-foreground hover:text-foreground">
            ← กลับไปรายการใบนับ
          </a>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold">
            {detail.scNumber}
            <StatusBadge status={detail.status} />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.branchName} · นับวันที่ {detail.countDateLabel}
            {detail.startedBy && ` · เจ้าภาพ ${isHost ? "คุณ" : detail.startedBy}`}
            {!detail.showExpected && " · นับแบบไม่เห็นจำนวนในระบบ"}
          </p>
        </div>
        {isDraft && (
          <div className="rounded-xl border border-border bg-surface px-4 py-2 text-right">
            <p className="text-xs text-muted-foreground">นับแล้ว</p>
            <p className="text-2xl font-semibold tabular-nums">
              {countedCount}
              <span className="text-base font-normal text-muted-foreground"> / {rows.length}</span>
            </p>
          </div>
        )}
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
      {isDraft && (
        <p className="text-sm text-muted-foreground">
          ใส่จำนวนที่นับได้แล้วกด <strong>ยืนยัน</strong> ท้ายบรรทัด รายการจะเป็นสีเขียวบนทุกเครื่องที่เปิดใบนี้อยู่
          พร้อมชื่อคนนับ — ของที่ไม่ได้นับ ไม่ต้องใส่
        </p>
      )}
      {sheetError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{sheetError}</div>
      )}

      {/* --- filters --- */}
      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="หมวดหมู่">
          <button type="button" className={chip(section === null)} onClick={() => { setSection(null); setGroup(null); }}>
            ทั้งหมด
          </button>
          {sections.map((s) => (
            <button key={s} type="button" className={chip(section === s)} onClick={() => { setSection(s); setGroup(null); }}>
              {s}
            </button>
          ))}
        </div>
        {groups.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3" role="group" aria-label="หมวดย่อย">
            <button type="button" className={chip(group === null, true)} onClick={() => setGroup(null)}>
              ทุกหมวดย่อยใน{section}
            </button>
            {groups.map((g) => (
              <button key={g} type="button" className={chip(group === g, true)} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อหรือรหัสสินค้า"
            className="input w-full"
          />
          {isDraft && (
            <div className="flex shrink-0 gap-1.5" role="group" aria-label="สถานะการนับ">
              {(
                [
                  ["all", "ทั้งหมด"],
                  ["todo", "ยังไม่นับ"],
                  ["done", "นับแล้ว"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" className={chip(show === v, true)} onClick={() => setShow(v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

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
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">ขาด / เกิน (จำนวน)</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {/* Over is warn, not good: a surplus is evidence the ledger was wrong. */}
              <span className="text-bad">−{formatQty(detail.totalShortQty)}</span>
              {" / "}
              <span className="text-warn">+{formatQty(detail.totalOverQty)}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">คนละหน่วยกัน — ดูเป็นรายรายการด้านบน</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">มูลค่าส่วนต่าง (ประมาณ)</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${varianceValue < 0 ? "text-bad" : ""}`}>
              {formatMoney(String(varianceValue))}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">คิดจากต้นทุนล่าสุด · ตัวเลขจริงดูที่หน้าต้นทุน</p>
          </div>
        </div>
      )}

      {/* --- close (host, or count:close — ADR 0034 Q5) --- */}
      {isDraft &&
        (canClose ? (
          <form action={closeAction} className="rounded-lg border border-border p-4">
            <input type="hidden" name="id" value={detail.id} />
            <h3 className="text-sm font-medium">ปิดใบนับ</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              ปิดแล้วระบบจะบันทึกส่วนต่างเข้าคลังทันที และแก้ใบนี้ไม่ได้อีก — ตรวจให้แน่ใจว่าทุกคนนับเสร็จแล้ว
            </p>
            {uncountedStocked > 0 && (
              <div className="mt-3 rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
                ยังมีวัตถุดิบอีก <strong>{uncountedStocked}</strong> รายการที่มีของอยู่แต่ไม่ได้นับรอบนี้
                — ของพวกนี้จะไม่ถูกแตะต้อง ปิดใบได้ตามปกติถ้าตั้งใจนับแค่บางส่วน
              </div>
            )}
            {closeError && (
              <div className="mt-3 rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{closeError}</div>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirmClose} onChange={(e) => setConfirmClose(e.target.checked)} />
              ตรวจตัวเลขแล้ว ยืนยันปิดใบนับ
            </label>
            <button
              type="submit"
              disabled={closing || !confirmClose || countedCount === 0}
              className="btn mt-3"
            >
              {closing ? "กำลังปิด…" : "ปิดใบนับและบันทึกส่วนต่าง"}
            </button>
          </form>
        ) : (
          <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            เมื่อนับเสร็จ {detail.startedBy ?? "เจ้าภาพ"} (ผู้เปิดใบนับ) หรือผู้จัดการจะเป็นคนปิดใบนับ
          </p>
        ))}

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
                <button type="button" onClick={() => setVoidOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm">
                  ไม่ยกเลิก
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
