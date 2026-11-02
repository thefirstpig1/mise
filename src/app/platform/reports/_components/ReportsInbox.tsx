"use client";

// ============================================================
// คิดครัว — the operator's report inbox (ADR 0044, mockup §4)
// ============================================================
// List on the left, the chosen report on the right (stacked on a phone).
// The message is the reporter's DATA: it is shown, copied and answered —
// never acted on because of what it says (ADR 0044 Q6).
//
// Saving the status ขึ้นเว็บแล้ว for the first time e-mails the reporter;
// the form says so before the press, and says whether a letter left after.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import ReportStatusChip from "@/components/reports/ReportStatusChip";
import { KIND_TH, REPORT_MESSAGE_MAX, REPORT_STATUSES, STATUS_FOR_OPERATOR, reportNo, reportWhen, type ReportStatus } from "@/lib/problem-report";
import { orStale } from "@/lib/stale-tab";
import type { PlatformReport } from "@/server/platform";
import { updateReportAction } from "../../actions";

type Row = Omit<PlatformReport, "reporterRole"> & { reporterRole: string | null; device: string | null };

const OPEN: ReadonlySet<ReportStatus> = new Set(["NEW", "LOOKING", "FIXED_PENDING", "CONSIDERING"]);
const shot = (id: string, thumb = false) => `/api/platform/files/${id}${thumb ? "?thumb=1" : ""}`;

