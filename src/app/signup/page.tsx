import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createTenant } from "@/server/tenant-init";
import { signIn } from "@/lib/auth";
import Logo from "@/components/layout/Logo";

async function handleSignup(formData: FormData) {
  "use server";

  const email = formData.get("email") as string;
  const name = formData.get("name") as string;
  const tenantName = formData.get("tenant_name") as string;
  const branchName = formData.get("branch_name") as string;
  const isVatRegistered = formData.get("is_vat_registered") === "on";

  if (!email || !tenantName) {
    throw new Error("กรุณากรอกข้อมูลให้ครบ");
  }

  // 1. Create user (or find existing)
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, emailVerified: null },
    update: { name },
  });

  // 2. Create tenant with full init
  await createTenant({
    ownerUserId: user.id,
    tenantName,
    isVatRegistered,
    firstBranchName: branchName || "สาขาหลัก",
  });

  // 3. Send magic link to login
  //
  // 🔴 THE SHOP ALREADY EXISTS BY THE TIME WE GET HERE. Until Part 31 this
  // line always threw in production, so signup was wholly broken there and the
  // order never mattered. Now the send can fail on its own (SMTP down, or the
  // ADR 0031 Q6 limit) — and a failure that just bubbles leaves a real user
  // with a real shop looking at an error page. The obvious thing to do next is
  // press "สร้างบัญชี" again, and `createTenant` would happily make a SECOND
  // shop with the same name, because `prisma.user.upsert` above finds the user
  // and nothing here is idempotent.
  //
  // So the failure is caught and named: the account is fine, only the letter
  // failed, and the way in is the login page — not another signup.
  //
  // `redirect: false` for the reason in login/page.tsx, and it also keeps this
  // block from having to tell a NEXT_REDIRECT apart from a real failure.
  const outcome = await signIn("email", {
    email,
    redirectTo: "/dashboard",
    redirect: false,
  });

  const code = new URL(outcome, "http://internal").searchParams.get("error");
  if (code) redirect("/login?error=SignupEmailFailed");

  redirect(`/login?check-email=${encodeURIComponent(email)}`);
}

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="mb-9 flex flex-col items-center gap-3.5">
          <Logo size={58} />
          <div className="text-center">
            <div className="font-display text-4xl font-semibold leading-none text-primary">
              Mise
            </div>
            <div className="mt-2 text-xs tracking-[0.14em] text-muted-foreground">
              Restaurant Management
            </div>
          </div>
        </div>
        <h1 className="mb-2 text-3xl font-bold">สมัครใช้งาน Mise</h1>
        <p className="mb-8 text-muted-foreground">
          สร้างบัญชี + ตั้งค่าร้านของคุณ
        </p>

        <form action={handleSignup} className="space-y-4">
          <div className="border-b border-border pb-4">
            <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
              ข้อมูลผู้ใช้
            </h2>
            <div className="space-y-3">
              <div>
                <label htmlFor="name" className="mb-1 block text-sm font-medium">
                  ชื่อของคุณ
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  className="w-full rounded-lg border border-border bg-background px-4 py-2"
                />
              </div>
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium">
                  อีเมล
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-lg border border-border bg-background px-4 py-2"
                />
              </div>
            </div>
          </div>

          <div className="border-b border-border pb-4">
            <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
              ข้อมูลร้าน
            </h2>
            <div className="space-y-3">
              <div>
                <label htmlFor="tenant_name" className="mb-1 block text-sm font-medium">
                  ชื่อร้าน
                </label>
                <input
                  id="tenant_name"
                  name="tenant_name"
                  type="text"
                  required
                  placeholder="เช่น ครัวคุณแม่"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2"
                />
              </div>
              <div>
                <label htmlFor="branch_name" className="mb-1 block text-sm font-medium">
                  ชื่อสาขาแรก
                </label>
                <input
                  id="branch_name"
                  name="branch_name"
                  type="text"
                  defaultValue="สาขาหลัก"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2"
                />
              </div>
              <div className="flex items-start gap-2 pt-2">
                <input
                  id="is_vat_registered"
                  name="is_vat_registered"
                  type="checkbox"
                  className="mt-1"
                />
                <div>
                  <label htmlFor="is_vat_registered" className="text-sm font-medium">
                    ร้านจดทะเบียน VAT
                  </label>
                  <p className="text-xs text-muted-foreground">
                    ถ้ารายได้เกิน ฿1.8M ต่อปี ต้องจด VAT
                  </p>
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90"
          >
            สร้างบัญชี
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          มีบัญชีแล้ว?{" "}
          <a href="/login" className="text-primary underline">
            เข้าสู่ระบบ
          </a>
        </p>
      </div>
    </main>
  );
}
