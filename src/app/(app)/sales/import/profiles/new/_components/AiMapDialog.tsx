"use client";

// ============================================================
// คิดครัว — "ให้ AI ช่วยดู" on page 3 of the first sales import (Kong 2026-11-02, คิวข้อ 11 ก.)
// ============================================================
// Three steps on one sheet: copy the prompt (it already carries the header and
// a spread of rows, so nothing has to be attached), paste it into the shop's
// own AI, paste the code it answers back here. The code is read against the
// file this wizard holds (src/lib/sales-map-ai.ts) — a column the file does
// not have is refused, not resolved — and the wizard fills its answers in,
// each one labelled for the person to check.
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChatWindow, CopyPrompt } from "@/components/import/ImportGuide";
import { readSalesMapAnswer, SALES_MAP_ERROR_TH, SALES_MAP_TAG, type SalesMapAnswer } from "@/lib/sales-map-ai";

export default function AiMapDialog({
  prompt,
  header,
  rowsShown,
  onApply,
  onClose,
}: {
  prompt: string;
  header: string[];
  rowsShown: number;
  onApply: (a: SalesMapAnswer) => void;
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const win = useRef<HTMLDivElement>(null);

  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!ready) return;
    win.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [ready, onClose]);

  const use = () => {
    const r = readSalesMapAnswer(text, header);
    if (!r.ok) return setError(SALES_MAP_ERROR_TH[r.reason]);
    const a = r.answer;
    const answered = Object.keys(a.columns).length > 0 || a.includesVat !== null || a.includesServiceCharge !== null;
    if (!answered) return setError("คำตอบนี้ยังไม่มีข้อที่ใช้ได้ · ตอบเองในหน้านี้ได้เลย");
    onApply(a);
  };

  if (!ready) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid animate-fade-in items-end bg-black/50 backdrop-blur-[2px] sm:place-items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={win}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-map-title"
        tabIndex={-1}
        className="max-h-[92dvh] w-full animate-pop-in overflow-y-auto rounded-t-[22px] bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none sm:max-h-[calc(100dvh-48px)] sm:max-w-[560px] sm:rounded-[22px]"
      >
        <div className="flex items-start gap-3 px-5 pt-[18px] sm:px-[22px]">
          <div className="grid flex-1 gap-0.5">
            <h2 id="ai-map-title" className="text-xl font-semibold">
              ให้ AI ของร้านช่วยดูไฟล์นี้
            </h2>
            <p className="text-[13px] text-muted-foreground">ทำครั้งเดียวตอนตั้งไฟล์ · ครั้งต่อไปอัปไฟล์หน้าตาเดิมได้เลย</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="icon-btn shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <ol className="grid gap-4 px-5 pb-2 pt-4 sm:px-[22px]">
          <Step n={1} title="คัดลอกคำสั่ง">
            <CopyPrompt prompt={prompt} />
            <p className="text-[13px] text-muted-foreground">
              ในคำสั่งมีหัวตารางและตัวอย่าง {rowsShown} แถวจากไฟล์นี้อยู่แล้ว ไม่ต้องแนบไฟล์
            </p>
          </Step>

          <Step n={2} title="วางใน AI แล้วกดส่ง">
            <p className="text-[14.5px] text-muted-foreground">เปิด ChatGPT, Gemini หรือ Claude เริ่มแชตใหม่ วางคำสั่ง แล้วกดส่ง</p>
          </Step>

          <Step n={3} title="คัดลอกคำตอบของ AI มาวางที่นี่">
            <div className="grid grid-cols-[minmax(0,1fr)] place-items-center rounded-2xl border border-border bg-muted px-3.5 py-4">
              <ChatWindow>
                <div className="grid grid-cols-[minmax(0,1fr)] px-3 py-2.5">
                  <div className="grid max-w-[96%] justify-self-start gap-1.5 rounded-[14px] rounded-bl-[4px] bg-muted px-2.5 py-2 text-[12.5px]">
                    นี่คือคำตอบครับ
                    <div className="grid grid-cols-[minmax(0,1fr)] rounded-[10px] bg-foreground text-[11.5px] text-background">
                      <div className="flex items-center justify-between gap-2 border-b border-background/15 py-1 pl-2.5 pr-1.5">
                        <span className="font-mono opacity-70">json</span>
                        <span className="flex items-center gap-1.5">
                          <span className="whitespace-nowrap rounded-md bg-warn px-1.5 py-0.5 font-display text-[11px] font-semibold text-warn-foreground">กดคัดลอกทั้งกล่อง →</span>
                          <span className="rounded-md bg-background/15 px-2 py-0.5 ring-2 ring-warn">คัดลอก</span>
                        </span>
                      </div>
                      <code className="truncate px-2.5 py-1.5 font-mono">{`{"kitkrua":"${SALES_MAP_TAG}","columns":{…}}`}</code>
                    </div>
                  </div>
                </div>
              </ChatWindow>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">วางคำตอบ</span>
              <textarea
                value={text}
                onChange={(e) => (setText(e.target.value), setError(null))}
                rows={4}
                spellCheck={false}
                placeholder={`{"kitkrua":"${SALES_MAP_TAG}", …}`}
                className="input w-full font-mono text-[12.5px]"
              />
            </label>
            <p className="text-[13px] text-muted-foreground">บนมือถือ: กดค้างในช่อง แล้วเลือก “วาง” · วางทั้งข้อความที่ AI ตอบก็ได้ ระบบหารหัสเอง</p>
            {error && (
              <p role="alert" className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
                {error}
              </p>
            )}
          </Step>
        </ol>

        <div className="flex items-center justify-end gap-2.5 px-5 pb-5 pt-3 sm:px-[22px]">
          <button type="button" onClick={onClose} className="btn-secondary">
            ยกเลิก
          </button>
          <button type="button" onClick={use} disabled={text.trim() === ""} className="btn">
            ใช้คำตอบนี้
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
      <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-primary font-display text-sm font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="grid min-w-0 gap-2">
        <h3 className="pt-0.5 font-display text-[15px] font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  );
}
