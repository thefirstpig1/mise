// ============================================================
// Mise — "you do not have this permission" (Part 28 L3/L5, ADR 0029 Q13)
// ============================================================
// This page exists because 404 is a LIE. `notFound()` says the page does not
// exist, so the person reports that Mise is broken, and the owner goes looking
// for a bug that is really a permission. Rule A8: being refused is not the same
// as there being nothing there, and the screen has to say which.
//
// It names the capability rather than hiding it. A cook who reads
// "ต้องมีสิทธิ์: ดูต้นทุน" can ask for exactly that; "คุณไม่มีสิทธิ์เข้าถึง"
// alone leaves them with nothing to say to the person who could grant it.
// ============================================================

import Link from "next/link";
import { requireTenant } from "@/lib/require-tenant";

/**
 * Thai for each requirement. A capability with no entry falls back to its own
 * name — visibly ugly rather than silently blank, so the gap gets fixed.
 */
const NEED_TH: Record<string, string> = {
  "master:write": "แก้ไขข้อมูลหลัก (ผู้ขาย สินค้า หมวดหมู่ เมนู)",
  "purchase:write": "สร้างใบสั่งซื้อ",
  "purchase:approve": "ส่งหรือยกเลิกใบสั่งซื้อ",
  "receive:write": "รับของเข้าคลัง",
  "stock:write": "แก้ไขสต๊อก (ปรับยอด ของเสีย โอนสาขา)",
  "count:write": "นับสต๊อก",
  "expense:write": "บันทึกค่าใช้จ่าย",
  "sales:import": "นำเข้ายอดขายจาก POS",
  "consumption:post": "ตัดสต๊อกตามยอดขาย",
  "recipe:write": "แก้ไขสูตรอาหาร",
  "staffmeal:write": "บันทึกมื้อพนักงาน",
  "member:manage": "จัดการผู้ใช้ในร้าน",
  "settings:write": "แก้ไขการตั้งค่าร้าน",
  "cost:view": "ดูต้นทุนและกำไรขั้นต้น",
  "expense:view": "ดูค่าใช้จ่ายของร้าน",
  "sales:view": "ดูยอดขาย",
  "staff:view": "ดูประวัติมื้อพนักงานรายคน",
  branch: "เข้าถึงสาขานี้",
};

export default async function DeniedPage({
  // `searchParams` is a PROMISE in Next 15. The plain-object signature
  // type-checks under `tsc` and then fails `next build`, because the generated
  // route types live outside the tsconfig scope.
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  // Reaching this page needs nothing but membership — it is where people land
  // when they lacked something, so requiring anything here could bounce them
  // in a circle.
  await requireTenant("any:member");

  const { need } = await searchParams;
  const what = need ? (NEED_TH[need] ?? need) : null;
  const isBranch = need === "branch";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold">ยังไม่มีสิทธิ์ใช้หน้านี้</h1>

        <p className="mb-6 text-muted-foreground">
          {isBranch
            ? "บัญชีของคุณไม่ได้รับสิทธิ์ในสาขาที่กำลังเปิดอยู่"
            : "บัญชีของคุณเข้าใช้ Mise ได้ แต่ยังไม่ได้รับสิทธิ์ส่วนนี้"}
        </p>

        {what && (
          <div className="mb-6 rounded-lg border border-border p-4">
            <div className="mb-1 text-sm text-muted-foreground">
              สิทธิ์ที่ต้องใช้
            </div>
            <div className="font-medium">{what}</div>
          </div>
        )}

        <p className="mb-6 text-sm text-muted-foreground">
          {isBranch
            ? "ขอสิทธิ์สาขานี้ได้จากเจ้าของร้านหรือผู้จัดการ"
            : "ขอสิทธิ์นี้ได้จากเจ้าของร้านหรือผู้จัดการ โดยบอกชื่อสิทธิ์ข้างบนไปได้เลย"}
        </p>

        <Link
          href="/dashboard"
          className="inline-block rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </main>
  );
}
