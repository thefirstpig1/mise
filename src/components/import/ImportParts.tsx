"use client";

// The two cards every file import starts with (คิวงานข้อ 5): the prompt for the
// shop's own AI, and the upload — a file, or a table pasted off the AI's
// answer. Shared by /products/import and /suppliers/import so a shop that has
// learnt one import has learnt them all.

import { useRef, useState, type DragEvent } from "react";

// ------------------------------------------------------------
// Step 1 — the prompt
// ------------------------------------------------------------

export function PromptCard({
  prompt,
  title,
  sub,
  templateHref,
}: {
  prompt: string;
  title: string;
  sub: string;
  /** A blank template for a shop that fills it by hand; omit when there is none. */
  templateHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  return (
    <section className="card grid content-start gap-3 !p-4 sm:!p-5">
      <span className="font-display text-[12.5px] font-semibold tracking-[0.08em] text-warn">{title}</span>
      <p className="text-sm text-muted-foreground">{sub}</p>
      <pre
        ref={pre}
        className={`m-0 whitespace-pre-wrap rounded-xl border border-border bg-surface-sunk px-3.5 py-3 font-sans text-[13.5px] leading-relaxed ${
          open ? "max-h-[420px] overflow-auto" : "max-h-[150px] overflow-hidden [mask-image:linear-gradient(#000_55%,transparent)]"
        }`}
      >
        {prompt}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            navigator.clipboard.writeText(prompt).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2400);
              },
              () => {
                // The browser refused the clipboard: select the text instead.
                setOpen(true);
                const r = document.createRange();
                if (pre.current) r.selectNodeContents(pre.current);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
              }
            )
          }
        >
          คัดลอกคำสั่ง
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-sm underline decoration-dotted underline-offset-4 hover:text-warn">
          {open ? "ย่อคำสั่ง" : "ดูคำสั่งทั้งหมด"}
        </button>
        {copied && (
          <span role="status" className="text-[13px] text-good">
            คัดลอกแล้ว
          </span>
        )}
      </div>
      {templateHref && (
        <p className="text-[13px] text-muted-foreground">
          ไม่ใช้ AI ก็ได้:{" "}
          <a href={templateHref} className="text-foreground underline decoration-dotted underline-offset-4 hover:text-warn">
            ดาวน์โหลดแม่แบบ Excel
          </a>{" "}
          แล้วกรอกเอง
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------
// Step 2 — the file, or a pasted table
// ------------------------------------------------------------

export function UploadCard({
  busy,
  error,
  onSend,
  pasteHint,
}: {
  busy: boolean;
  error: string | null;
  onSend: (b: FormData, label: string) => void;
  pasteHint: string;
}) {
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const sendFile = (f: File | undefined) => {
    if (!f) return;
    const b = new FormData();
    b.set("file", f);
    onSend(b, f.name);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    sendFile(e.dataTransfer.files[0]);
  };

  return (
    <section className="card grid content-start gap-3 !p-4 sm:!p-5">
      <span className="font-display text-[12.5px] font-semibold tracking-[0.08em] text-warn">ขั้น 2 · อัปโหลดผลลัพธ์</span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`grid justify-items-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          over ? "border-warn bg-warn-bg" : "border-border-strong bg-surface-sunk"
        }`}
      >
        <b className="font-display font-semibold">{busy ? "กำลังอ่านไฟล์…" : "ลากไฟล์มาวางที่นี่"}</b>
        <span className="text-[13.5px] text-muted-foreground">หรือ</span>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn-secondary btn-sm">
          เลือกไฟล์
        </button>
        <span className="text-[13.5px] text-muted-foreground">Excel (.xlsx) หรือ CSV</span>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            sendFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => setPasting((v) => !v)}
        aria-expanded={pasting}
        className="justify-self-center text-sm underline decoration-dotted underline-offset-4 hover:text-warn"
      >
        ได้ผลลัพธ์เป็นตาราง? วางตารางแทน
      </button>
      {pasting && (
        <div className="grid gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            autoFocus
            aria-label="วางตารางจาก AI"
            placeholder="เลือกตารางที่ AI ตอบมา คัดลอก แล้ววางที่นี่ (Ctrl+V)"
            className="input min-h-[110px] resize-y font-sans"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || text.trim() === ""}
              onClick={() => {
                const b = new FormData();
                b.set("text", text);
                onSend(b, "ตารางที่วาง");
              }}
              className="btn btn-sm"
            >
              {busy ? "กำลังอ่าน…" : "อ่านตาราง"}
            </button>
            <span className="text-[13px] text-muted-foreground">{pasteHint}</span>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
