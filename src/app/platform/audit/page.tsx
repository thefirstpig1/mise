// ADR 0043 Q4 — every change made from the platform screens, newest first.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { listAuditLogic } from "@/server/platform";

const ACTION: Record<string, string> = { set_plan: "แก้แพ็กเกจ" };
const PLAN: Record<string, string> = { trial: "ทดลองใช้", standard: "มาตรฐาน" };

type PlanState = { plan?: string; freeUntil?: string | null; note?: string | null } | null;
const MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDate = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTH[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(0, 4)) + 543}`;
const describe = (s: unknown) => {
  const p = s as PlanState;
  if (!p) return "—";
  return [PLAN[p.plan ?? ""] ?? p.plan, p.freeUntil ? `ฟรีถึง ${thDate(p.freeUntil)}` : "ไม่กำหนดวัน", p.note ? `“${p.note}”` : null].filter(Boolean).join(" · ");
};

export default async function PlatformAuditPage() {
  const actor = await requirePlatformAdmin();
  const rows = await listAuditLogic(actor);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">บันทึกการแก้ไข</h1>
        <p className="mt-1 text-sm text-muted-foreground">ทุกการแก้จากหน้าผู้ดูแลระบบ — ใคร แก้ร้านไหน จากอะไรเป็นอะไร · ลบหรือแก้บันทึกไม่ได้</p>
      </div>
      <div className="overflow-x-auto rounded-[18px] border border-border/70 bg-surface shadow-card">
        <table className="data-table w-full min-w-[760px]">
          <thead>
            <tr>
              <th>เมื่อ</th>
              <th>ใคร</th>
              <th>ทำอะไร</th>
              <th>ร้าน</th>
              <th>ก่อน → หลัง</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-sm">
                  {new Date(r.at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })}
                </td>
                <td className="text-sm">{r.actor}</td>
                <td className="text-sm">{ACTION[r.action] ?? r.action}</td>
                <td className="text-sm">{r.target ?? "—"}</td>
                <td className="text-sm">
                  <span className="text-muted-foreground">{describe(r.before)}</span> → {describe(r.after)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  ยังไม่มีการแก้ไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
