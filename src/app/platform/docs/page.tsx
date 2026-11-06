// ADR 0045 Q5 — ขั้นตอนและเอกสาร: the legal drafts Kong can open at any time,
// and what to do (and by when) when something happens. Kong 2026-11-04:
// "โน้ตข้อกำหนดและเงื่อนไขไว้ให้ผมเปิดดูได้สักที่".
//
// The drafts are read from docs/legal/*.md — one source; editing the file
// changes this page. next.config's outputFileTracingIncludes carries them into
// the container, which otherwise holds only files Next traced on its own.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { BookOpen, FileText, ShieldCheck, ShieldAlert, Download, Trash2, KeyRound, UserRound, CalendarClock, Megaphone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import IconTile from "@/components/ui/IconTile";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { LEGAL_DOCS } from "@/lib/platform-overview";
import { PLAYBOOKS } from "@/lib/platform-playbooks";
import LegalMarkdown from "./_components/LegalMarkdown";

const DOC_ICON: Record<string, LucideIcon> = { terms: FileText, privacy: ShieldCheck };
const PLAY_ICON: Record<string, LucideIcon> = {
  breach: ShieldAlert,
  export: Download,
  delete: Trash2,
  "owner-email": KeyRound,
  "own-data": UserRound,
  "free-ending": CalendarClock,
  notice: Megaphone,
};
const TONE_TILE = { bad: "bg-bad-bg ring-bad-border [&_svg]:text-bad", warn: "bg-warn-bg ring-warn-border [&_svg]:text-warn", plain: "" } as const;
const TONE_CHIP = { bad: "chip-bad", warn: "chip-warn", plain: "" } as const;

async function readDraft(file: string): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), "docs", "legal", file), "utf8");
  } catch (e) {
    console.error(`[platform] legal draft ${file} not found`, e);
    return null;
  }
}

export default async function PlatformDocsPage() {
  await requirePlatformAdmin();
  const drafts = await Promise.all(LEGAL_DOCS.map(async (d) => ({ ...d, md: await readDraft(d.file) })));

  return (
    <div className="space-y-6">
      <div>
        <p className="font-display text-xs font-semibold tracking-[0.12em] text-gold-ink">หน้าควบคุมระบบ</p>
        <h1 className="page-title">ขั้นตอนและเอกสาร</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          เปิดอ่านร่างข้อกำหนดได้ตลอด และดูว่าเมื่อเกิดเรื่องแบบนี้ต้องทำอะไร ภายในกี่วัน · เรื่องที่มีกำหนดและระบบรู้เอง เช่น ช่วงใช้ฟรีใกล้หมด จะขึ้นในกล่องต้องทำที่หน้าภาพรวมด้วย
        </p>
      </div>

      <section className="grid gap-3 lg:grid-cols-2" aria-label="เอกสาร">
        {drafts.map((d) => {
          const Icon = DOC_ICON[d.key] ?? FileText;
          return (
            <details key={d.key} className="group min-w-0 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card open:lg:col-span-2">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 [&::-webkit-details-marker]:hidden">
                <IconTile icon={Icon} />
                <span className="font-display text-[15.5px] font-semibold">{d.title}</span>
                <span className="flex flex-wrap gap-1.5">
                  <span className="chip chip-warn">ร่างฉบับที่ {d.draft}</span>
                  <span className="chip">{d.lawyerReviewed ? "ทนายตรวจแล้ว" : "ทนายยังไม่ตรวจ"}</span>
                  <span className="chip">{d.published ? "ขึ้นหน้าเว็บแล้ว" : "ยังไม่ขึ้นหน้าเว็บ"}</span>
                </span>
                <span className="btn-secondary btn-sm ml-auto inline-flex items-center gap-1.5">
                  <BookOpen className="h-4 w-4" aria-hidden />
                  <span className="group-open:hidden">เปิดอ่าน</span>
                  <span className="hidden group-open:inline">ย่อ</span>
                </span>
              </summary>
              <div className="mt-4 border-t border-border/70 pt-4">
                {d.md ? (
                  <LegalMarkdown md={d.md} />
                ) : (
                  <p className="text-sm text-bad">ไม่พบไฟล์ docs/legal/{d.file} บนเซิร์ฟเวอร์นี้</p>
                )}
              </div>
            </details>
          );
        })}
      </section>

      <section className="space-y-3" aria-label="ขั้นตอนเมื่อเกิดเรื่อง">
        <h2 className="text-lg font-semibold">เมื่อเกิดเรื่องแบบนี้ ต้องทำอะไร</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {PLAYBOOKS.map((p) => {
            const Icon = PLAY_ICON[p.key] ?? FileText;
            return (
              <article key={p.key} className="min-w-0 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <IconTile icon={Icon} className={TONE_TILE[p.tone]} />
                  <h3 className="flex-1 text-[15px] font-semibold">{p.title}</h3>
                  <span className={`chip ${TONE_CHIP[p.tone]}`}>{p.deadline}</span>
                </div>
                <ol className="list-decimal space-y-1 pl-6 text-sm">
                  {p.steps.map((s) => (
                    <li key={s.text} className={s.notYet ? "text-muted-foreground" : ""}>
                      {s.notYet && <span className="chip mr-1.5 align-middle text-[11px]">ยังไม่มีปุ่ม</span>}
                      {s.text}
                    </li>
                  ))}
                </ol>
                {p.source && <p className="mt-2 text-xs text-muted-subtle">ที่มา: {p.source} (ร่าง)</p>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
