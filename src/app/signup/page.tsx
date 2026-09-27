import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createTenant } from "@/server/tenant-init";
import { auth, signIn } from "@/lib/auth";
import Logo from "@/components/layout/Logo";
import { KitchenDoodle, MarkerUnderline } from "@/components/layout/Doodles";

async function handleSignup(formData: FormData) {
  "use server";

  // Somebody who already signed in with a magic link and has no shop is sent
  // here by require-tenant.ts. Their address is PROVEN — asking for it again
  // and mailing a second link would make them wait on a letter to reach a
  // shop they could have in one click. So the session's address wins over the
  // form (which does not even show the field for them), and the letter is
  // skipped.
  const session = await auth();
  const signedInEmail = session?.user?.email ?? null;

  const email = signedInEmail ?? (formData.get("email") as string);
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

  if (signedInEmail) redirect("/dashboard");

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

export default async function SignupPage() {
  const session = await auth();
  const signedInEmail = session?.user?.email ?? null;

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="flex w-full max-w-4xl flex-col items-center gap-10 md:flex-row md:gap-12">
        <div className="flex shrink-0 flex-col items-center gap-4">
          <Logo size={76} className="md:hidden" />
          <Logo size={92} className="hidden md:block" />
          <div className="text-center">
            <div className="font-display text-4xl font-semibold leading-none text-primary md:text-5xl">
              คิดครัว
            </div>
            <div className="mt-2.5 text-xs tracking-[0.15em] text-muted-foreground">
              KitKrua · Restaurant Management
            </div>
          </div>
          {/* The same scene as /login, so the two doors look like one house.
              Desktop only: on a phone it would push the form down. */}
          <KitchenDoodle className="mt-2 hidden w-72 md:block" />
        </div>
        <div className="w-full max-w-lg">
          <h1 className="mb-2 text-3xl font-bold">
            <span className="relative inline-block">
              <span className="relative z-10">สมัครใช้งานคิดครัว</span>
              <MarkerUnderline className="absolute -bottom-1 left-0 h-3 w-full" />
            </span>
          </h1>
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
                  <label htmlFor="name" className="mb-1 label">
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
                {signedInEmail ? (
                  <div>
                    <span className="mb-1 label">อีเมล</span>
                    <p className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm">
                      {signedInEmail}
                    </p>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="email" className="mb-1 label">
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
                )}
              </div>
            </div>

            <div className="border-b border-border pb-4">
              <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
                ข้อมูลร้าน
              </h2>
              <div className="space-y-3">
                <div>
                  <label htmlFor="tenant_name" className="mb-1 label">
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
                  <label htmlFor="branch_name" className="mb-1 label">
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
      </div>
    </main>
  );
}
