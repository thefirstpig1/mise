import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await auth();

  // Logged in → go to dashboard
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-2xl text-center">
        <h1 className="mb-4 text-5xl font-bold tracking-tight">Mise</h1>
        <p className="mb-2 text-xl text-muted-foreground">
          ระบบหลังบ้านสำหรับร้านอาหาร
        </p>
        <p className="mb-8 text-sm text-muted-foreground">
          MarketMan-for-Thailand-SME — 90% ถูกกว่า, setup 30 นาที
        </p>

        <div className="flex justify-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-primary px-6 py-2 text-primary-foreground hover:opacity-90"
          >
            เข้าสู่ระบบ
          </Link>
          <Link
            href="/signup"
            className="rounded-lg border border-border px-6 py-2 hover:bg-muted"
          >
            สมัครใช้งาน
          </Link>
        </div>

        <div className="mt-12 text-xs text-muted-foreground">
          <p>Sprint 0 — Foundation + Auth + Tenant + Department</p>
        </div>
      </div>
    </main>
  );
}
