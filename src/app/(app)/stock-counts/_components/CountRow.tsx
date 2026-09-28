"use client";

// ADR 0034 — one product on the count sheet, as a row you count into.
//
// A row is in one of two states, and colour says which from across the room:
//  - not counted — boxes for the quantity (one unit, "+ หน่วย" for more), a
//    note whose placeholder teaches what a note is for, and ยืนยัน at the end;
//  - counted — green, with every person's count underneath: how much, who,
//    when, why. Anyone may add more found elsewhere; only the person who typed
//    a count may change or take it back (Q3).
//
// The row never guesses what the server decided. It sends, and the sheet
// replaces its whole state with what comes back — including when someone else
// got there first, which the server reports rather than overwriting (Q3).

import { useState } from "react";
import ProductThumb from "@/components/ui/ProductThumb";
import { formatQty } from "./stock-count-view";
import type { StockCountItemView } from "./stock-count-view";

export type CountProduct = {
  id: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  section: string | null;
  group: string | null;
  units: { id: string; unitName: string; isBase: boolean }[];
};

type Entry = { unitId: string; qty: string };

export type RowSubmit = {
  mode: "new" | "add" | "edit";
  contributionId?: string;
  entries: { productUnitId: string; qtyInUnit: string }[];
  notes: string | null;
};

/** Kong: a note is only useful if people know what to write. */
const NOTE_PLACEHOLDER = "หมายเหตุ เช่น ของเสีย, ของหาย, เพิ่งหาเจอ, อยู่ตู้หน้าไลน์";

const baseOf = (p: CountProduct) => p.units.find((u) => u.isBase) ?? p.units[0];

function EntryEditor({
  product,
  initial,
  initialNote,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  autoFocus,
  advance,
}: {
  product: CountProduct;
  initial?: Entry[];
  initialNote?: string | null;
  submitLabel: string;
  busy: boolean;
  onSubmit: (entries: Entry[], note: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** After ยืนยัน, hand the cursor to the next row still waiting to be counted. */
  advance?: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>(
    initial?.length ? initial : [{ unitId: baseOf(product)?.id ?? "", qty: "" }]
  );
  const [note, setNote] = useState(initialNote ?? "");
  const filled = entries.some((e) => e.qty.trim() !== "");
  // Counting is walking: the person should not wait for the network before
  // typing the next number. The save runs in the background; the cursor moves.
  const submit = (from?: HTMLElement) => {
    if (!filled || busy) return;
    onSubmit(entries, note);
    if (!advance || !from) return;
    let next = from.closest("li")?.nextElementSibling;
    while (next && !next.querySelector('input[type="number"]')) next = next.nextElementSibling;
    next?.querySelector<HTMLInputElement>('input[type="number"]')?.focus();
  };
  const setEntry = (i: number, next: Partial<Entry>) =>
    setEntries((rows) => rows.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const unusedUnit = product.units.find((u) => !entries.some((e) => e.unitId === u.id));

  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="space-y-1.5">
        {entries.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              value={row.qty}
              placeholder="0"
              autoFocus={autoFocus && i === 0}
              aria-label={`จำนวน ${product.name}`}
              onChange={(e) => setEntry(i, { qty: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit(e.currentTarget);
                }
              }}
              className="input h-10 w-24 text-right text-base tabular-nums"
            />
            <select
              value={row.unitId}
              aria-label={`หน่วยของ ${product.name}`}
              onChange={(e) => setEntry(i, { unitId: e.target.value })}
              className="input h-10 w-32"
            >
              {product.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitName}
                </option>
              ))}
            </select>
            {entries.length > 1 && (
              <button
                type="button"
                onClick={() => setEntries((rows) => rows.filter((_, j) => j !== i))}
                className="px-1 text-xs text-muted-foreground hover:text-bad"
                aria-label="ลบหน่วยนี้"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {unusedUnit && product.units.length > 1 && (
          <button
            type="button"
            onClick={() => setEntries((rows) => [...rows, { unitId: unusedUnit.id, qty: "" }])}
            className="text-xs text-primary hover:underline"
          >
            + หน่วย (เช่น 2 กระสอบ + 3 กก.)
          </button>
        )}
      </div>
      <input
        type="text"
        value={note}
        maxLength={500}
        placeholder={NOTE_PLACEHOLDER}
        aria-label={`หมายเหตุของ ${product.name}`}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit(e.currentTarget);
          }
        }}
        className="input h-10 min-w-[12rem] flex-1 placeholder:text-muted-foreground/60"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => submit(e.currentTarget)}
          disabled={!filled || busy}
          className="btn h-10"
        >
          {busy ? "กำลังบันทึก…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            ยกเลิก
          </button>
        )}
      </div>
    </div>
  );
}

