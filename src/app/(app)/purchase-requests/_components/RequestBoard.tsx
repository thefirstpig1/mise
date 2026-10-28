"use client";

// ============================================================
// Mise — the kitchen's purchase request board (Part 38, ADR 0036)
// ============================================================
// Kong 2026-10-27 ("อยากได้ฟีลแคตาล็อก ลองดูแอพ makro pro", mockup
// 5sMMvLFbYSjsXDVpZirBXM): asking for stock is shopping, so it looks like it.
//
//   ร้าน (shop)  — search, category chips, "ใกล้หมด" suggestions, a grid of
//                  cards with + on each. + writes a request line at once (the
//                  same addRequestLineAction as before), then the card's
//                  stepper edits that line — a few presses send ONE update.
//   รถเข็น (cart) — the department's lines this round: quantity, unit, note /
//                  supplier, chat, and the big "กดพร้อม"; plus "ที่ขอไปแล้ว",
//                  where earlier rounds show how far they got (ordered,
//                  promised, received, not ordered and why).
//
// There is no checkout: the kitchen says it is ready and purchasing cuts the
// round (ADR 0036 Q3/Q4). Several phones use this at once, so the page asks the
// server again every 30 s while it is on screen.
// ============================================================

import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QtyStepper from "@/components/ui/QtyStepper";
import { MeasureInput } from "@/components/ui/NumberField";
import ProductThumb from "@/components/ui/ProductThumb";
import { orStale } from "@/lib/stale-tab";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import type { BoardLine, CatalogStock, DuplicateLine, ParSuggestion, RequestBoard as Board } from "@/server/purchase-request";
import type { RequestLineStatus } from "@/lib/purchase-request";
import type { POProductOption } from "@/app/(app)/purchase-orders/_components/PurchaseOrderForm";
import {
  addRequestLineAction,
  deleteRequestLineAction,
  getRequestMessagesAction,
  postRequestMessageAction,
  reopenRequestLineAction,
  requestShortfallAction,
  setDepartmentReadyAction,
  updateRequestLineAction,
  type MessagesActionState,
} from "../actions";

type Supplier = { id: string; name: string };
type Me = { userId: string; canApprove: boolean; isHead: boolean };

const thaiDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
const thaiTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const qtyText = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 3 });
/** Stock on a card reads at a glance: "มี 244.2 kg", not 244.156. */
const stockText = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 1 });
const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ------------------------------------------------------------
// Status, in words (Q10)
// ------------------------------------------------------------
function statusChip(s: RequestLineStatus): { text: string; tone: string } {
  switch (s.kind) {
    case "waiting":
      return { text: "รอสั่ง", tone: "border-border-strong bg-surface text-foreground" };
    case "rejected":
      return { text: `ไม่สั่ง · ${s.reason}`, tone: "border-bad-border bg-bad-bg text-bad" };
    case "preparing":
      return { text: "จัดซื้อกำลังเตรียมสั่ง", tone: "border-border bg-muted text-muted-foreground" };
    case "ordered":
      return { text: `สั่งแล้ว ${s.link.poNumber} · รอผู้ขายยืนยันวันส่ง`, tone: "border-good-border bg-good-bg text-good" };
    case "promised":
      return s.overdueDays > 0
        ? { text: `เลยกำหนดส่ง ${s.overdueDays} วัน (นัด ${thaiDate(s.date)})`, tone: "border-warn-border bg-warn-bg text-warn" }
        : { text: `นัดส่ง ${thaiDate(s.date)} · ${s.link.poNumber}`, tone: "border-good-border bg-good-bg text-good" };
    case "partial":
      return {
        text: `รับแล้ว ${qtyText(s.link.qtyReceived)} จาก ${qtyText(s.link.qtyOrdered)} ${s.link.unitName}`,
        tone: "border-warn-border bg-warn-bg text-warn",
      };
    case "closed_short":
      return {
        text: `รับ ${qtyText(s.link.qtyReceived)} จาก ${qtyText(s.link.qtyOrdered)} ${s.link.unitName} · ปิดรับแล้ว`,
        tone: "border-warn-border bg-warn-bg text-warn",
      };
    case "received":
      return { text: "รับครบแล้ว", tone: "border-border bg-muted text-muted-foreground" };
  }
}

const PAST_GROUPS: { key: string; title: string; kinds: RequestLineStatus["kind"][] }[] = [
  { key: "moving", title: "จัดซื้อกำลังดำเนินการ", kinds: ["preparing", "ordered", "promised", "partial"] },
  { key: "done", title: "เสร็จแล้ว / ไม่สั่ง (7 วันล่าสุด)", kinds: ["received", "closed_short", "rejected"] },
];

