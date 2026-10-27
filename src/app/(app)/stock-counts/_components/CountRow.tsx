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
// Mobile pass (Kong 2026-10-27, mockup NBRTCZ2dkWty1n4fu7nUw4): two short lines
// instead of five — the note and a second unit open on request, the SKU line is
// gone (the group is the section heading; search still finds the SKU), the
// picture slot shows only when there IS a picture, the quantity box starts
// empty rather than with a grey "0" that read as counted, and "หมด (0)" counts
// an empty shelf in one tap. A counted row folds to one green line; tap it.
//
// The row never guesses what the server decided. It sends, and the sheet
// replaces its whole state with what comes back — including when someone else
// got there first, which the server reports rather than overwriting (Q3).

import { useState, type KeyboardEvent, type ReactNode } from "react";
import ProductThumb from "@/components/ui/ProductThumb";
import QtyStepper from "@/components/ui/QtyStepper";
import { formatQty } from "./stock-count-view";
import type { StockCountItemView } from "./stock-count-view";

export type CountProduct = {
  id: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  section: string | null;
  group: string | null;
  /**
   * A PREPPED product (ADR 0021 Q11): nothing raises its balance until
   * production is recorded, so its "expected" and its variance mean nothing.
   */
  prepped?: boolean;
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
  quickZero,
  heading,
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
  /** Offer "หมด (0)" — only on a row nobody has counted yet. */
  quickZero?: boolean;
  /** The product's name, drawn on the same line as "+ อีกหน่วย" / "หมด (0)". */
  heading?: ReactNode;
}) {
  const [entries, setEntries] = useState<Entry[]>(
    initial?.length ? initial : [{ unitId: baseOf(product)?.id ?? "", qty: "" }]
  );
  const [note, setNote] = useState(initialNote ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(initialNote));
  const filled = entries.some((e) => e.qty.trim() !== "");
  // Counting is walking: the person should not wait for the network before
  // typing the next number. The save runs in the background; the cursor moves.
  const moveOn = (from?: HTMLElement | null) => {
    if (!advance || !from) return;
    let next = from.closest("li")?.nextElementSibling;
    while (next && !next.querySelector('input[type="number"]')) next = next.nextElementSibling;
    next?.querySelector<HTMLInputElement>('input[type="number"]')?.focus();
  };
  const submit = (from?: HTMLElement) => {
    if (!filled || busy) return;
    onSubmit(entries, note);
    moveOn(from);
  };
  const setEntry = (i: number, next: Partial<Entry>) =>
    setEntries((rows) => rows.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const unusedUnit = product.units.find((u) => !entries.some((e) => e.unitId === u.id));
  const enter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(e.currentTarget);
    }
  };

  return (
    <div className="space-y-2">
      {(heading || quickZero || (unusedUnit && product.units.length > 1)) && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {heading && <div className="mr-auto min-w-0">{heading}</div>}
          {unusedUnit && product.units.length > 1 && (
            <button
              type="button"
              onClick={() => setEntries((rows) => [...rows, { unitId: unusedUnit.id, qty: "" }])}
              className="text-xs text-primary underline"
            >
              + อีกหน่วย
            </button>
          )}
          {quickZero && (
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                onSubmit([{ unitId: baseOf(product)?.id ?? "", qty: "0" }], note);
                moveOn(e.currentTarget);
              }}
              className="whitespace-nowrap rounded-full border border-border-strong bg-surface-sunk px-2.5 py-1 text-xs text-primary hover:bg-muted"
            >
              หมด (0)
            </button>
          )}
        </div>
      )}
      {entries.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <QtyStepper
            value={row.qty}
            onChange={(qty) => setEntry(i, { qty })}
            label={`จำนวน ${product.name}`}
            className="shrink-0"
            inputClassName="h-11 w-14 text-base font-semibold placeholder:text-xs placeholder:font-normal"
            inputProps={{
              placeholder: "จำนวน",
              autoFocus: autoFocus && i === 0,
              onKeyDown: enter,
            }}
          />
          <select
            value={row.unitId}
            aria-label={`หน่วยของ ${product.name}`}
            onChange={(e) => setEntry(i, { unitId: e.target.value })}
            className="input h-11 w-24 min-w-0 shrink px-1.5 text-sm sm:w-32"
          >
            {product.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitName}
              </option>
            ))}
          </select>
          {i === 0 ? (
            <>
              <button
                type="button"
                onClick={() => setNoteOpen((o) => !o)}
                aria-expanded={noteOpen}
                aria-label={`หมายเหตุของ ${product.name}`}
                className={`flex h-11 w-10 shrink-0 items-center justify-center rounded-lg border ${noteOpen || note ? "border-primary-line bg-primary-soft" : "border-border bg-surface"}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => submit(e.currentTarget)}
                disabled={!filled || busy}
                className="btn h-11 min-w-[4.5rem] flex-1 px-3 sm:flex-none"
              >
                {busy ? "บันทึก…" : submitLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEntries((rows) => rows.filter((_, j) => j !== i))}
              className="px-2 text-xs text-muted-foreground hover:text-bad"
              aria-label="ลบหน่วยนี้"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {noteOpen && (
        <input
          type="text"
          value={note}
          maxLength={500}
          autoFocus
          placeholder={NOTE_PLACEHOLDER}
          aria-label={`หมายเหตุของ ${product.name}`}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={enter}
          className="input h-10 w-full placeholder:text-muted-foreground/60"
        />
      )}
      {onCancel && (
        <button type="button" onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground">
          ยกเลิก
        </button>
      )}
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
  // A counted row is one green line until someone taps it.
  const [expanded, setExpanded] = useState(false);
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

  const prepBadge = product.prepped && (
    <span className="whitespace-nowrap rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[11px] font-normal text-warn">
      ของแปรรูป
    </span>
  );
  const thumb = product.imageUrl ? (
    <ProductThumb imageUrl={product.imageUrl} name={product.name} className="h-10 w-10" />
  ) : null;

  const name = (
    <div className="flex items-center gap-2">
      {thumb}
      <p className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
        {product.name}
        {prepBadge}
      </p>
    </div>
  );

  if (!counted) {
    return (
      <li className={`space-y-2 px-4 py-3 transition-colors ${busy ? "bg-good-bg/25" : ""}`}>
        {editable ? (
          <EntryEditor
            product={product}
            submitLabel="ยืนยัน"
            busy={busy}
            advance
            quickZero
            heading={name}
            onSubmit={(entries, note) => send("new", entries, note)}
          />
        ) : (
          name
        )}
        {message && <p className="text-sm text-warn">{message}</p>}
      </li>
    );
  }

  const mineFirst = item.contributions.find((c) => c.countedByUserId === currentUserId);
  const who =
    item.contributions.length > 1
      ? `${item.contributions.length} คน`
      : mineFirst
        ? `คุณ ${mineFirst.countedAtTime}`
        : `${item.contributions[0]?.countedBy ?? "—"} ${item.contributions[0]?.countedAtTime ?? ""}`;

  return (
    <li className="bg-good-bg/60">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12.5 10 17l9-10" />
        </svg>
        {thumb}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-medium">
          {product.name}
          {prepBadge}
        </span>
        <span className="shrink-0 text-right">
          <span className="font-semibold tabular-nums">{formatQty(item.qtyCounted)}</span> {base}
          {/* A closed sheet is read for its variances: show them without a tap. */}
          {!editable && showExpected ? (
            <span
              className={`block text-xs ${
                item.varianceIsZero || product.prepped
                  ? "text-muted-foreground"
                  : item.varianceIsShort
                    ? "font-medium text-bad"
                    : "font-medium text-warn"
              }`}
            >
              {item.varianceIsZero
                ? "ตรงกับระบบ"
                : `${item.varianceIsShort ? "" : "+"}${formatQty(item.variance)} จากระบบ`}
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">{who}</span>
          )}
        </span>
      </button>

      {message && <p className="px-4 pb-2 text-sm text-warn">{message}</p>}

      {expanded && (
        <div className="space-y-2 px-4 pb-3 pl-11">
          {showExpected && (
            <p className="text-sm">
              ระบบว่ามี {formatQty(item.qtyExpected)} {base} ·{" "}
              <span
                className={
                  item.varianceIsZero || product.prepped
                    ? ""
                    : item.varianceIsShort
                      ? "font-medium text-bad"
                      : "font-medium text-warn"
                }
              >
                {item.varianceIsZero ? "ตรง" : `${item.varianceIsShort ? "" : "+"}${formatQty(item.variance)}`}
              </span>
            </p>
          )}
          {showExpected && product.prepped && !item.varianceIsZero && (
            <p className="text-xs text-warn">
              ส่วนต่างนี้ไม่ได้แปลว่าของหายหรือเกิน — ระบบยังไม่ได้บันทึกการผลิตของแปรรูป
            </p>
          )}
          <ul className="space-y-1 text-sm">
            {item.contributions.map((c) => {
              const mine = c.countedByUserId === currentUserId;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{c.entries.map((e) => `${formatQty(e.qtyInUnit)} ${e.unitName}`).join(" + ")}</span>
                  <span className="text-xs text-muted-foreground">
                    · {mine ? "คุณ" : c.countedBy ?? "—"} · {c.countedAtTime}
                  </span>
                  {c.note && <span className="text-xs italic text-muted-foreground">· {c.note}</span>}
                  {editable && mine && open !== c.id && (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setOpen(c.id)}
                        className="rounded-full border border-primary-line bg-surface px-2.5 py-0.5 text-xs text-primary"
                      >
                        แก้ของฉัน
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteContribution(c.id)}
                        disabled={busy}
                        className="rounded-full border border-bad-border bg-surface px-2.5 py-0.5 text-xs text-bad"
                      >
                        ลบของฉัน
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {editable && open === null && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
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

          {editable && open === "add" && (
            <div>
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

          {editable && open !== null && open !== "add" && (() => {
            const c = item.contributions.find((x) => x.id === open);
            if (!c) return null;
            return (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">แก้จำนวนที่คุณนับ</p>
                <EntryEditor
                  product={product}
                  initial={c.entries.map((e) => ({ unitId: e.unitId, qty: String(Number(e.qtyInUnit)) }))}
                  initialNote={c.note}
                  submitLabel="บันทึก"
                  busy={busy}
                  autoFocus
                  onSubmit={(entries, note) => send("edit", entries, note, c.id)}
                  onCancel={() => setOpen(null)}
                />
              </div>
            );
          })()}
        </div>
      )}
    </li>
  );
}
