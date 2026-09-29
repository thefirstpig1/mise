"use client";

// ============================================================
// Mise — the kitchen's purchase request board (Part 38, ADR 0036)
// ============================================================
// Top to bottom, the order a cook works in:
//   1. who is ready (every department must say so — Q3)
//   2. what is already asked for, by status (read, never stored — R1)
//   3. add a line — at the END of the list, like the order form (Kong
//      2026-09-29), with the below-par panel beside it (Q5)
//
// Several people use this at once from different phones, so the page asks the
// server again every 30 s while it is on screen.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ProductPicker from "@/components/ui/ProductPicker";
import { orStale } from "@/lib/stale-tab";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import type { BoardLine, DuplicateLine, ParSuggestion, RequestBoard as Board } from "@/server/purchase-request";
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
const baht = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;

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

const GROUPS: { key: string; title: string; kinds: RequestLineStatus["kind"][] }[] = [
  { key: "waiting", title: "รอสั่ง", kinds: ["waiting"] },
  { key: "moving", title: "จัดซื้อกำลังดำเนินการ", kinds: ["preparing", "ordered", "promised", "partial"] },
  { key: "done", title: "เสร็จแล้ว / ไม่สั่ง (7 วันล่าสุด)", kinds: ["received", "closed_short", "rejected"] },
];

