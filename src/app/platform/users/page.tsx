// ADR 0043 Q3 — "which shop is this person in": search by e-mail or name.
// A plain GET form, so the result is a link the operator can send or reload.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { searchUsersLogic } from "@/server/platform";

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
        <h1 className="text-2xl font-semibold">ค้นหาผู้ใช้</h1>
        <p className="mt-1 text-sm text-muted-foreground">พิมพ์บางส่วนของอีเมลหรือชื่อ อย่างน้อย 2 ตัวอักษร</p>
      </div>
      <form method="get" className="flex max-w-lg gap-2">
        <input name="q" defaultValue={q} className="input w-full" placeholder="เช่น somchai@ หรือ สมชาย" autoFocus />
        <button type="submit" className="btn">
          ค้นหา
        </button>
      </form>
      {q.trim().length >= 2 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="data-table w-full min-w-[640px]">
            <thead>
              <tr>
                <th>ผู้ใช้</th>
                <th>สมัครเมื่อ</th>
                <th>อยู่ร้านไหนบ้าง</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="font-medium">{u.name ?? "—"}</span>
                    <span className="block text-sm text-muted-foreground">{u.email}</span>
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
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
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
