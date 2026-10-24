"use client";

// The part of a closing sheet that keeps moving after the window closes
// (ADR 0042 Q4/Q6): "จัดการแล้ว" on an issue, and comments that only append.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { addDailyCommentAction, resolveDailyIssueAction } from "../actions";
import { DAILY_ISSUE_CATEGORY_LABELS_TH, type DailyIssueCategoryValue } from "@/lib/validations/daily-close";
import type { DailyCloseDay } from "@/server/daily-close";

const when = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

export function IssueList({ issues, showForm }: { issues: DailyCloseDay["issues"]; showForm: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">{showForm ? "" : "ไม่มีปัญหาที่บันทึกไว้"}</p>;
  return (
    <div className="space-y-2">
      {issues.map((i) => {
        const open = i.followUp && !i.resolvedAt;
        return (
          <div key={i.id} className="space-y-1 rounded-xl border border-border bg-surface p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <b>{DAILY_ISSUE_CATEGORY_LABELS_TH[i.category as DailyIssueCategoryValue] ?? i.category}</b>
              <span
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${
                  i.resolvedAt ? "bg-good-bg text-good" : open ? "bg-bad-bg text-bad" : "bg-muted text-muted-foreground"
                }`}
              >
                {i.resolvedAt ? "จัดการแล้ว" : open ? "ต้องตามต่อ" : "จดไว้"}
              </span>
            </div>
            <p className="whitespace-pre-wrap">{i.body}</p>
            <p className="text-xs text-muted-subtle">
              {i.createdBy} · {when(i.createdAt)}
              {i.resolvedAt && ` · จัดการแล้วโดย ${i.resolvedBy} ${when(i.resolvedAt)}`}
            </p>
            {open && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await orStale(resolveDailyIssueAction(i.id));
                    if (r.ok) router.refresh();
                    else setError(r.formError ?? null);
                  })
                }
                className="rounded-full border border-border-strong bg-surface px-3 py-0.5 text-xs hover:bg-muted"
              >
                จัดการแล้ว
              </button>
            )}
          </div>
        );
      })}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

export function Comments({ closeId, comments }: { closeId: string; comments: DailyCloseDay["comments"] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 className="font-semibold">ความเห็น</h3>
        <p className="text-xs text-muted-subtle">เขียนต่อได้ตลอด แก้/ลบไม่ได้ · เก็บไว้ย้อนดูได้ไม่จำกัด</p>
      </div>
      {comments.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีความเห็น</p>}
      {comments.map((c) => (
        <div key={c.id} className="text-sm">
          <p>
            <b>{c.author}</b> <span className="text-xs text-muted-subtle">{when(c.createdAt)}</span>
          </p>
          <p className="mt-0.5 whitespace-pre-wrap rounded-xl bg-muted/60 px-3 py-2">{c.body}</p>
        </div>
      ))}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={1000} placeholder="เขียนความเห็น…" className="input w-full text-sm" />
      {error && <p className="text-xs text-bad">{error}</p>}
      <button
        type="button"
        disabled={pending || body.trim() === ""}
        onClick={() =>
          start(async () => {
            const r = await orStale(addDailyCommentAction(closeId, body));
            if (r.ok) {
              setBody("");
              setError(null);
              router.refresh();
            } else setError(r.formError ?? null);
          })
        }
        className="btn disabled:opacity-50"
      >
        {pending ? "กำลังส่ง…" : "ส่งความเห็น"}
      </button>
    </section>
  );
}
