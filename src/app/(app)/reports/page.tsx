// ============================================================
// คิดครัว — "เรื่องที่ฉันแจ้ง" (ADR 0044, mockup 2wtVT94pZjv1EX9xy8YVCp §3)
// ============================================================
// The reporter sees where each of their reports stands and what คิดครัว
// answered — closing the loop so nobody has to chase. Only THEIR reports:
// never a colleague's, not even for the owner (Kong 2026-11-03 "ตามนั้น").
//
// An answer they had not read yet is marked ใหม่ on this render; the list
// then marks them all seen (MarkSeen), which clears the sidebar's count.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { KIND_TH, reportNo, reportWhen } from "@/lib/problem-report";
import { fileUrl } from "@/lib/upload-photo";
import { listMyReportsLogic } from "@/server/problem-report";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import ReportStatusChip from "@/components/reports/ReportStatusChip";
import { MarkSeen, NewReportButton } from "./_components/ReportsClient";

export default async function MyReportsPage() {
  const { tenantId, user } = await requireTenant("any:member");
  const reports = await listMyReportsLogic(tenantId, user.id!);

  return (
    <div className="space-y-5">
      <PageHeader
        title="เรื่องที่ฉันแจ้ง"
        description="สถานะและคำตอบของเรื่องที่คุณแจ้งถึงคิดครัว · เห็นเฉพาะคุณ ผู้ใช้งานคนอื่นในร้านไม่เห็น"
        actions={reports.length > 0 ? <NewReportButton /> : null}
      />
      <MarkSeen any={reports.some((r) => r.unseen)} />

      {reports.length === 0 ? (
        <EmptyState art="start">
          <p className="font-display text-base font-semibold text-foreground">ยังไม่มีเรื่องที่แจ้ง</p>
          <p className="mt-1">เจอปัญหา มีข้อเสนอแนะ หรืออยากถามวิธีใช้ แจ้งได้จากปุ่ม “แจ้งปัญหาหรือเสนอแนะ” ท้ายเมนูข้างทุกหน้า</p>
          <div className="mt-3">
            <NewReportButton secondary />
          </div>
        </EmptyState>
      ) : (
        <ul className="grid max-w-3xl gap-3">
          {reports.map((r) => (
            <li key={r.id} className={`grid gap-2 rounded-[14px] border bg-surface px-4 py-3 shadow-card ${r.unseen ? "border-[#E2B39E]" : "border-border"}`}>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-display text-[13px] font-semibold tabular-nums text-muted-subtle">{reportNo(r.number)}</span>
                <ReportStatusChip status={r.status} />
                <span className="text-xs text-muted-subtle">
                  {KIND_TH[r.kind].label} · {reportWhen(r.createdAt)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[14.5px] [overflow-wrap:anywhere]">{r.message}</p>
              {r.fileIds.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {r.fileIds.map((id) => (
                    <a key={id} href={fileUrl(id)} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg border border-border-strong bg-surface-sunk hover:opacity-90">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(id, { thumb: true })} alt="รูปหน้าจอที่แนบ" className="h-full w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : null}
              {r.reply ? (
                <div className="grid gap-0.5 rounded-[10px] bg-[#EEF0DC] px-3 py-2 text-[13.5px]">
                  <b className="flex items-center gap-2 font-display text-xs font-semibold text-[#5F6638]">
                    คิดครัว{r.repliedAt ? ` · ${reportWhen(r.repliedAt, false)}` : ""}
                    {r.unseen ? <span className="rounded-full bg-[#C9734F] px-1.5 text-[10.5px] font-bold text-white">ใหม่</span> : null}
                  </b>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{r.reply}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