export default function CountRow({
  product,
  item,
  editable,
  showExpected,
  currentUserId,
  canRemoveLine,
  busy,
  message,
  onSubmit,
  onDeleteContribution,
  onRemoveLine,
}: {
  product: CountProduct;
  /** The line on the sheet, or undefined when nobody has counted it yet. */
  item: StockCountItemView | undefined;
  editable: boolean;
  showExpected: boolean;
  currentUserId: string;
  canRemoveLine: boolean;
  busy: boolean;
  message: string | null;
  onSubmit: (s: RowSubmit) => Promise<boolean>;
  onDeleteContribution: (contributionId: string) => void;
  onRemoveLine: (itemId: string) => void;
}) {
  // What is open under a counted row: nothing, "add more", or editing one of mine.
  const [open, setOpen] = useState<null | "add" | string>(null);
  const counted = item !== undefined;
  const base = item?.baseUnitName ?? baseOf(product)?.unitName ?? "";

  const send = async (mode: RowSubmit["mode"], entries: Entry[], note: string, contributionId?: string) => {
    const ok = await onSubmit({
      mode,
      contributionId,
      entries: entries.map((e) => ({ productUnitId: e.unitId, qtyInUnit: e.qty })),
      notes: note.trim() || null,
    });
    if (ok) setOpen(null);
  };

  return (
    <li
      className={`px-4 py-3 transition-colors ${
        counted
          ? "border-l-4 border-l-good bg-good-bg/60"
          : busy
            ? "border-l-4 border-l-good/40 bg-good-bg/25"
            : "border-l-4 border-l-transparent"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <ProductThumb imageUrl={product.imageUrl} name={product.name} className="h-12 w-12" />

        <div className="min-w-[10rem] flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {product.name}
            {counted && (
              <span className="rounded-full bg-good px-2 py-0.5 text-xs font-medium text-white">
                ✓ นับแล้ว
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {product.sku}
            {product.group ? ` · ${product.group}` : ""}
          </p>

          {counted && (
            <div className="mt-1.5 space-y-1">
              <p className="text-sm">
                รวม{" "}
                <span className="text-base font-semibold tabular-nums">
                  {formatQty(item.qtyCounted)}
                </span>{" "}
                {base}
                {showExpected && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ระบบว่ามี {formatQty(item.qtyExpected)} ·{" "}
                    <span
                      className={
                        item.varianceIsZero
                          ? ""
                          : item.varianceIsShort
                            ? "font-medium text-bad"
                            : "font-medium text-warn"
                      }
                    >
                      {item.varianceIsZero
                        ? "ตรง"
                        : `${item.varianceIsShort ? "" : "+"}${formatQty(item.variance)}`}
                    </span>
                  </span>
                )}
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {item.contributions.map((c) => {
                  const mine = c.countedByUserId === currentUserId;
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-2">
                      <span className="text-foreground">
                        {c.entries.map((e) => `${formatQty(e.qtyInUnit)} ${e.unitName}`).join(" + ")}
                      </span>
                      <span>
                        · {mine ? "คุณ" : c.countedBy ?? "—"} · {c.countedAtTime}
                      </span>
                      {c.note && <span className="italic">· {c.note}</span>}
                      {editable && mine && open !== c.id && (
                        <>
                          <button
                            type="button"
                            onClick={() => setOpen(c.id)}
                            className="text-primary hover:underline"
                          >
                            แก้ของฉัน
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteContribution(c.id)}
                            disabled={busy}
                            className="hover:text-bad"
                          >
                            ลบของฉัน
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {counted && editable && open === null && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen("add")}
              className="rounded-full border border-primary-line bg-surface px-3 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground"
            >
              + นับเพิ่มจากอีกที่
            </button>
            {canRemoveLine && (
              <button
                type="button"
                onClick={() => onRemoveLine(item.id)}
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-bad"
              >
                เอาออกทั้งรายการ
              </button>
            )}
          </div>
        )}
      </div>

      {message && <p className="mt-2 text-sm text-warn">{message}</p>}

      {editable && !counted && (
        <div className="mt-2 sm:pl-[3.75rem]">
          <EntryEditor
            product={product}
            submitLabel="ยืนยัน"
            busy={busy}
            advance
            onSubmit={(entries, note) => send("new", entries, note)}
          />
        </div>
      )}

      {editable && counted && open === "add" && (
        <div className="mt-2 sm:pl-[3.75rem]">
          <p className="mb-1 text-xs text-muted-foreground">
            นับเพิ่มจากอีกที่ — จำนวนนี้จะรวมเข้ากับที่นับไว้แล้ว
          </p>
          <EntryEditor
            product={product}
            submitLabel="เพิ่มเข้าไป"
            busy={busy}
            autoFocus
            onSubmit={(entries, note) => send("add", entries, note)}
            onCancel={() => setOpen(null)}
          />
        </div>
      )}

      {editable && counted && open !== null && open !== "add" && (() => {
        const c = item.contributions.find((x) => x.id === open);
        if (!c) return null;
        return (
          <div className="mt-2 sm:pl-[3.75rem]">
            <p className="mb-1 text-xs text-muted-foreground">แก้จำนวนที่คุณนับ</p>
            <EntryEditor
              product={product}
              initial={c.entries.map((e) => ({ unitId: e.unitId, qty: String(Number(e.qtyInUnit)) }))}
              initialNote={c.note}
              submitLabel="บันทึกการแก้ไข"
              busy={busy}
              autoFocus
              onSubmit={(entries, note) => send("edit", entries, note, c.id)}
              onCancel={() => setOpen(null)}
            />
          </div>
        );
      })()}
    </li>
  );
}
