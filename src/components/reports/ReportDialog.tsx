"use client";

// ============================================================
// คิดครัว — "แจ้งปัญหาหรือเสนอแนะ" (ADR 0044, mockup 2wtVT94pZjv1EX9xy8YVCp)
// ============================================================
// One required field — the message. Everything else the app attaches itself,
// and SAYS what it attached (the page, the time, the device, the web version,
// the error code), because a person deciding whether to send deserves to know
// what goes with it. Nothing of the shop's numbers goes.
//
// No automatic screenshot: it needs a new dependency and could capture figures
// the shop did not mean to send. The reporter takes their own and attaches it
// — picked, dropped, or pasted (Ctrl/⌘+V) straight into the form.
//
// Closing does not lose the draft: the component stays mounted and renders
// nothing while closed, so a slip of the hand outside the box costs nothing.
// Rendered into <body> through a portal (mise-ui-review §7).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bug, Check, CircleHelp, FileText, ImagePlus, Lightbulb, X, type LucideIcon } from "lucide-react";
import { sendReportAction } from "@/app/(app)/reports/actions";
import { KIND_TH, REPORT_FILES_MAX, REPORT_KINDS, REPORT_MESSAGE_MAX, deviceOf, reportNo, reportWhen, type ReportKind } from "@/lib/problem-report";
import { CLIENT_BUILD_ID, orStale } from "@/lib/stale-tab";
import { uploadPhoto } from "@/lib/upload-photo";

const KIND_ICON: Record<ReportKind, LucideIcon> = { PROBLEM: Bug, IDEA: Lightbulb, QUESTION: CircleHelp };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Shot = { key: string; preview: string; id?: string; error?: string };