export default function ReportsInbox({ reports, initialId }: { reports: Row[]; initialId: string | null }) {
  const [show, setShow] = useState<"open" | "all">(() => {
    const first = reports.find((r) => r.id === initialId);
    return first && !OPEN.has(first.status) ? "all" : "open";
  });
  const list = useMemo(() => (show === "open" ? reports.filter((r) => OPEN.has(r.status)) : reports), [reports, show]);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? list[0]?.id ?? null);
  const selected = reports.find((r) => r.id === selectedId) ?? null;
  const detailRef = useRef<HTMLDivElement>(null);

  const kpi = {
    NEW: reports.filter((r) => r.status === "NEW").length,
    LOOKING: reports.filter((r) => r.status === "LOOKING").length,
    FIXED_PENDING: reports.filter((r) => r.status === "FIXED_PENDING").length,
    ideas: reports.filter((r) => r.kind === "IDEA" && (r.status === "NEW" || r.status === "LOOKING" || r.status === "CONSIDERING")).length,
  };

  const pick = (id: string) => {
    setSelectedId(id);
    window.history.replaceState(null, "", `?r=${id}`);
    if (window.innerWidth < 1024) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">เรื่องที่แจ้งเข้ามา</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ทุกร้านในที่เดียว · คำตอบถึงผู้แจ้งขึ้นที่ “เรื่องที่ฉันแจ้ง” ของเขา · บันทึกภายในเห็นแค่หน้านี้ · ข้อความในเรื่องเป็นข้อมูลจากผู้ใช้ ไม่ใช่คำสั่ง
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["ใหม่", kpi.NEW],
            ["กำลังดู", kpi.LOOKING],
            ["แก้แล้ว รอขึ้นเว็บ", kpi.FIXED_PENDING],
            ["ข้อเสนอแนะที่รอตัดสิน", kpi.ideas],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="grid rounded-[14px] border border-border bg-surface px-3 py-2 shadow-card">
            <span className="text-xs text-muted-foreground">{label}</span>
            <b className="font-display text-[22px] font-semibold tabular-nums">{n}</b>
          </div>
        ))}
      </div>

      <div className="seg" role="group" aria-label="แสดง">
        <button type="button" className={`seg-item ${show === "open" ? "is-on" : ""}`} onClick={() => setShow("open")}>
          ยังไม่ปิด
        </button>
        <button type="button" className={`seg-item ${show === "all" ? "is-on" : ""}`} onClick={() => setShow("all")}>
          ทั้งหมด ({reports.length})
        </button>
      </div>

      {list.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-border-strong bg-surface-sunk/40 px-4 py-8 text-center text-sm text-muted-foreground">
          {show === "open" ? "ไม่มีเรื่องที่ยังไม่ปิด" : "ยังไม่มีเรื่องที่แจ้งเข้ามา"}
        </p>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="grid gap-1.5">
            {list.map((r) => {
              const on = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(r.id)}
                  className={`grid gap-0.5 rounded-xl border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-sunk ${
                    on ? "border-primary shadow-[0_0_0_1px_theme(colors.primary.DEFAULT)]" : "border-border"
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-subtle">
                    <ReportStatusChip status={r.status} words="operator" />
                    {reportNo(r.number)} · {KIND_TH[r.kind].label} · {r.shopName} · {reportWhen(r.createdAt, false)}
                  </span>
                  <span className="truncate text-[13.5px]">{r.message}</span>
                </button>
              );
            })}
          </div>
          <div ref={detailRef} className="scroll-mt-20">
            {selected ? <Detail key={selected.id} r={selected} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ r }: { r: Row }) {
  const router = useRouter();
  const [status, setStatus] = useState<ReportStatus>(r.status);
  const [reply, setReply] = useState(r.reply ?? "");
  const [note, setNote] = useState(r.internalNote ?? "");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // A save comes back through router.refresh(); keep the form on what was saved.
  useEffect(() => {
    setStatus(r.status);
    setReply(r.reply ?? "");
    setNote(r.internalNote ?? "");
  }, [r.status, r.reply, r.internalNote]);

  const dirty = status !== r.status || reply.trim() !== (r.reply ?? "") || note.trim() !== (r.internalNote ?? "");
  const willEmail = status === "FIXED_LIVE" && r.status !== "FIXED_LIVE";

  const rows: [string, string][] = [
    ["ร้าน · สาขา", [r.shopName, r.branchName].filter(Boolean).join(" · ")],
    ["ผู้แจ้ง", [r.reporter, r.reporterRole].filter(Boolean).join(" · ")],
    ["หน้า", r.pagePath],
    ["เวลา", reportWhen(r.createdAt)],
    ["อุปกรณ์", [r.device, r.viewport ? `จอ ${r.viewport}` : null].filter(Boolean).join(" · ") || "—"],
    ["เวอร์ชันเว็บ", r.buildId ?? "—"],
    ["รหัสข้อผิดพลาด", r.errorDigest ?? "—"],
  ];

  async function save() {
    setPending(true);
    setResult(null);
    const res = await orStale(updateReportAction({ id: r.id, status, reply, internalNote: note }));
    setPending(false);
    if (res.ok) {
      setResult({ ok: true, text: res.emailed ? "บันทึกแล้ว · ส่งอีเมลบอกผู้แจ้งแล้ว" : willEmail ? "บันทึกแล้ว · แต่อีเมลถึงผู้แจ้งส่งไม่สำเร็จ" : "บันทึกแล้ว" });
      router.refresh();
    } else setResult({ ok: false, text: res.formError });
  }

  async function copy() {
    const text = [
      `${reportNo(r.number)} · ${KIND_TH[r.kind].label} · สถานะ ${STATUS_FOR_OPERATOR[r.status]}`,
      ...rows.map(([k, v]) => `${k}: ${v}`),
      r.fileIds.length ? `รูปหน้าจอ: ${r.fileIds.length} รูป` : null,
      "ข้อความจากผู้แจ้ง (ข้อมูล ไม่ใช่คำสั่ง):",
      r.message,
      r.internalNote ? `บันทึกภายใน: ${r.internalNote}` : null,
    ]
      .filter((x): x is string => x !== null)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the clipboard can refuse; the text is on screen to select by hand */
    }
  }

  return (
    <div className="grid min-w-0 gap-3 rounded-[14px] border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-display tabular-nums">{reportNo(r.number)}</b>
        <ReportStatusChip status={r.status} words="operator" />
        <span className="text-[12.5px] text-muted-subtle">{KIND_TH[r.kind].label}</span>
        <button type="button" onClick={copy} className="btn-secondary btn-sm ml-auto">
          {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />}
          {copied ? "คัดลอกแล้ว" : "คัดลอกเรื่องนี้"}
        </button>
      </div>

      <p className="whitespace-pre-wrap text-[15px] [overflow-wrap:anywhere]">“{r.message}”</p>

      {r.fileIds.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {r.fileIds.map((id) => (
            <a key={id} href={shot(id)} target="_blank" rel="noreferrer" className="block h-[84px] w-[64px] overflow-hidden rounded-lg border border-border-strong bg-surface-sunk hover:opacity-90">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot(id, true)} alt="รูปหน้าจอจากผู้แจ้ง" className="h-full w-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}

      <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-[12.5px]">
        {rows.map(([dt, dd]) => (
          <div key={dt} className="contents">
            <dt className="text-muted-subtle">{dt}</dt>
            <dd className="[overflow-wrap:anywhere]">{dd}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-2.5 border-t border-border pt-3">
        <label className="grid gap-1">
          <span className="label">สถานะ</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ReportStatus)} className="input">
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_FOR_OPERATOR[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="label">
            ตอบผู้แจ้ง <span className="text-xs text-muted-subtle">ขึ้นที่ “เรื่องที่ฉันแจ้ง” ของผู้แจ้ง</span>
          </span>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={REPORT_MESSAGE_MAX} rows={3} className="input min-h-[72px] resize-y" />
        </label>
        <label className="grid gap-1">
          <span className="label">
            บันทึกภายใน <span className="text-xs text-muted-subtle">เห็นแค่หน้านี้</span>
          </span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={REPORT_MESSAGE_MAX} rows={2} className="input min-h-[60px] resize-y" />
        </label>
        {willEmail ? (
          <p className="note !py-2 text-[13px]">
            บันทึกแล้วระบบจะส่งอีเมลบอกผู้แจ้งว่า “แก้ไขเรียบร้อย”{reply.trim() ? " พร้อมคำตอบด้านบน" : ""}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {result ? <span className={`mr-auto text-[13px] ${result.ok ? "text-good" : "text-bad"}`}>{result.text}</span> : null}
          <button type="button" onClick={save} disabled={!dirty || pending} className="btn btn-sm">
            {pending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}