// ------------------------------------------------------------
// The board
// ------------------------------------------------------------
export default function RequestBoard({
  board,
  branchName,
  products,
  suppliers,
}: {
  board: Board;
  branchName: string;
  products: POProductOption[];
  suppliers: Supplier[];
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

  const [chatFor, setChatFor] = useState<BoardLine | null>(null);
  const [editing, setEditing] = useState<BoardLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<ParSuggestion | null>(null);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  return (
    <div className="space-y-6">
      <Readiness board={board} onChanged={refresh} onError={setError} />

      {error && (
        <p className="rounded-lg border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {GROUPS.map((g) => {
            const rows = board.lines.filter((l) => g.kinds.includes(l.status.kind));
            if (g.key !== "waiting" && rows.length === 0) return null;
            return (
              <section key={g.key} className="rounded-xl border border-border bg-surface">
                <h2 className="flex items-baseline justify-between border-b border-border px-4 py-3 text-base font-semibold">
                  {g.title}
                  <span className="text-xs font-normal text-muted-foreground">{rows.length} รายการ</span>
                </h2>
                {rows.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">ยังไม่มีรายการ — เพิ่มด้านล่างได้เลย</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {rows.map((l) => (
                      <LineRow
                        key={l.id}
                        line={l}
                        showDept={board.departmentsEnabled}
                        onChat={() => setChatFor(l)}
                        onEdit={() => setEditing(l)}
                        onChanged={refresh}
                        onError={setError}
                        suppliers={suppliers}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <AddLine
            board={board}
            branchName={branchName}
            products={products}
            suppliers={suppliers}
            prefill={prefill}
            onPrefillUsed={() => setPrefill(null)}
            onAdded={refresh}
          />
        </div>

        <BelowPar board={board} onPick={setPrefill} />
      </div>

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
// Q3 — who is ready
// ------------------------------------------------------------
function Readiness({ board, onChanged, onError }: { board: Board; onChanged: () => void; onError: (m: string) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const toggle = async (departmentId: string, ready: boolean) => {
    setPending(departmentId);
    const r = await orStale(setDepartmentReadyAction({ branchId: board.branchId, departmentId, ready }));
    setPending(null);
    if (!r.ok) onError(r.formError);
    else onChanged();
  };
  const r = board.readiness;
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {r.allReady ? "✅ ทุกแผนกพร้อมแล้ว — ฝ่ายจัดซื้อสั่งได้เลย" : "ความพร้อมของแต่ละแผนก"}
        </h2>
        <p className="text-xs text-muted-foreground">ทุกแผนกต้องกด ถ้ารอบนี้ไม่มีของต้องสั่ง ให้กด “รอบนี้ไม่มีของ”</p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {r.departments.map((d) => {
          const mine = d.id === board.homeDepartmentId;
          return (
            <li
              key={d.id}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                d.ready ? "border-good-border bg-good-bg" : mine ? "border-primary" : "border-border-strong"
              }`}
            >
              <span className="font-medium">{board.departmentsEnabled ? d.name : "สาขานี้"}</span>
              {d.ready ? (
                <>
                  <span className="text-xs text-good">พร้อมแล้ว · {d.ready.by}</span>
                  <button
                    type="button"
                    disabled={pending === d.id}
                    onClick={() => toggle(d.id, false)}
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    ยกเลิก
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">{d.waitingLines} รายการ</span>
                  <button
                    type="button"
                    disabled={pending === d.id}
                    onClick={() => toggle(d.id, true)}
                    className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {pending === d.id ? "กำลังบันทึก…" : d.waitingLines === 0 ? "รอบนี้ไม่มีของ" : "พร้อมแล้ว"}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------
// One line
// ------------------------------------------------------------
function LineRow({
  line: l,
  showDept,
  onChat,
  onEdit,
  onChanged,
  onError,
  suppliers,
}: {
  line: BoardLine;
  showDept: boolean;
  onChat: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
  suppliers: Supplier[];
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
  const switchTo = (supplierId: string) =>
    run(
      updateRequestLineAction({
        lineId: l.id,
        qty: l.qty,
        unitId: l.unit.id,
        supplierId,
        onHandQty: l.onHandQty,
        note: l.note,
      })
    );
  const hasSupplier = (id: string) => suppliers.some((s) => s.id === id);

  return (
    <li className={`px-4 py-3 ${busy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {l.product.name}{" "}
            <span className="tabular-nums">
              · {qtyText(l.qty)} {l.unit.name}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              showDept ? l.department.name : null,
              l.supplier ? `ผู้ขาย: ${l.supplier.name}` : "ให้จัดซื้อเลือกผู้ขาย",
              l.onHandQty !== null ? `เหลือจริง ${qtyText(l.onHandQty)} ${l.product.baseUnitName ?? ""}` : null,
              `${l.requestedBy.name} · ${thaiTime(l.requestedAt)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {l.note && <p className="mt-1 text-sm">📝 {l.note}</p>}
          {l.cheaper && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-primary-line bg-muted/40 px-2 py-0.5">
                💡 {l.cheaper.supplierName} ถูกกว่า
                {l.cheaper.money
                  ? ` (${baht(l.cheaper.money.theirs)} กับ ${baht(l.cheaper.money.ours)} ต่อ ${l.product.baseUnitName ?? "หน่วย"})`
                  : ""}{" "}
                · {l.cheaper.source === "paid" ? "ซื้อครั้งล่าสุด" : "รายการราคา"} {thaiDate(l.cheaper.asOf)}
              </span>
              {l.canEdit && hasSupplier(l.cheaper.supplierId) && (
                <button type="button" onClick={() => switchTo(l.cheaper!.supplierId)} className="text-primary underline">
                  เปลี่ยนเป็น {l.cheaper.supplierName}
                </button>
              )}
              {l.canEdit && <span className="text-muted-foreground">หรือปล่อยไว้ ถ้ารู้ว่าของร้านนั้นไม่ดี ใส่หมายเหตุบอกจัดซื้อ</span>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${chip.tone}`}>{chip.text}</span>
          <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
            <button type="button" onClick={onChat} className="text-primary hover:underline">
              💬 คุยกับจัดซื้อ{l.messageCount ? ` (${l.messageCount})` : ""}
            </button>
            {l.canEdit && (
              <>
                <button type="button" onClick={onEdit} className="text-primary hover:underline">
                  แก้ไข
                </button>
                <button
                  type="button"
                  onClick={() => window.confirm(`เอา “${l.product.name}” ออกจากใบขอซื้อ?`) && run(deleteRequestLineAction({ lineId: l.id }))}
                  className="text-bad hover:underline"
                >
                  เอาออก
                </button>
              </>
            )}
            {l.status.kind === "rejected" && (
              <button
                type="button"
                onClick={() => {
                  const why = window.prompt("ขอใหม่เพราะอะไร (ไม่บังคับ)", "") ?? null;
                  if (why !== null) void run(reopenRequestLineAction({ lineId: l.id, why }));
                }}
                className="text-primary hover:underline"
              >
                ขอใหม่
              </button>
            )}
            {l.status.kind === "closed_short" && (
              <button type="button" onClick={() => run(requestShortfallAction({ lineId: l.id }))} className="text-primary hover:underline">
                ขอส่วนที่ขาด
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------
// Add a line — at the end of the list
// ------------------------------------------------------------
function AddLine({
  board,
  branchName,
  products,
  suppliers,
  prefill,
  onPrefillUsed,
  onAdded,
}: {
  board: Board;
  branchName: string;
  products: POProductOption[];
  suppliers: Supplier[];
  prefill: ParSuggestion | null;
  onPrefillUsed: () => void;
  onAdded: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [unitId, setUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState(board.homeDepartmentId ?? "");
  const [supplierId, setSupplierId] = useState("auto");
  const [onHand, setOnHand] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DuplicateLine[] | null>(null);
  const boxRef = useRef<HTMLElement>(null);
  const pickerInput = useRef<HTMLInputElement | null>(null);

  const product = products.find((p) => p.id === productId);
  const baseName = product?.baseUnitName ?? "";

  // A below-par row pressed on the side: fill the form and bring it into view.
  useEffect(() => {
    if (!prefill) return;
    setProductId(prefill.product.id);
    setUnitId(prefill.unit.id);
    setQty(String(prefill.suggestedQty ?? ""));
    setOnHand("");
    onPrefillUsed();
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [prefill, onPrefillUsed]);

  const choose = (id: string) => {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    setUnitId(p?.units[0]?.id ?? "");
  };

  const reset = () => {
    setProductId("");
    setQty("");
    setOnHand("");
    setNote("");
    setSupplierId("auto");
    setDupes(null);
    window.setTimeout(() => pickerInput.current?.focus(), 0);
  };

  const submit = async (acknowledgeDuplicate = false) => {
    setBusy(true);
    setError(null);
    const r = await orStale(
      addRequestLineAction({
        branchId: board.branchId,
        productId,
        qty,
        unitId,
        departmentId: board.departmentsEnabled ? departmentId : null,
        supplierId,
        onHandQty: onHand,
        note,
        acknowledgeDuplicate,
      })
    );
    setBusy(false);
    if (r.ok) {
      reset();
      onAdded();
    } else if ("duplicates" in r && r.duplicates) {
      setDupes(r.duplicates);
    } else {
      setError(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.formError);
    }
  };

  return (
    <section ref={boxRef} className="rounded-xl border-2 border-dashed border-border-strong bg-surface p-4">
      <h2 className="text-base font-semibold">+ เพิ่มของที่ต้องการ · {branchName}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-6">
          <label className="label">วัตถุดิบ</label>
          <ProductPicker products={products} value={productId} onChange={choose} onInputRef={(el) => (pickerInput.current = el)} />
        </div>
        <div className="sm:col-span-3">
          <label className="label">จำนวน</label>
          <input type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="input mt-1 w-full" />
        </div>
        <div className="sm:col-span-3">
          <label className="label">หน่วย</label>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!product} className="input mt-1 w-full">
            {!product && <option value="">—</option>}
            {product?.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitName}
              </option>
            ))}
          </select>
        </div>
        {board.departmentsEnabled && (
          <div className="sm:col-span-4">
            <label className="label">ของแผนก</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="input mt-1 w-full">
              {board.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.id === board.homeDepartmentId ? " (แผนกของคุณ)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={board.departmentsEnabled ? "sm:col-span-4" : "sm:col-span-6"}>
          <label className="label">ผู้ขาย</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input mt-1 w-full">
            <option value="auto">ให้ระบบเลือก (ร้านประจำ / ร้านที่ซื้อล่าสุด)</option>
            <option value="">ให้จัดซื้อเลือก</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className={board.departmentsEnabled ? "sm:col-span-4" : "sm:col-span-6"}>
          <label className="label">ที่เหลืออยู่จริง {baseName && `(${baseName})`} — ไม่บังคับ</label>
          <input type="number" min="0" step="0.001" value={onHand} onChange={(e) => setOnHand(e.target.value)} className="input mt-1 w-full" />
        </div>
        <div className="sm:col-span-12">
          <label className="label">หมายเหตุถึงจัดซื้อ — ไม่บังคับ</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น ร้าน B เนื้อไม่สวย ขอร้าน A"
            className="input mt-1 w-full"
          />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={busy || !productId || !qty || !unitId} onClick={() => submit()} className="btn">
          {busy ? "กำลังเพิ่ม…" : "เพิ่มเข้าใบขอซื้อ"}
        </button>
        <p className="text-xs text-muted-foreground">
          เพิ่มแล้วแผนกนี้จะกลับเป็น “ยังไม่พร้อม” — กดพร้อมอีกครั้งเมื่อใส่ครบ
        </p>
      </div>

      {dupes && (
        <ModalShell onClose={() => setDupes(null)} labelledBy="dup-title">
          <h3 id="dup-title" className="pr-10 text-lg font-semibold">
            มี {product?.name} อยู่แล้ว
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {dupes.map((d) => (
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
            <button type="button" className="btn" onClick={() => submit(true)} disabled={busy}>
              เพิ่มอีกรายการ
            </button>
            <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setDupes(null)}>
              ไม่เพิ่ม
            </button>
          </div>
        </ModalShell>
      )}
    </section>
  );
}

// ------------------------------------------------------------
// Q5 — below par, beside the list
// ------------------------------------------------------------
function BelowPar({ board, onPick }: { board: Board; onPick: (s: ParSuggestion) => void }) {
  return (
    <aside className="h-fit rounded-xl border border-border bg-surface p-4 xl:sticky xl:top-4">
      <h2 className="text-base font-semibold">ต่ำกว่า par</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {board.stockAsOfSalesDay
          ? `ยอดคงเหลือหักยอดขายถึงวันที่ ${thaiDate(board.stockAsOfSalesDay)} — ของที่ขายหลังจากนั้นยังไม่ถูกหัก`
          : "ยังไม่มียอดขายที่ตัดสต๊อก — ยอดคงเหลือยังไม่หักของที่ขายไป"}
      </p>
      {board.belowPar.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">ไม่มีของต่ำกว่า par ที่ยังไม่ได้ขอ</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {board.belowPar.map((s) => (
            <li key={s.product.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="w-full rounded-lg border border-border p-2.5 text-left text-sm hover:border-primary hover:bg-muted/40"
              >
                <span className="font-medium">{s.product.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  มี {qtyText(s.onHandBase)} / par {qtyText(s.parBase)} {s.product.baseUnitName ?? ""}
                  {s.onOrderBase > 0 ? ` · กำลังมา ${qtyText(s.onOrderBase)}` : ""}
                </span>
                <span className="mt-1 block text-xs font-medium text-primary">
                  + ขอ {qtyText(s.suggestedQty ?? 0)} {s.unit.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
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
        <label className="text-sm">
          จำนวน
          <input type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="input mt-1 w-full" />
        </label>
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
          ที่เหลืออยู่จริง ({line.product.baseUnitName ?? ""})
          <input type="number" min="0" step="0.001" value={onHand} onChange={(e) => setOnHand(e.target.value)} className="input mt-1 w-full" />
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
