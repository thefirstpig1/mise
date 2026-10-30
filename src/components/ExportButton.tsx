"use client";

// ============================================================
// คิดครัว — "ดาวน์โหลด Excel" on a list page (Kong 2026-10-31)
// ============================================================
// Sits at the end of a page's filter row. It never downloads on the first
// press: a dialog first says WHAT the file holds, of WHICH days and branches,
// and HOW MANY rows (an export that ignores the filters on screen, or a bare
// button that says nothing, is the pattern to avoid). Pages without a period
// of their own (receipts, counts) start the dialog on this month.
//
// The dialog is portalled into <body>: `position: fixed` inside the page frame
// is fixed to the frame (mise-ui-review §7). The count is a GET read, never a
// Server Action (§5c), and the download is an ordinary link, so the browser
// saves the file the server names.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { EXPORT_DATASET_TH, exportFileName, type ExportDataset } from "@/lib/validations/raw-export";

type Count = { docs: number | null; rows: number; voidedLeftOut: boolean };

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MTH[m - 1]} ${String((y + 543) % 100).padStart(2, "0")}`;
};
const spanTh = (from: string, to: string) => (from === to ? thDay(from) : `${thDay(from)} – ${thDay(to)}`);
const isoOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** Notes that change what a reader finds in the file, per dataset. */
const NOTE: Partial<Record<ExportDataset, string>> = {
  products: "แผ่นราคามีเฉพาะคนที่เห็นต้นทุน",
  "stock-counts": "ใบนับแบบไม่เห็นจำนวนในระบบ จะไม่มีจำนวนในระบบในไฟล์ ยกเว้นคนที่เห็นต้นทุน",
};

export default function ExportButton({
  dataset,
  params,
  period,
  scope,
  branchName,
  today,
}: {
  dataset: ExportDataset;
  /** The page's filters, as the API names them (branch, status, category, …). */
  params: Record<string, string | undefined>;
  /** The page's own period, when it has one. */
  period?: { from: string; to: string };
  /** One line per filter on screen, already in Thai: "สาขา: ทุกสาขาที่คุณดูได้ (2 สาขา)". */
  scope: string[];
  /** The branch the page is narrowed to, for the file name; null = every branch. */
  branchName: string | null;
  /** Today in Bangkok, YYYY-MM-DD — from the server, so the chips agree with it. */
  today: string;
}) {
  const meta = EXPORT_DATASET_TH[dataset];
  const [open, setOpen] = useState(false);
  const [y, m] = today.split("-").map(Number);
  const presets = useMemo(() => {
    const named = [
      { key: "this", label: "เดือนนี้", from: isoOf(y, m - 1, 1), to: today },
      { key: "last", label: "เดือนก่อน", from: isoOf(y, m - 2, 1), to: isoOf(y, m - 1, 0) },
      { key: "3m", label: "3 เดือนล่าสุด", from: isoOf(y, m - 3, 1), to: today },
    ];
    // The page's own period leads — unless it IS one of the named ones, which
    // would light two chips for one range.
    const page = period && !named.some((p) => p.from === period.from && p.to === period.to);
    return [...(page ? [{ key: "page", label: "ตามหน้านี้", from: period!.from, to: period!.to }] : []), ...named];
  }, [period, today, y, m]);
  const start = period ?? presets[0];
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [count, setCount] = useState<Count | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ dataset });
    if (meta.period) {
      qs.set("from", from);
      qs.set("to", to);
    }
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    return qs;
  }, [dataset, meta.period, from, to, params]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setCount(null);
    setError(null);
    const qs = new URLSearchParams(query);
    qs.set("count", "1");
    fetch(`/api/export?${qs}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) throw new Error("stale");
        return res.json();
      })
      .then((body) => {
        if (!live) return;
        if (body.ok) setCount({ docs: body.docs, rows: body.rows, voidedLeftOut: body.voidedLeftOut });
        else setError(body.formError ?? "นับข้อมูลไม่ได้");
      })
      .catch(() => live && setError("นับข้อมูลไม่ได้ — กรุณารีเฟรชหน้าแล้วลองอีกครั้ง"));
    return () => {
      live = false;
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const name = exportFileName(dataset, meta.period ? from : undefined, meta.period ? to : undefined, branchName);
  const empty = count !== null && count.rows === 0;
  const rowsTh =
    count === null
      ? "กำลังนับ…"
      : empty
        ? "ไม่มีข้อมูลในช่วงนี้"
        : `${count.rows.toLocaleString("th-TH")} แถว${count.docs !== null ? ` จาก ${count.docs.toLocaleString("th-TH")} ใบ` : ""}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-sm inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="inline-grid h-[18px] w-[18px] place-items-center rounded-[4px] bg-[#1D6B3F] font-display text-[10px] font-bold text-white">
          XL
        </span>
        ดาวน์โหลด Excel
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="export-title"
              className="max-h-[92vh] w-full max-w-md animate-pop-in space-y-4 overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-lg sm:rounded-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 id="export-title" className="text-base font-semibold">
                  ดาวน์โหลดข้อมูลดิบเป็น Excel
                </h3>
                <button type="button" onClick={() => setOpen(false)} aria-label="ปิด" className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted">
                  ×
                </button>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-subtle">ข้อมูล</dt>
                <dd>{meta.row}</dd>
                {meta.period && (
                  <>
                    <dt className="text-muted-subtle">ช่วง</dt>
                    <dd className="font-medium">{spanTh(from, to)}</dd>
                  </>
                )}
                {scope.map((line) => {
                  const [k, ...rest] = line.split(": ");
                  return rest.length ? (
                    <div key={line} className="contents">
                      <dt className="text-muted-subtle">{k}</dt>
                      <dd>{rest.join(": ")}</dd>
                    </div>
                  ) : (
                    <dd key={line} className="col-span-2 text-muted-foreground">
                      {line}
                    </dd>
                  );
                })}
                <dt className="text-muted-subtle">จำนวน</dt>
                <dd className={empty ? "text-muted-foreground" : "font-medium"}>
                  {error ?? rowsTh}
                  {count?.voidedLeftOut && <span className="block text-xs font-normal text-muted-foreground">ไม่รวมใบที่ยกเลิกแล้ว</span>}
                </dd>
              </dl>

              {meta.period && (
                <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => {
                          setFrom(p.from);
                          setTo(p.to);
                        }}
                        className={`pill ${from === p.from && to === p.to ? "is-on" : ""}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="input h-9 w-auto" aria-label="ตั้งแต่วันที่" />
                    <span className="text-muted-subtle">ถึง</span>
                    <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className="input h-9 w-auto" aria-label="ถึงวันที่" />
                  </div>
                  <p className="text-xs text-muted-subtle">ดาวน์โหลดได้ครั้งละไม่เกิน 12 เดือน</p>
                </div>
              )}

              <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{name.thai}</p>

              {count && !empty && !error ? (
                <a href={`/api/export?${query}`} onClick={() => setTimeout(() => setOpen(false), 400)} className="btn h-11 w-full justify-center text-base">
                  ดาวน์โหลด
                </a>
              ) : (
                <button type="button" disabled className="btn h-11 w-full justify-center text-base">
                  ดาวน์โหลด
                </button>
              )}
              <p className="text-xs text-muted-subtle">
                ตัวเลขในไฟล์เป็นข้อมูลตามที่บันทึก ไม่ได้คำนวณใหม่{NOTE[dataset] ? ` · ${NOTE[dataset]}` : ""}
              </p>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
