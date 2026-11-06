// ADR 0043 Q3 — "which shop is this person in": search by e-mail or name.
// A plain GET form, so the result is a link the operator can send or reload.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { searchUsersLogic } from "@/server/platform";
import ChangeEmail from "../_components/ChangeEmail";

const ROLE: Record<string, string> = {
  owner: "เจ้าของ",
  admin: "ส่วนกลาง",
  manager: "ผู้จัดการ",
  purchaser: "จัดซื้อ",
  kitchen_staff: "พนักงานครัว",
  dept_head: "หัวหน้าแผนก",
  cashier: "แคชเชียร์",
  accountant: "บัญชี",
  viewer: "ดูอย่างเดียว",
};

export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePlatformAdmin();
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const users = await searchUsersLogic(actor, q);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">ค้นหาผู้ใช้</h1>
        <p className="mt-1 text-sm text-muted-foreground">พิมพ์บางส่วนของอีเมลหรือชื่อ อย่างน้อย 2 ตัวอักษร</p>
      </div>
      <form method="get" className="flex max-w-lg gap-2">
        <input name="q" defaultValue={q} className="input w-full" placeholder="เช่น somchai@ หรือ สมชาย" autoFocus />
        <button type="submit" className="btn">
          ค้นหา
        </button>
      </form>
      {q.trim().length >= 2 && (
        <div className="overflow-x-auto rounded-[18px] border border-border/70 bg-surface shadow-card">
          <table className="data-table w-full min-w-[820px]">
            <thead>
              <tr>
                <th>ผู้ใช้</th>
                <th>สมัครเมื่อ</th>
                <th>อยู่ร้านไหนบ้าง</th>
                <th>เข้าสู่ระบบล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="font-medium">{u.name ?? "—"}</span>
                    <span className="block text-sm text-muted-foreground">{u.email}</span>
                    <ChangeEmail userId={u.id} email={u.email} shops={u.memberships.filter((m) => m.active).map((m) => m.shop)} />
                  </td>
                  <td className="text-sm">{u.createdAt.slice(0, 10)}</td>
                  <td className="text-sm">
                    {u.memberships.length === 0
                      ? "ยังไม่อยู่ร้านไหน"
                      : u.memberships.map((m) => (
                          <span key={m.tenantId} className="mr-2 inline-flex items-center gap-1">
                            {m.shop} <span className="chip">{ROLE[m.role] ?? m.role}</span>
                            {!m.active && <span className="chip chip-bad">ปิดแล้ว</span>}
                          </span>
                        ))}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {u.logins.length === 0
                      ? "ยังไม่มีบันทึก"
                      : u.logins.map((l) => (
                          <span key={l.at} className="block whitespace-nowrap">
                            {new Date(l.at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            {l.device ? ` · ${l.device}` : ""}
                            {l.ip ? ` · ${l.ip}` : ""}
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    ไม่พบผู้ใช้ที่ตรงกับ “{q}”
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
