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
import type { PreppedHint } from "@/server/production-read";
import type { CountSalesReadiness } from "@/server/deduction-accuracy";
import { useKeepForm } from "@/lib/keep-form";
import OpeningPrices, { type OpeningPrice } from "./OpeningPrices";
import OpeningPricesLater from "./OpeningPricesLater";

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

/** ADR 0040 Q2: the prompts for prepped lines counted above the ledger. */
async function readHints(countId: string): Promise<PreppedHint[] | null> {
  const r = await readApi<{ ok: true; hints: PreppedHint[] }>("/api/stock-counts", "prepped", countId);
  return r.ok ? r.hints : null;
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${String((y + 543) % 100).padStart(2, "0")}`;
};
const dayBefore = (isoDay: string) => new Date(Date.parse(`${isoDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Kong 2026-10-31: a count closed before the sales it stands on were deducted
 * reads the unsold-yet-not-deducted stock as gone, and the next count finds it
 * again as a gain. Said before closing, never refused — the shop may simply
 * not have sold on those days.
 */
function SalesReadiness({ countId }: { countId: string }) {
  const [r, setR] = useState<CountSalesReadiness | null>(null);
  useEffect(() => {
    let on = true;
    void readApi<{ ok: true; readiness: CountSalesReadiness | null }>("/api/stock-counts", "sales", countId).then((res) => {
      if (on && res.ok) setR(res.readiness);
    });
    return () => {
      on = false;
    };
  }, [countId]);
  if (!r || !r.usesDeduction) return null;
  const yesterday = dayBefore(r.countDate);
  const behind = r.lastSalesDate !== null && r.lastSalesDate < yesterday;
  if (!behind && r.unposted.length === 0) return null;
  return (
    <div className="space-y-1 rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
      {behind && (
        <p>
          ยอดขายของสาขานี้นำเข้าถึง <strong>{thDate(r.lastSalesDate!)}</strong> · ใบนับนี้วันที่ {thDate(r.countDate)} — ถ้าร้านขายของหลังวันนั้น
          ของที่ขายไปยังไม่ถูกตัด ส่วนต่างในใบนี้จะรวมของที่ขายไปแล้ว และใบนับครั้งถัดไปจะเห็นเป็นของเกินเท่ากัน
        </p>
      )}
      {r.unposted.length > 0 && (
        <p>
          ยอดขาย <strong>{r.unposted.length} วัน</strong>นำเข้าแล้วแต่ยังไม่ได้ตัดสต๊อก ({r.unposted.slice(0, 3).map(thDate).join(" · ")}
          {r.unposted.length > 3 ? " …" : ""})
        </p>
      )}
      <p className="text-xs">
        ปิดต่อได้ตามปกติ ·{" "}
        <a href="/sales/import" className="font-semibold underline">
          นำเข้ายอดขาย
        </a>{" "}
        ·{" "}
        <a href="/consumption" className="font-semibold underline">
          ตัดสต๊อกตามยอดขาย
        </a>
      </p>
    </div>
  );
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
  opening,
}: {
  initial: StockCountDetailView;
  /** Rule PG4: the branch's first count — what it finds is the stock it starts from (ยอดยกมา). */
  opening: boolean;
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
  const [prices, setPrices] = useState<OpeningPrice[]>([]);

  const [closeState, closeAction, closing] = useActionState(close, { ok: false } as StockCountActionState);
  const closeActionKeep = useKeepForm(closeAction, closeState);
  const [voidState, voidAction, voiding] = useActionState(voidCount, { ok: false } as StockCountActionState);
  const voidActionKeep = useKeepForm(voidAction, voidState);

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

  // ---------- ADR 0040 Q2: prepped lines counted above the ledger ----------
  // Asked again only when what was counted changes — not on every poll — and
  // only while some prepped line is actually over.
  const preppedIds = useMemo(() => new Set(products.filter((p) => p.prepped).map((p) => p.id)), [products]);
  const countedSig = detail.items
    .filter((i) => !i.isReversal)
    .map((i) => `${i.productId}:${i.qtyCounted}`)
    .sort()
    .join("|");
  const anyPreppedOver = detail.items.some(
    (i) => !i.isReversal && preppedIds.has(i.productId) && Number(i.qtyCounted) > Number(i.qtyExpected)
  );
  const [hints, setHints] = useState<PreppedHint[]>([]);
  // A few seconds to work out (a recipe walk and a cost replay): the row says
  // it is looking, rather than sitting silent (mise-ui-review §5b).
  const [hintsLoading, setHintsLoading] = useState(false);
  useEffect(() => {
    if (!isDraft || !anyPreppedOver) {
      setHints([]);
      return;
    }
    let on = true;
    setHintsLoading(true);
    void readHints(detail.id).then((h) => {
      if (!on) return;
      setHintsLoading(false);
      if (h) setHints(h);
    });
    return () => {
      on = false;
    };
  }, [detail.id, isDraft, anyPreppedOver, countedSig]);
  const hintOf = useMemo(() => new Map(hints.map((h) => [h.productId, h])), [hints]);
  const nameOf = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const usedFor = useMemo(() => {
    const m = new Map<string, { qty: number; by: string[] }>();
    for (const h of hints) {
      for (const u of h.allUsed) {
        const cur = m.get(u.productId) ?? { qty: 0, by: [] };
        cur.qty += u.qty;
        const by = nameOf.get(h.productId) ?? "";
        if (by && !cur.by.includes(by)) cur.by.push(by);
        m.set(u.productId, cur);
      }
    }
    return m;
  }, [hints, nameOf]);

  const confirmHint = (productId: string, unitId: string, qty: number) =>
    void run(productId, () =>
      confirmCount({
        stockCountId: detail.id,
        productId,
        mode: "new",
        entries: [{ productUnitId: unitId, qtyInUnit: String(qty) }],
        notes: "ยืนยันตามที่ระบบคำนวณ (หักส่วนที่ใช้ทำของแปรรูปแล้ว)",
      })
    );

  // "ไปนับ": clear the filters, then scroll once the row is actually on screen
  // — after the render the cleared filters cause, not on a guessed timer.
  const [goToId, setGoToId] = useState<string | null>(null);
  const goTo = (productId: string) => {
    setSection(null);
    setGroup(null);
    setShow("all");
    setSearch("");
    setGoToId(productId);
  };
  useEffect(() => {
    if (!goToId) return;
    const el = document.getElementById(`count-row-${goToId}`);
    if (!el) return;
    // `scroll-mt-60` on the row keeps it clear of the sticky header above.
    el.scrollIntoView({ block: "start" });
    el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    setGoToId(null);
  });

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
  // ADR 0040: prepped lines are named on screen — their surplus is a production.
  const preppedRows = rows.filter((p) => p.prepped);
  const preppedCounted = preppedRows.filter((p) => lineByProduct.has(p.id)).length;
  const uncountedStocked = stockedProductIds.filter((id) => !lineByProduct.has(id)).length;
  // Lines with a difference, valued only where a cost is known: an unpriced
  // line is counted and named, never valued at ฿0 (Kong 2026-10-30).
  const variance = (() => {
    if (!costByProduct) return null;
    const lines = detail.items.filter((i) => !i.isReversal && Number(i.variance) !== 0);
    const priced = lines.filter((i) => costByProduct[i.productId] !== undefined);
    return {
      value: priced.length > 0 ? priced.reduce((sum, i) => sum + Number(i.variance) * Number(costByProduct[i.productId]), 0) : lines.length === 0 ? 0 : null,
      unpriced: lines.length - priced.length,
    };
  })();

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
              {opening && <span className="inline-block whitespace-nowrap rounded-full border border-primary-line bg-primary-soft px-2 py-0.5 text-xs font-normal text-primary">นับเปิดระบบ</span>}
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
            {opening && "ใบนับแรกของสาขา = สต๊อกตั้งต้น (ยอดยกมา) · "}กรอกจำนวนแล้วกดยืนยัน · ไม่ได้นับไม่ต้องใส่
            {preppedRows.length > 0 && <span> · ของแปรรูปที่นับได้เกิน ลงเป็นการผลิต</span>}{" "}
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
                ของแปรรูป (ป้าย “ของแปรรูป”): นับได้<strong>มากกว่า</strong>ในระบบ = ทำเพิ่มแต่ไม่ได้บันทึก — ตอนปิดใบระบบลงเป็นการผลิตตามสูตร
                และหักวัตถุดิบที่ใช้ทำออกจากยอดในระบบก่อนเทียบ · นับได้<strong>น้อยกว่า</strong> = ของหายตามปกติ ·
                ระบบจะขอให้ช่วยเช็กวัตถุดิบหลัก ไม่เช็กก็ปิดใบได้
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
          {detail.closedBy && ` โดย ${detail.closedBy}`} — {opening ? "ยอดยกมาถูกบันทึกเข้าคลังเรียบร้อย" : "ส่วนต่างถูกบันทึกเข้าคลังเรียบร้อย"}
        </div>
      )}
      {/* Rule PG6: opening stock closed without a price, priced from its first receipt when the shop says so. */}
      {detail.status === "CLOSED" && opening && costByProduct && <OpeningPricesLater countId={detail.id} />}
      {detail.status === "CLOSED" && preppedCounted > 0 && (
        <div className="rounded-lg border border-border bg-surface-sunk p-3 text-sm text-muted-foreground">
          ของแปรรูปที่นับได้เกินในใบนี้ถูกลงเป็นการผลิตแล้ว —{" "}
          <a href="/production" className="text-primary underline decoration-dotted underline-offset-4">
            ดูในหน้าการผลิต
          </a>
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
                <ul className="divide-y divide-border overflow-hidden rounded-[18px] border border-border/70 bg-surface shadow-card">
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
              hint={hintOf.get(p.id)}
              hintPending={hintsLoading}
              usedFor={usedFor.get(p.id)}
              onConfirmHint={confirmHint}
              onGoTo={goTo}
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
        <div className={`grid gap-3 ${variance !== null ? "sm:grid-cols-2" : ""}`}>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">{opening ? "ต่างจากระบบ · ส่วนที่เกินคือยอดยกมา" : "ขาด / เกิน (จำนวน)"}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {/* Over is warn, not good: a surplus is evidence the ledger was wrong. */}
              {/* A side with nothing on it is a plain 0, not a red "−0". */}
              <span className={Number(detail.totalShortQty) > 0 ? "text-bad" : "text-muted-foreground"}>
                {Number(detail.totalShortQty) > 0 ? "−" : ""}
                {formatQty(detail.totalShortQty)}
              </span>
              {" / "}
              <span className={Number(detail.totalOverQty) > 0 ? "text-warn" : "text-muted-foreground"}>
                {Number(detail.totalOverQty) > 0 ? "+" : ""}
                {formatQty(detail.totalOverQty)}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              คนละหน่วยกัน — ดูเป็นรายรายการด้านบน
              {preppedCounted > 0 && ` · ของแปรรูปที่เกินลงเป็นการผลิต ไม่ใช่ของเกิน`}
            </p>
          </div>
          {variance !== null && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">{opening ? "มูลค่าส่วนต่างจากระบบ (ประมาณ)" : "มูลค่าส่วนต่าง (ประมาณ)"}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${variance.value !== null && variance.value < 0 ? "text-bad" : ""}`}>
                {variance.value === null ? "—" : formatMoney(String(variance.value))}
              </p>
              <p className={`mt-1 text-xs ${variance.unpriced > 0 ? "text-warn" : "text-muted-foreground"}`}>
                {variance.unpriced === 0
                  ? "คิดจากต้นทุนล่าสุด · ตัวเลขจริงดูที่หน้าต้นทุน"
                  : variance.value === null
                    ? `ยังไม่มีราคา ${variance.unpriced} รายการ จึงยังคิดมูลค่าไม่ได้`
                    : `ไม่รวม ${variance.unpriced} รายการที่ยังไม่มีราคา · คิดจากต้นทุนล่าสุด`}
              </p>
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
            <form {...voidActionKeep} className="space-y-3">
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
          <form {...closeActionKeep} className="space-y-4">
            <input type="hidden" name="id" value={detail.id} />
            {opening && costByProduct && <input type="hidden" name="prices" value={JSON.stringify(prices)} />}
            <h3 id="close-title" className="text-lg font-semibold">
              {opening ? "ปิดใบนับเปิดระบบ" : "ปิดใบนับ"} {detail.scNumber}?
            </h3>
            {opening && (
              <p className="text-sm text-muted-foreground">
                ยอดที่นับได้คือสต๊อกตั้งต้นของสาขา (ยอดยกมา) ไม่ใช่ของเกิน
                {!costByProduct && " · ระบบใส่ราคาให้จากต้นทุนที่มีและราคาที่ตั้งไว้กับผู้ขาย รายการที่ยังไม่มีราคา คนที่ดูต้นทุนได้ใส่ภายหลังที่หน้าต้นทุน"}
              </p>
            )}
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
            <SalesReadiness countId={detail.id} />
            {opening && costByProduct && <OpeningPrices countId={detail.id} onChange={setPrices} />}
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{opening ? "ปิดแล้วระบบบันทึกยอดยกมาพร้อมราคาเข้าคลังทันที และแก้ใบนี้ไม่ได้อีก" : "ปิดแล้วระบบบันทึกส่วนต่างเข้าคลังทันที และแก้ใบนี้ไม่ได้อีก"}</li>
              <li>ถ้าปิดผิด ยกเลิกทั้งใบได้ ระบบจะคืนสต๊อกให้เหมือนเดิม</li>
            </ul>
            {closeError && (
              <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{closeError}</div>
            )}
            <div className="space-y-2">
              <button type="submit" disabled={closing} className="btn h-12 w-full text-base">
                {closing ? "กำลังปิด…" : opening ? "ปิดใบนับและบันทึกยอดยกมา" : "ปิดใบนับและบันทึกส่วนต่าง"}
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