/** The unit a card starts on: the first buying unit (a bag, a case), else the base. */
const defaultUnit = (p: POProductOption) => p.units.find((u) => !u.isBase) ?? p.units[0];

const STEP_IDLE_MS = 700;

// ------------------------------------------------------------
// The board
// ------------------------------------------------------------
export default function RequestBoard({
  board,
  branchName,
  products,
  suppliers,
  stock,
}: {
  board: Board;
  branchName: string;
  products: POProductOption[];
  suppliers: Supplier[];
  stock: CatalogStock;
  me: Me;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  // Several phones at once: keep this one current while it is looked at.
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && refresh();
    const id = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  // The cart is a view of this page, kept in the URL so back and refresh land on it.
  const [view, setViewState] = useState<"shop" | "cart">("shop");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "cart") setViewState("cart");
  }, []);
  const setView = (v: "shop" | "cart") => {
    setViewState(v);
    const u = new URL(window.location.href);
    if (v === "cart") u.searchParams.set("view", "cart");
    else u.searchParams.delete("view");
    window.history.replaceState(null, "", u);
    window.scrollTo({ top: 0 });
  };

  const [deptId, setDeptId] = useState(board.homeDepartmentId ?? board.departments[0]?.id ?? "");
  const [tab, setTab] = useState<"now" | "past">("now");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [unitFor, setUnitFor] = useState<Record<string, string>>({});
  const [pendingQty, setPendingQty] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [dupes, setDupes] = useState<{ product: POProductOption; qty: number; unitId: string; list: DuplicateLine[] } | null>(null);
  const [chatFor, setChatFor] = useState<BoardLine | null>(null);
  const [editing, setEditing] = useState<BoardLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Record<string, number>>({});

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const inDept = (l: BoardLine) => !board.departmentsEnabled || l.department.id === deptId;
  const myLines = board.lines.filter((l) => l.status.kind === "waiting" && inDept(l));
  // The line a card's stepper edits: this department's waiting line for it.
  const lineByProduct = useMemo(() => {
    const m = new Map<string, BoardLine>();
    for (const l of myLines) if (l.canEdit && !m.has(l.product.id)) m.set(l.product.id, l);
    return m;
  }, [myLines]);
  const qtyOf = (l: BoardLine) => pendingQty[l.id] ?? l.qty;
  const deptName = board.departmentsEnabled
    ? `แผนก${board.departments.find((d) => d.id === deptId)?.name ?? ""}`
    : branchName;

  // --- writes ---
  const add = async (p: POProductOption, qty: number, unitId: string, acknowledgeDuplicate = false) => {
    setAdding((s) => new Set(s).add(p.id));
    setError(null);
    const r = await orStale(
      addRequestLineAction({
        branchId: board.branchId,
        productId: p.id,
        qty: String(qty),
        unitId,
        departmentId: board.departmentsEnabled ? deptId : null,
        supplierId: "auto",
        onHandQty: "",
        note: "",
        acknowledgeDuplicate,
      })
    );
    setAdding((s) => {
      const n = new Set(s);
      n.delete(p.id);
      return n;
    });
    if (r.ok) refresh();
    else if ("duplicates" in r && r.duplicates) setDupes({ product: p, qty, unitId, list: r.duplicates });
    else setError(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.formError);
  };

  const save = async (l: BoardLine, patch: { qty?: number; unitId?: string }) => {
    const qty = patch.qty ?? qtyOf(l);
    const r =
      qty <= 0
        ? await orStale(deleteRequestLineAction({ lineId: l.id }))
        : await orStale(
            updateRequestLineAction({
              lineId: l.id,
              qty: String(qty),
              unitId: patch.unitId ?? l.unit.id,
              supplierId: l.supplier?.id ?? "",
              onHandQty: l.onHandQty === null ? "" : String(l.onHandQty),
              note: l.note ?? "",
            })
          );
    if (!r.ok) setError(r.formError);
    refresh();
  };

  /**
   * A press on − / + shows at once; the server hears once the presses stop.
   * Counted from a ref, not from render state: two quick presses inside one
   * render would otherwise both read the same number and one would be lost.
   */
  const latest = useRef<Record<string, number>>({});
  const step = (l: BoardLine, delta: number) => {
    const next = Math.max(0, (latest.current[l.id] ?? qtyOf(l)) + delta);
    latest.current[l.id] = next;
    setPendingQty((q) => ({ ...q, [l.id]: next }));
    window.clearTimeout(timers.current[l.id]);
    timers.current[l.id] = window.setTimeout(() => {
      delete latest.current[l.id];
      void save(l, { qty: next });
    }, STEP_IDLE_MS);
  };
  // Drop an optimistic figure once the server's answer carries the same one.
  useEffect(() => {
    setPendingQty((q) => {
      const next = { ...q };
      for (const l of board.lines) if (next[l.id] !== undefined && next[l.id] === l.qty) delete next[l.id];
      return next;
    });
  }, [board.lines]);

  // --- what the shop shows ---
  const groups = useMemo(
    () => [...new Set(products.map((p) => p.group ?? p.section ?? "อื่น ๆ"))].sort((a, b) => a.localeCompare(b, "th")),
    [products]
  );
  const term = query.trim().toLowerCase();
  const shown = products.filter(
    (p) =>
      (!group || (p.group ?? p.section ?? "อื่น ๆ") === group) &&
      (!term || `${p.name} ${p.sku} ${p.group ?? ""}`.toLowerCase().includes(term))
  );

  const readiness = board.readiness.departments.find((d) => d.id === deptId);
  const estimate = myLines.reduce(
    (acc, l) => (l.pricePerBase === null ? acc : { sum: acc.sum + l.pricePerBase * qtyOf(l) * l.unit.toBase, n: acc.n + 1 }),
    { sum: 0, n: 0 }
  );

  return (
    <div className="space-y-5 pb-24">
      {/* ---------- header: search + cart, the department ---------- */}
      <div className="sticky top-[3.6rem] z-20 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:top-0 lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-2">
          {view === "cart" ? (
            <button
              type="button"
              onClick={() => setView("shop")}
              className="flex h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-primary hover:bg-muted"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
              เลือกของต่อ
            </button>
          ) : (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาวัตถุดิบ เช่น หมู กุ้ง น้ำปลา"
              aria-label="ค้นหาวัตถุดิบ"
              className="input h-11 min-w-0 flex-1"
            />
          )}
          <button
            type="button"
            onClick={() => setView(view === "cart" ? "shop" : "cart")}
            aria-label={`ใบขอซื้อ${deptName} ${myLines.length} รายการ`}
            className={`relative ml-auto flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${
              view === "cart" ? "bg-primary text-primary-foreground" : "border border-border-strong bg-surface"
            }`}
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6h15l-1.5 9h-12z" />
              <path d="M6 6 5 3H2" />
              <circle cx="9" cy="20" r="1.4" />
              <circle cx="18" cy="20" r="1.4" />
            </svg>
            <span className="hidden sm:inline">ใบขอซื้อ</span>
            {myLines.length > 0 && (
              <span className="min-w-5 rounded-full bg-[#C0692B] px-1.5 text-xs font-bold text-white">{myLines.length}</span>
            )}
          </button>
        </div>
        {board.departmentsEnabled && (
          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="group" aria-label="ของแผนก">
            <span className="shrink-0 text-xs text-muted-foreground">ของแผนก</span>
            {board.departments.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={d.id === deptId}
                onClick={() => setDeptId(d.id)}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                  d.id === deptId ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface"
                }`}
              >
                {d.name}
                {d.id === board.homeDepartmentId ? " (ของคุณ)" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">
          {error}
        </p>
      )}

      {view === "shop" ? (
        <>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="หมวด">
            {[null, ...groups].map((g) => (
              <button
                key={g ?? "all"}
                type="button"
                aria-pressed={group === g}
                onClick={() => setGroup(g)}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm ${
                  group === g ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"
                }`}
              >
                {g ?? "ทั้งหมด"}
              </button>
            ))}
          </div>

          {!group && !term && board.belowPar.length > 0 && (
            <Suggestions board={board} productById={productById} adding={adding} onAdd={add} />
          )}

          <section className="space-y-2">
            <h2 className="text-base font-semibold">{group ?? (term ? `ผลการค้นหา “${query.trim()}”` : "วัตถุดิบทั้งหมด")}</h2>
            {shown.length === 0 ? (
              <p className="rounded-2xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
                ไม่พบวัตถุดิบ — ลองพิมพ์ส่วนอื่นของชื่อ
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {shown.map((p) => {
                  const line = lineByProduct.get(p.id);
                  const unitId = line?.unit.id ?? unitFor[p.id] ?? defaultUnit(p)?.id ?? "";
                  const st = stock[p.id];
                  const low = st?.parBase != null && st.onHandBase < st.parBase;
                  return (
                    <li key={p.id} className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
                      <ProductThumb imageUrl={p.imageUrl} name={p.name} className="aspect-[4/3] w-full rounded-none" />
                      <div className="absolute right-2 top-2">
                        {line ? (
                          <div className="flex items-center rounded-full bg-primary text-primary-foreground shadow-md">
                            <button type="button" onClick={() => step(line, -1)} aria-label={`ลด ${p.name}`} className="h-9 w-9 text-lg">
                              −
                            </button>
                            <span className="min-w-6 text-center text-sm font-bold tabular-nums">{qtyText(qtyOf(line))}</span>
                            <button type="button" onClick={() => step(line, 1)} aria-label={`เพิ่ม ${p.name}`} className="h-9 w-9 text-lg">
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={adding.has(p.id) || !unitId}
                            onClick={() => add(p, 1, unitId)}
                            aria-label={`ขอ ${p.name}`}
                            className="h-9 w-9 rounded-full bg-primary text-xl leading-none text-primary-foreground shadow-md disabled:opacity-60"
                          >
                            {adding.has(p.id) ? "…" : "+"}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                        <p className="text-sm font-semibold leading-snug">{p.name}</p>
                        <p className={`text-xs ${low ? "text-bad" : "text-muted-foreground"}`}>
                          {st
                            ? `มี ${stockText(st.onHandBase)} ${unitTh(p.baseUnitName)}${st.parBase != null ? ` · ขั้นต่ำ ${stockText(st.parBase)}` : ""}`
                            : "ยังไม่มีในสต๊อกสาขานี้"}
                        </p>
                        {p.units.length > 1 && (
                          <div className="mt-auto flex flex-wrap gap-1">
                            {p.units.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                aria-pressed={u.id === unitId}
                                onClick={() => (line ? void save(line, { unitId: u.id }) : setUnitFor((m) => ({ ...m, [p.id]: u.id })))}
                                className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${
                                  u.id === unitId ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
                                }`}
                              >
                                {u.unitName}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {myLines.length > 0 && (
            <div className="fixed inset-x-3 bottom-3 z-30 lg:left-[16rem] lg:right-8">
              <button
                type="button"
                onClick={() => setView("cart")}
                className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between rounded-2xl bg-primary px-4 text-primary-foreground shadow-xl"
              >
                <span className="font-semibold">
                  ใบขอซื้อ{deptName} · {myLines.length} รายการ
                </span>
                <span className="text-sm opacity-90">ดูและกดพร้อม ›</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <Cart
          board={board}
          deptName={deptName}
          tab={tab}
          setTab={setTab}
          myLines={myLines}
          pastLines={board.lines.filter((l) => l.status.kind !== "waiting" && inDept(l))}
          otherDepts={board.readiness.departments.filter((d) => d.id !== deptId)}
          readiness={readiness ?? null}
          productById={productById}
          qtyOf={qtyOf}
          step={step}
          save={save}
          estimate={estimate}
          onChat={setChatFor}
          onEdit={setEditing}
          onBack={() => setView("shop")}
          onChanged={refresh}
          onError={setError}
          deptId={deptId}
          suppliers={suppliers}
        />
      )}

      {dupes && (
        <ModalShell onClose={() => setDupes(null)} labelledBy="dup-title">
          <h3 id="dup-title" className="pr-10 text-lg font-semibold">
            มี {dupes.product.name} อยู่แล้ว
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {dupes.list.map((d) => (
              <li key={d.id} className="rounded-lg border border-border p-3">
                {qtyText(d.qty)} {d.unitName} · {d.departmentName} ·{" "}
                {d.status === "waiting"
                  ? "รอสั่ง"
                  : d.status === "preparing"
                    ? "จัดซื้อกำลังเตรียมสั่ง"
                    : d.promisedDate
                      ? `สั่งแล้ว ${d.poNumber} นัดส่ง ${thaiDate(d.promisedDate)}`
                      : d.status === "partial"
                        ? `รับมาแล้วบางส่วน (${d.poNumber})`
                        : `สั่งแล้ว ${d.poNumber}`}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">ยังต้องการเพิ่มอีกไหม? เช่น อีกแผนกหนึ่งต้องใช้ด้วย</p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              className="btn"
              onClick={() => {
                const d = dupes;
                setDupes(null);
                void add(d.product, d.qty, d.unitId, true);
              }}
            >
              เพิ่มอีกรายการ
            </button>
            <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setDupes(null)}>
              ไม่เพิ่ม
            </button>
          </div>
        </ModalShell>
      )}

      {chatFor && <Chat line={chatFor} onClose={() => setChatFor(null)} onPosted={refresh} />}
      {editing && (
        <EditLine
          line={editing}
          product={productById.get(editing.product.id)}
          board={board}
          suppliers={suppliers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Q5 — "ใกล้หมด": the below-par products as cards, + asks for the suggested amount
// ------------------------------------------------------------
function Suggestions({
  board,
  productById,
  adding,
  onAdd,
}: {
  board: Board;
  productById: Map<string, POProductOption>;
  adding: Set<string>;
  onAdd: (p: POProductOption, qty: number, unitId: string) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">ใกล้หมด · แนะนำให้ขอ</h2>
        <span className="text-xs text-muted-foreground">
          {board.stockAsOfSalesDay
            ? `ยอดคงเหลือหักยอดขายถึง ${thaiDate(board.stockAsOfSalesDay)}`
            : "ยอดคงเหลือยังไม่หักของที่ขายไป"}
        </span>
      </div>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
        {board.belowPar.map((s: ParSuggestion) => {
          const p = productById.get(s.product.id);
          const low = s.level === "LOW";
          return (
            <li
              key={s.product.id}
              className={`relative w-44 shrink-0 overflow-hidden rounded-2xl border bg-surface ${low ? "border-bad-border" : "border-warn-border"}`}
            >
              <ProductThumb imageUrl={p?.imageUrl ?? null} name={s.product.name} className="aspect-[16/10] w-full rounded-none" />
              {p && s.suggestedQty !== null && (
                <button
                  type="button"
                  disabled={adding.has(p.id)}
                  onClick={() => onAdd(p, s.suggestedQty!, s.unit.id)}
                  aria-label={`ขอ ${s.product.name} ${qtyText(s.suggestedQty)} ${s.unit.name}`}
                  className="absolute right-2 top-2 h-9 w-9 rounded-full bg-primary text-xl leading-none text-primary-foreground shadow-md disabled:opacity-60"
                >
                  {adding.has(p.id) ? "…" : "+"}
                </button>
              )}
              <div className="space-y-0.5 p-2.5 text-sm">
                <p className={`text-[11px] font-bold ${low ? "text-bad" : "text-warn"}`}>{low ? "ต่ำกว่าขั้นต่ำ" : "ใกล้ขั้นต่ำ"}</p>
                <p className="font-semibold">{s.product.name}</p>
                <p className="text-xs text-muted-foreground">
                  มี {stockText(s.onHandBase)} / ขั้นต่ำ {stockText(s.parBase)} {unitTh(s.product.baseUnitName)}
                  {s.onOrderBase > 0 ? ` · กำลังมา ${qtyText(s.onOrderBase)}` : ""}
                </p>
                {s.suggestedQty !== null && (
                  <p className="text-xs font-semibold text-primary">
                    แนะนำ {qtyText(s.suggestedQty)} {s.unit.name}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------
// The cart — this round, and what was asked before
// ------------------------------------------------------------
function Cart({
  board,
  deptName,
  tab,
  setTab,
  myLines,
  pastLines,
  otherDepts,
  readiness,
  productById,
  qtyOf,
  step,
  save,
  estimate,
  onChat,
  onEdit,
  onBack,
  onChanged,
  onError,
  deptId,
  suppliers,
}: {
  board: Board;
  deptName: string;
  tab: "now" | "past";
  setTab: (t: "now" | "past") => void;
  myLines: BoardLine[];
  pastLines: BoardLine[];
  otherDepts: Board["readiness"]["departments"];
  readiness: Board["readiness"]["departments"][number] | null;
  productById: Map<string, POProductOption>;
  qtyOf: (l: BoardLine) => number;
  step: (l: BoardLine, d: number) => void;
  save: (l: BoardLine, patch: { qty?: number; unitId?: string }) => Promise<void>;
  estimate: { sum: number; n: number };
  onChat: (l: BoardLine) => void;
  onEdit: (l: BoardLine) => void;
  onBack: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
  deptId: string;
  suppliers: Supplier[];
}) {
  const [pending, setPending] = useState(false);
  const toggleReady = async (ready: boolean) => {
    setPending(true);
    const r = await orStale(setDepartmentReadyAction({ branchId: board.branchId, departmentId: deptId, ready }));
    setPending(false);
    if (!r.ok) onError(r.formError);
    else onChanged();
  };
  const withMoney = myLines.some((l) => l.pricePerBase !== null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">ใบขอซื้อ{deptName}</h2>
        <p className="text-sm text-muted-foreground">รอบนี้ยังไม่ตัด · จัดซื้อเป็นคนเลือกผู้ขายและสั่ง</p>
      </div>
      <div role="tablist" aria-label="ใบขอซื้อ" className="flex rounded-xl bg-muted p-1">
        {(
          [
            ["now", `รอบนี้ · ${myLines.length}`],
            ["past", `ที่ขอไปแล้ว · ${pastLines.length}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`h-9 flex-1 rounded-lg text-sm ${tab === k ? "bg-surface font-semibold shadow-sm" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "now" ? (
        <>
          {myLines.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
              ยังไม่มีของในรอบนี้ ·{" "}
              <button type="button" onClick={onBack} className="font-semibold text-primary underline">
                กลับไปเลือกของ
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {myLines.map((l) => {
                const p = productById.get(l.product.id);
                const qty = qtyOf(l);
                return (
                  <li key={l.id} className="space-y-2 rounded-2xl border border-border bg-surface p-3">
                    <div className="flex gap-3">
                      <ProductThumb imageUrl={p?.imageUrl ?? null} name={l.product.name} className="h-14 w-14" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold">{l.product.name}</p>
                          {l.canEdit && (
                            <button
                              type="button"
                              onClick={() => void save(l, { qty: 0 })}
                              aria-label={`เอา ${l.product.name} ออก`}
                              className="px-1 text-lg leading-none text-muted-foreground hover:text-bad"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          ขอโดย {l.requestedBy.name} · {thaiTime(l.requestedAt)}
                          {l.supplier ? ` · ผู้ขาย ${l.supplier.name}` : ""}
                        </p>
                        {l.note && <p className="mt-0.5 text-sm">หมายเหตุ: {l.note}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {(p?.units ?? [{ id: l.unit.id, unitName: l.unit.name }]).map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            disabled={!l.canEdit}
                            aria-pressed={u.id === l.unit.id}
                            onClick={() => void save(l, { unitId: u.id })}
                            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs ${
                              u.id === l.unit.id ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
                            }`}
                          >
                            {u.unitName}
                          </button>
                        ))}
                      </div>
                      {l.canEdit ? (
                        <div className="flex items-center rounded-full border border-border-strong">
                          <button type="button" onClick={() => step(l, -1)} aria-label="ลด" className="h-9 w-9 text-lg text-primary">
                            −
                          </button>
                          <span className="min-w-8 text-center font-bold tabular-nums">{qtyText(qty)}</span>
                          <button type="button" onClick={() => step(l, 1)} aria-label="เพิ่ม" className="h-9 w-9 text-lg text-primary">
                            +
                          </button>
                        </div>
                      ) : (
                        <span className="font-semibold tabular-nums">
                          {qtyText(qty)} {l.unit.name}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {l.pricePerBase !== null
                          ? `ประมาณ ${baht(l.pricePerBase * qty * l.unit.toBase)} ตามราคาล่าสุด`
                          : withMoney
                            ? "ยังไม่มีราคาล่าสุด"
                            : ""}
                      </span>
                      <span className="flex gap-3">
                        {l.canEdit && (
                          <button type="button" onClick={() => onEdit(l)} className="text-primary underline">
                            หมายเหตุ / ผู้ขาย
                          </button>
                        )}
                        <button type="button" onClick={() => onChat(l)} className="text-primary underline">
                          คุยกับจัดซื้อ{l.messageCount ? ` (${l.messageCount})` : ""}
                        </button>
                      </span>
                    </div>
                    {l.cheaper && (
                      <p className="rounded-lg border border-primary-line bg-muted/40 px-2.5 py-1.5 text-xs">
                        {l.cheaper.supplierName} ถูกกว่า
                        {l.cheaper.money
                          ? ` (${baht(l.cheaper.money.theirs)} กับ ${baht(l.cheaper.money.ours)} ต่อ ${unitTh(l.product.baseUnitName) || "หน่วย"})`
                          : ""}{" "}
                        · {l.cheaper.source === "paid" ? "ซื้อครั้งล่าสุด" : "รายการราคา"} {thaiDate(l.cheaper.asOf)}
                        {l.canEdit && suppliers.some((s) => s.id === l.cheaper!.supplierId) && (
                          <button
                            type="button"
                            onClick={async () => {
                              const r = await orStale(
                                updateRequestLineAction({
                                  lineId: l.id,
                                  qty: String(qty),
                                  unitId: l.unit.id,
                                  supplierId: l.cheaper!.supplierId,
                                  onHandQty: l.onHandQty === null ? "" : String(l.onHandQty),
                                  note: l.note ?? "",
                                })
                              );
                              if (!r.ok) onError(r.formError);
                              onChanged();
                            }}
                            className="ml-2 text-primary underline"
                          >
                            เปลี่ยนเป็น {l.cheaper.supplierName}
                          </button>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <button type="button" onClick={onBack} className="mx-auto block text-sm font-semibold text-primary underline">
            + ขอของเพิ่ม
          </button>

          {board.departmentsEnabled && otherDepts.length > 0 && (
            <section className="space-y-2 border-t border-border pt-3">
              <h3 className="text-sm font-semibold">แผนกอื่นในรอบนี้</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                {otherDepts.map((d) => (
                  <span
                    key={d.id}
                    className={
                      d.ready
                        ? "rounded-full border border-good-border bg-good-bg px-2.5 py-1 text-good"
                        : "rounded-full border-[1.5px] border-dashed border-border-strong bg-surface px-2.5 py-1 text-muted-foreground"
                    }
                  >
                    {d.ready ? `✓ ${d.name} · พร้อมแล้ว` : `${d.name} · ยังไม่พร้อม · ${d.waitingLines} รายการ`}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                จัดซื้อตัดรอบได้เมื่อทุกแผนกกดพร้อม หรือตัดก่อนก็ได้ — ของที่เพิ่มทีหลังไปรอบถัดไป
              </p>
            </section>
          )}

          <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-border bg-surface/95 px-4 pb-3 pt-2.5 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
            <div className="flex justify-between text-sm">
              <span>{myLines.length} รายการ</span>
              {estimate.n > 0 && (
                <span className="text-muted-foreground">
                  ประมาณ {baht(estimate.sum)}
                  {estimate.n < myLines.length ? ` (${estimate.n} จาก ${myLines.length} รายการ)` : ""}
                </span>
              )}
            </div>
            {readiness?.ready ? (
              <div className="space-y-1 rounded-xl border border-good-border bg-good-bg px-3 py-2.5 text-good">
                <p className="font-semibold">✓ {deptName}พร้อมแล้ว · {readiness.ready.by}</p>
                <p className="text-xs">แก้ได้จนกว่าจัดซื้อตัดรอบ — ถ้าเพิ่มหรือแก้ แผนกจะกลับเป็นยังไม่พร้อม</p>
                <button type="button" disabled={pending} onClick={() => toggleReady(false)} className="text-xs text-primary underline">
                  ยกเลิกพร้อม
                </button>
              </div>
            ) : (
              <button type="button" disabled={pending} onClick={() => toggleReady(true)} className="btn h-12 w-full text-base">
                {pending ? "กำลังบันทึก…" : myLines.length === 0 ? `รอบนี้${deptName}ไม่มีของ · กดพร้อม` : `${deptName}ขอครบแล้ว · กดพร้อม`}
              </button>
            )}
          </div>
        </>
      ) : pastLines.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
          ยังไม่มีของที่ขอในรอบก่อน ๆ
        </p>
      ) : (
        PAST_GROUPS.map((g) => {
          const rows = pastLines.filter((l) => g.kinds.includes(l.status.kind));
          if (rows.length === 0) return null;
          return (
            <section key={g.key} className="rounded-2xl border border-border bg-surface">
              <h3 className="flex items-baseline justify-between border-b border-border px-4 py-3 text-sm font-semibold">
                {g.title}
                <span className="text-xs font-normal text-muted-foreground">{rows.length} รายการ</span>
              </h3>
              <ul className="divide-y divide-border">
                {rows.map((l) => (
                  <PastRow key={l.id} line={l} onChat={() => onChat(l)} onChanged={onChanged} onError={onError} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

// ------------------------------------------------------------
// A line from an earlier round — how far it got
// ------------------------------------------------------------
function PastRow({
  line: l,
  onChat,
  onChanged,
  onError,
}: {
  line: BoardLine;
  onChat: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const chip = statusChip(l.status);
  const run = async (p: Promise<{ ok: boolean; formError?: string }>) => {
    setBusy(true);
    const r = await orStale(p as Promise<{ ok: true } | { ok: false; formError: string }>);
    setBusy(false);
    if (!r.ok) onError(r.formError);
    else onChanged();
  };
  return (
    <li className={`space-y-1.5 px-4 py-3 ${busy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">
          {l.product.name} <span className="tabular-nums">· {qtyText(l.qty)} {l.unit.name}</span>
        </p>
        <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${chip.tone}`}>{chip.text}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {[l.supplier ? `ผู้ขาย ${l.supplier.name}` : null, `ขอโดย ${l.requestedBy.name} · ${thaiTime(l.requestedAt)}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="flex flex-wrap gap-3 text-xs">
        <button type="button" onClick={onChat} className="text-primary underline">
          {l.status.kind === "rejected" ? "ตอบกลับจัดซื้อ" : "คุยกับจัดซื้อ"}
          {l.messageCount ? ` (${l.messageCount})` : ""}
        </button>
        {l.status.kind === "rejected" && (
          <button type="button" onClick={() => run(reopenRequestLineAction({ lineId: l.id, why: null }))} className="text-primary underline">
            ขอใหม่
          </button>
        )}
        {l.status.kind === "closed_short" && (
          <button type="button" onClick={() => run(requestShortfallAction({ lineId: l.id }))} className="text-primary underline">
            ขอส่วนที่ขาด
          </button>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------
// The conversation (R2 — append-only)
// ------------------------------------------------------------
function Chat({ line, onClose, onPosted }: { line: BoardLine; onClose: () => void; onPosted: () => void }) {
  const [state, setState] = useState<MessagesActionState | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setState(await orStale(getRequestMessagesAction({ lineId: line.id }))), [line.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const send = async () => {
    setBusy(true);
    const r = await orStale(postRequestMessageAction({ lineId: line.id, body }));
    setBusy(false);
    if (r.ok) {
      setBody("");
      await load();
      onPosted();
    } else setState({ ok: false, formError: r.formError });
  };
  return (
    <ModalShell onClose={onClose} labelledBy="chat-title">
      <h3 id="chat-title" className="pr-10 text-lg font-semibold">
        {line.product.name} · {qtyText(line.qty)} {line.unit.name}
      </h3>
      <p className="text-xs text-muted-foreground">ข้อความในช่องนี้แก้หรือลบไม่ได้ ใช้ตรวจสอบย้อนหลังได้</p>
      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {state === null ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : !state.ok ? (
          <p className="text-sm text-bad">{state.formError}</p>
        ) : state.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีข้อความ</p>
        ) : (
          state.messages.map((m) => (
            <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.author ? "bg-muted/50" : "border border-dashed border-border text-muted-foreground"}`}>
              <p className="text-xs text-muted-foreground">
                {m.author ? m.author.name : "ระบบ"} · {thaiTime(m.at)}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="พิมพ์ข้อความ…" className="input flex-1" />
        <button type="button" onClick={send} disabled={busy || !body.trim()} className="btn">
          ส่ง
        </button>
      </div>
    </ModalShell>
  );
}

// ------------------------------------------------------------
// Edit a waiting line
// ------------------------------------------------------------
function EditLine({
  line,
  product,
  board,
  suppliers,
  onClose,
  onSaved,
}: {
  line: BoardLine;
  product: POProductOption | undefined;
  board: Board;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qty, setQty] = useState(String(line.qty));
  const [unitId, setUnitId] = useState(line.unit.id);
  const [departmentId, setDepartmentId] = useState(line.department.id);
  const [supplierId, setSupplierId] = useState(line.supplier?.id ?? "");
  const [onHand, setOnHand] = useState(line.onHandQty === null ? "" : String(line.onHandQty));
  const [note, setNote] = useState(line.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await orStale(
      updateRequestLineAction({ lineId: line.id, qty, unitId, departmentId, supplierId, onHandQty: onHand, note })
    );
    setBusy(false);
    if (r.ok) onSaved();
    else setError(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.formError);
  };
  return (
    <ModalShell onClose={onClose} labelledBy="edit-title">
      <h3 id="edit-title" className="pr-10 text-lg font-semibold">
        แก้ไข · {line.product.name}
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* A div, not a label: clicking a label's text would press its − button. */}
        <div className="text-sm">
          จำนวน
          <QtyStepper value={qty} onChange={setQty} label="จำนวน" className="mt-1 flex" />
        </div>
        <label className="text-sm">
          หน่วย
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="input mt-1 w-full">
            {(product?.units ?? [{ id: line.unit.id, unitName: line.unit.name }]).map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitName}
              </option>
            ))}
          </select>
        </label>
        {board.departmentsEnabled && (
          <label className="text-sm">
            ของแผนก
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="input mt-1 w-full">
              {board.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          ผู้ขาย
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input mt-1 w-full">
            <option value="">ให้จัดซื้อเลือก</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          ที่เหลืออยู่จริง
          <MeasureInput unit={unitTh(line.product.baseUnitName) || " "} min="0" value={onHand} onChange={(e) => setOnHand(e.target.value)} aria-label="ที่เหลืออยู่จริง" boxClassName="mt-1 w-36" />
        </label>
        <label className="text-sm sm:col-span-2">
          หมายเหตุถึงจัดซื้อ
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input mt-1 w-full" />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <div className="mt-4 flex gap-3">
        <button type="button" className="btn" disabled={busy} onClick={save}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onClose}>
          ยกเลิก
        </button>
      </div>
    </ModalShell>
  );
}