export default function ReportDialog({
  open,
  onClose,
  initialKind = "PROBLEM",
  errorDigest,
  shopName,
  userLabel,
  pageLabel,
  newReplies = 0,
}: {
  open: boolean;
  onClose: () => void;
  initialKind?: ReportKind;
  /** The error page's code, so the log line can be found (error.tsx). */
  errorDigest?: string;
  shopName?: string;
  userLabel?: string;
  /** The sidebar's name for the page ("รับสินค้า"), when it has one. */
  pageLabel?: string;
  /** Answers to this person's reports they have not opened yet. */
  newReplies?: number;
}) {
  const [kind, setKind] = useState<ReportKind>(initialKind);
  const [message, setMessage] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const [ctx, setCtx] = useState<{ path: string; at: Date; device: string; ua: string; viewport: string; branchId?: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // What is attached is read when the form OPENS — the page they were on.
  useEffect(() => {
    if (!open) return;
    const branch = new URLSearchParams(window.location.search).get("branch");
    setCtx({
      path: (window.location.pathname + window.location.search).slice(0, 500),
      at: new Date(),
      ua: navigator.userAgent.slice(0, 500),
      device: deviceOf(navigator.userAgent),
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      branchId: branch && UUID.test(branch) ? branch : undefined,
    });
    const t = setTimeout(() => textRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addFiles = useCallback(
    (files: File[]) => {
      const room = REPORT_FILES_MAX - shots.length;
      const take = files.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
      if (take.length === 0) return;
      setError(null);
      for (const f of take) {
        const key = `${Date.now()}-${Math.random()}`;
        setShots((s) => [...s, { key, preview: URL.createObjectURL(f) }]);
        void uploadPhoto(f, "REPORT_SCREENSHOT").then((r) =>
          setShots((s) => s.map((x) => (x.key !== key ? x : r.ok ? { ...x, id: r.file.id } : { ...x, error: r.formError })))
        );
      }
    },
    [shots.length]
  );

  const removeShot = (key: string) =>
    setShots((s) => {
      const gone = s.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return s.filter((x) => x.key !== key);
    });

  const reset = () => {
    shots.forEach((s) => URL.revokeObjectURL(s.preview));
    setShots([]);
    setMessage("");
    setError(null);
    setSent(null);
    setKind(initialKind);
  };

  // A sent report is finished: closing after the thank-you starts the next one fresh.
  const close = () => {
    if (sent !== null) reset();
    onClose();
  };

  const uploading = shots.some((s) => !s.id && !s.error);
  const canSend = message.trim().length > 0 && !uploading && !pending;

  async function send() {
    if (!canSend || !ctx) return;
    setPending(true);
    setError(null);
    const r = await orStale(
      sendReportAction({
        kind,
        message,
        pagePath: ctx.path,
        branchId: ctx.branchId,
        buildId: CLIENT_BUILD_ID || undefined,
        userAgent: ctx.ua,
        viewport: ctx.viewport,
        errorDigest: errorDigest || undefined,
        fileIds: shots.filter((s) => s.id).map((s) => s.id!),
      })
    );
    setPending(false);
    if (r.ok) {
      shots.forEach((s) => URL.revokeObjectURL(s.preview));
      setShots([]);
      setMessage("");
      setSent(r.number);
    } else setError(r.formError);
  }

  if (!open || typeof document === "undefined") return null;
  const k = KIND_TH[kind];
  const rows: [string, string][] = ctx
    ? [
        ["หน้า", pageLabel ? `${pageLabel} · ${ctx.path.split("?")[0]}` : ctx.path.split("?")[0]],
        ...(ctx.branchId ? ([["สาขา", "สาขาที่เลือกอยู่ในหน้านี้"]] as [string, string][]) : []),
        ["เวลา", reportWhen(ctx.at)],
        ["ร้าน", shopName ?? "ร้านที่เข้าใช้งานอยู่"],
        ["ผู้แจ้ง", userLabel ?? "บัญชีที่เข้าสู่ระบบอยู่"],
        ["อุปกรณ์", `${ctx.device} · จอ ${ctx.viewport}`],
        ...(CLIENT_BUILD_ID ? ([["เวอร์ชันเว็บ", CLIENT_BUILD_ID]] as [string, string][]) : []),
        ...(errorDigest ? ([["รหัสข้อผิดพลาด", errorDigest]] as [string, string][]) : []),
      ]
    : [];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onPaste={(e) => {
          if (sent !== null) return;
          const files = Array.from(e.clipboardData.files ?? []);
          if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            addFiles(files);
          }
        }}
        className="flex max-h-[92vh] w-full animate-pop-in flex-col overflow-hidden rounded-t-[20px] border border-border-strong bg-background shadow-xl sm:max-w-[520px] sm:rounded-[20px]"
      >
        {sent === null ? (
          <>
            <div className="flex items-start justify-between gap-3 px-5 pb-1.5 pt-4">
              <div>
                <h3 id="report-title" className="font-display text-lg font-semibold">
                  แจ้งปัญหาหรือเสนอแนะ
                </h3>
                <p className="text-[13px] text-muted-foreground">ส่งถึงคิดครัวโดยตรง · ผู้ใช้งานคนอื่นในร้านไม่เห็น</p>
              </div>
              <button type="button" onClick={close} aria-label="ปิด" className="icon-btn -mr-1">
                <X className="h-5 w-5" strokeWidth={1.9} />
              </button>
            </div>

            <div className="grid min-h-0 gap-3.5 overflow-y-auto px-5 pb-4 pt-2">
              {newReplies > 0 ? (
                <Link href="/reports" onClick={onClose} className="note flex items-center justify-between gap-2 !py-2 text-[13px] hover:bg-[#E6E9CF]">
                  <span>
                    มีคำตอบใหม่ <b className="text-foreground">{newReplies} เรื่อง</b> ในเรื่องที่คุณแจ้งไว้
                  </span>
                  <span className="whitespace-nowrap font-display font-semibold text-primary">ดูคำตอบ</span>
                </Link>
              ) : null}

              <div className="grid grid-cols-3 gap-2" role="group" aria-label="ประเภท">
                {REPORT_KINDS.map((key) => {
                  const Icon = KIND_ICON[key];
                  const on = key === kind;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setKind(key)}
                      className={`grid justify-items-center gap-1 rounded-[14px] border px-2 py-2.5 text-center transition-colors ${
                        on ? "border-primary bg-primary-soft shadow-[0_0_0_1px_theme(colors.primary.DEFAULT)]" : "border-border-strong bg-surface hover:bg-surface-sunk"
                      }`}
                    >
                      <span className={`grid h-[34px] w-[34px] place-items-center rounded-[11px] ${on ? "bg-primary text-primary-foreground" : "bg-[#EEF0DC] text-[#7D8550]"}`}>
                        <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} aria-hidden />
                      </span>
                      <b className="font-display text-[13.5px] font-semibold text-foreground">{KIND_TH[key].label}</b>
                      <small className="hidden text-[12px] leading-snug text-muted-foreground [text-wrap:balance] sm:block">{KIND_TH[key].sub}</small>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-1.5">
                <label htmlFor="report-message" className="label">
                  {k.ask}
                </label>
                <textarea
                  id="report-message"
                  ref={textRef}
                  value={message}
                  maxLength={REPORT_MESSAGE_MAX}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={k.example}
                  rows={4}
                  className="input min-h-[104px] resize-y"
                />
                <span className="text-xs text-muted-subtle">{k.hint}</span>
              </div>

              <div className="grid gap-1.5">
                <p className="label">
                  รูปหน้าจอ <span className="text-xs text-muted-subtle">ไม่บังคับ · ได้สูงสุด {REPORT_FILES_MAX} รูป</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {shots.map((s) => (
                    <div key={s.key} className="relative h-[68px] w-[68px] overflow-hidden rounded-xl border border-border-strong bg-surface-sunk">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.preview} alt="รูปหน้าจอที่แนบ" className={`h-full w-full object-cover ${s.id ? "" : "opacity-50"}`} />
                      {!s.id && !s.error ? (
                        <span className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-center text-[10.5px] text-white">กำลังอัปโหลด</span>
                      ) : null}
                      {s.error ? <span className="absolute inset-x-0 bottom-0 bg-bad py-0.5 text-center text-[10.5px] text-white">แนบไม่ได้</span> : null}
                      <button
                        type="button"
                        onClick={() => removeShot(s.key)}
                        aria-label="เอารูปนี้ออก"
                        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
                      >
                        <X className="h-3 w-3" strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                  {shots.length < REPORT_FILES_MAX ? (
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setOver(true);
                      }}
                      onDragLeave={() => setOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setOver(false);
                        addFiles(Array.from(e.dataTransfer.files ?? []));
                      }}
                      className={`flex min-h-[68px] min-w-0 flex-1 items-center gap-2.5 rounded-xl border-[1.5px] border-dashed px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors ${
                        over ? "border-primary bg-primary/5" : "border-primary-line bg-surface-sunk hover:bg-muted"
                      }`}
                    >
                      <ImagePlus className="h-5 w-5 shrink-0 text-[#7D8550]" strokeWidth={1.8} aria-hidden />
                      <span>
                        แตะเพื่อเลือกรูป
                        <span className="hidden sm:inline"> ลากมาวาง หรือกด Ctrl+V วางรูปหน้าจอที่จับไว้</span>
                      </span>
                    </button>
                  ) : null}
                </div>
                {shots.find((s) => s.error) ? <p className="text-xs text-bad">{shots.find((s) => s.error)!.error}</p> : null}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </div>

              <details className="group rounded-xl border border-border bg-surface">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[13px] text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <span>
                    <b className="font-display font-semibold text-foreground">
                      <FileText className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-[#7D8550]" strokeWidth={1.9} aria-hidden />
                      ข้อมูลที่แนบไปด้วย
                    </b>{" "}
                    · {rows.length} รายการ
                  </span>
                  <span className="text-xs group-open:hidden">ดู</span>
                  <span className="hidden text-xs group-open:inline">ซ่อน</span>
                </summary>
                <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 px-3 pb-2 text-[12.5px]">
                  {rows.map(([dt, dd]) => (
                    <div key={dt} className="contents">
                      <dt className="text-muted-subtle">{dt}</dt>
                      <dd className="[overflow-wrap:anywhere]">{dd}</dd>
                    </div>
                  ))}
                </dl>
                <p className="px-3 pb-2.5 text-xs text-muted-foreground">เรื่องนี้เห็นเฉพาะคุณและคิดครัว · ไม่ได้แนบตัวเลขของร้านไปด้วย</p>
              </details>

              {error ? <p className="rounded-xl bg-bad-bg px-3 py-2 text-[13px] text-bad">{error}</p> : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <span className="min-w-0 flex-[1_1_180px] text-[12.5px] text-muted-foreground">
                ติดตามสถานะได้ที่{" "}
                <Link href="/reports" onClick={onClose} className="font-medium text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid">
                  เรื่องที่ฉันแจ้ง
                </Link>
              </span>
              <button type="button" onClick={close} className="btn-secondary btn-sm">
                ยกเลิก
              </button>
              <button type="button" onClick={send} disabled={!canSend} className="btn btn-sm">
                {pending ? "กำลังส่ง…" : uploading ? "รอรูปอัปโหลด…" : "ส่ง"}
              </button>
            </div>
          </>
        ) : (
          <div className="grid justify-items-center gap-2.5 px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-7 text-center">
            <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-good-bg text-good">
              <Check className="h-[26px] w-[26px]" strokeWidth={2.2} aria-hidden />
            </div>
            <h3 id="report-title" className="font-display text-base font-semibold">
              ได้รับเรื่องแล้ว ขอบคุณที่แจ้งให้ทราบ
            </h3>
            <span className="font-display text-[22px] font-semibold tabular-nums">เลขที่เรื่อง {reportNo(sent)}</span>
            <p className="max-w-[44ch] text-[13.5px] text-muted-foreground">
              สถานะและคำตอบจะขึ้นที่ “เรื่องที่ฉันแจ้ง” · มีคำตอบใหม่จะมีตัวเลขขึ้นที่ปุ่มแจ้งปัญหา · แก้ไขเรียบร้อยแล้วจะมีอีเมลแจ้งด้วย
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <button type="button" onClick={reset} className="btn-secondary btn-sm">
                ส่งอีกเรื่อง
              </button>
              <Link
                href="/reports"
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="btn btn-sm"
              >
                ดูเรื่องที่ฉันแจ้ง
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
