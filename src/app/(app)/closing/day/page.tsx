// /closing/day?branch=&date= — one branch's ปิดร้านประจำวัน (ADR 0042).
// The form while the sheet can still be edited (until 00:00 of D+2) and the
// reader holds sales:import; the read-only sheet otherwise. Issues and
// comments keep moving after the window closes. Money (sales, per head, cash
// short/over) only for sales:view (Q7).
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getDailyCloseDayLogic } from "@/server/daily-close";
import { cashDifference } from "@/lib/validations/daily-close";
import CloseForm from "../_components/CloseForm";
import { Comments, IssueList } from "../_components/IssuesAndComments";
import { MixBar } from "../_components/mix";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const baht = (n: number, d = 0) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const longDate = (d: Date) => d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export default async function ClosingDayPage({ searchParams }: { searchParams: Promise<{ branch?: string; date?: string }> }) {
  const { tenantId, reach, can, membership } = await requireTenant("any:member");
  const sp = await searchParams;
  const branches = await getBranchesLogic(tenantId, reach);
  if (branches.length === 0) return <div className="p-6 text-sm">ยังไม่มีสาขาในระบบ</div>;
  const branch = branches.find((b) => b.id === sp.branch) ?? branches[0];
  const today = computeBangkokToday();
  const requested = sp.date && DAY.test(sp.date) ? new Date(`${sp.date}T00:00:00Z`) : today;
  const date = requested.getTime() > today.getTime() ? today : requested;

  const day = await getDailyCloseDayLogic(tenantId, branch.id, date);
  const enabled = membership.tenant.dailyCloseEnabled;
  const canFill = can("sales:import") && enabled;
  const seeMoney = can("sales:view");
  const editing = canFill && day.editable;
  const order = day.customerTypes.map((t) => t.id);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const link = (d: Date, b = branch.id) => `/closing/day?branch=${b}&date=${iso(d)}`;
  const prev = addDays(date, -1);
  const next = addDays(date, 1);

  const diff = day.close ? cashDifference(day.close) : null;
  const perHead = day.netRevenue !== null && day.guestCount ? day.netRevenue / day.guestCount : null;
  const slices = day.mix
    .map((m) => ({ id: m.customerTypeId, name: day.customerTypes.find((t) => t.id === m.customerTypeId)?.name ?? "", share: m.parts / 10 }))
    .sort((a, b) => b.share - a.share);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <a href="/closing" className="text-muted-foreground hover:text-foreground">
            ‹ ปิดร้านย้อนหลัง
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {branches.length > 1 &&
            branches.map((b) => (
              <a
                key={b.id}
                href={link(date, b.id)}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${b.id === branch.id ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`}
              >
                {b.name}
              </a>
            ))}
          <a href={link(prev)} className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted" aria-label="วันก่อนหน้า">
            ‹
          </a>
          {date.getTime() < today.getTime() && (
            <a href={link(next)} className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted" aria-label="วันถัดไป">
              ›
            </a>
          )}
        </div>
      </div>

      {editing ? (
        <CloseForm day={day} branchName={branch.name} dateLabel={longDate(date)} />
      ) : (
        <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">
                ปิดร้าน · {branch.name} · {longDate(date)}
              </h2>
              <p className="text-xs text-muted-subtle">
                {day.close
                  ? `ปิดโดย ${day.close.closedBy} · ${new Date(day.close.closedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}${day.editable ? "" : " · ล็อกแล้ว"}`
                  : day.editable
                    ? enabled
                      ? "ยังไม่ได้ปิดร้าน"
                      : "ร้านยังไม่ได้เปิดใช้รายงานปิดร้าน"
                    : "ไม่มีใบปิดร้านของวันนี้"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {seeMoney && (
              <div className="rounded-xl border border-border p-3">
                <span className="text-xs text-muted-subtle">ยอดขาย</span>
                <b className="block font-display text-xl tabular-nums">{day.netRevenue === null ? "—" : baht(day.netRevenue)}</b>
                <span className="text-xs text-muted-subtle">{day.netRevenue === null ? "ยังไม่มีไฟล์ยอดขาย" : "หลังส่วนลด ไม่รวม VAT/ค่าบริการ"}</span>
              </div>
            )}
            <div className="rounded-xl border border-border p-3">
              <span className="text-xs text-muted-subtle">ลูกค้า</span>
              <b className="block font-display text-xl tabular-nums">{day.guestCount === null ? "—" : `${day.guestCount.toLocaleString("th-TH")} คน`}</b>
              <span className="text-xs text-muted-subtle">{day.guestCountSource === "POS" ? "จาก POS" : day.guestCount === null ? "ไม่ได้กรอก" : "กรอกจากหน้าจอ POS"}</span>
            </div>
            {seeMoney && (
              <div className="rounded-xl border border-border p-3">
                <span className="text-xs text-muted-subtle">ต่อหัว</span>
                <b className="block font-display text-xl tabular-nums">{perHead === null ? "—" : baht(perHead, 1)}</b>
                <span className="text-xs text-muted-subtle">ยอดขาย ÷ ลูกค้า</span>
              </div>
            )}
            {seeMoney && (
              <div className="rounded-xl border border-border p-3">
                <span className="text-xs text-muted-subtle">เงินสด</span>
                <b className={`block font-display text-xl tabular-nums ${diff !== null && diff !== 0 ? "text-bad" : ""}`}>
                  {diff === null ? "—" : diff === 0 ? "ตรง" : diff < 0 ? `ขาด ${baht(-diff, 2)}` : `เกิน ${baht(diff, 2)}`}
                </b>
                <span className="text-xs text-muted-subtle">{day.close?.cashNote ? `“${day.close.cashNote}”` : diff === null ? "กรอกไม่ครบ / ไม่ได้นับ" : ""}</span>
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted-subtle">
              ลูกค้าส่วนใหญ่เป็นใคร <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[11px] text-warn">ประมาณ</span> · คนปิดร้านประเมิน
            </p>
            <MixBar slices={slices} order={order} />
          </div>
          {seeMoney && day.pulseAmount !== null && (
            <p className="text-xs text-muted-subtle">ยอดที่ลูกค้าจ่าย (คีย์ตอนปิดร้าน) {baht(day.pulseAmount, 2)}</p>
          )}
        </section>
      )}

      {day.close && (
        <div className={`grid gap-4 ${editing ? "mx-auto max-w-md" : "lg:grid-cols-[1fr_380px]"}`}>
          {!editing && (
            <section className="space-y-2">
              <h3 className="font-semibold">ปัญหา</h3>
              <IssueList issues={day.issues} showForm={false} />
            </section>
          )}
          {editing && day.issues.some((i) => i.followUp) && (
            <section className="space-y-2">
              <h3 className="font-semibold">สถานะปัญหาที่ต้องตามต่อ</h3>
              <IssueList issues={day.issues.filter((i) => i.followUp)} showForm />
            </section>
          )}
          <Comments closeId={day.close.id} comments={day.comments} />
        </div>
      )}
    </div>
  );
}
