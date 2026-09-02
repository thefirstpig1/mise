import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { decideEmailDelivery, isProductionRuntime } from "@/lib/email/delivery";
import { isEmailConfigured } from "@/lib/email/transport";
import {
  loginNoticeFor,
  displayableAddress,
  checkEmailHintFor,
} from "@/lib/email/login-messages";
import Logo from "@/components/layout/Logo";

// Next 15 made `searchParams` a Promise (it was a plain object in 14). This page
// dates from Sprint 0 and kept the old signature — which `next build` rejects in
// its type-check pass, blocking production builds repo-wide. `pnpm tsc --noEmit`
// never caught it because the generated .next/types route types are outside the
// tsconfig scope; dev and vitest are unaffected, so it went unnoticed for
// 9 parts. Found by the Part 10 L5a build check.
//
// Part 31 (ADR 0031 Q7/Q9): this page had TWO ways of saying something untrue
// the moment real sending was switched on — it told every visitor to look in a
// dev-server terminal, and it had no way at all to report a failed send, so a
// failure showed Auth.js's own English page at /api/auth/error.
//
// `redirect: false` on signIn is what makes the difference. Without it the
// action redirects from inside Auth.js and this page never learns which
// address was used or whether the send worked.

async function requestLink(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login");

  // Returns the URL instead of throwing a redirect, so the outcome is a value
  // this action can read rather than control flow it cannot intercept.
  const outcome = await signIn("email", { email, redirect: false });

  const code = new URL(outcome, "http://internal").searchParams.get("error");
  if (code) redirect(`/login?error=${encodeURIComponent(code)}`);

  redirect(`/login?check-email=${encodeURIComponent(email)}`);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ "check-email"?: string; error?: string }>;
}) {
  const params = await searchParams;
  const checkEmail = params["check-email"] !== undefined;
  const sentTo = displayableAddress(params["check-email"]);
  const notice = loginNoticeFor(params.error);

  // The same decision auth.ts makes, asked the same way — so this line cannot
  // drift out of agreement with what actually happened to the letter.
  const mode = decideEmailDelivery({
    isProduction: isProductionRuntime(),
    configured: isEmailConfigured(),
  });

  return (
    <main className="min-h-screen md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="flex items-center justify-center border-b border-border bg-surface-sunk px-6 py-14 md:border-b-0 md:border-r md:py-0">
        <div className="flex flex-col items-center gap-5">
          <Logo size={78} className="md:hidden" />
          <Logo size={116} className="hidden md:block" />
          <div className="text-center">
            <div className="font-display text-5xl font-semibold leading-none text-primary md:text-6xl">
              Mise
            </div>
            <div className="mt-3 text-xs tracking-[0.16em] text-muted-foreground md:text-sm">
              Restaurant Management
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-12 md:py-0">
        <div className="w-full max-w-md">
          <h1 className="mb-2 text-3xl font-bold">เข้าสู่ระบบ</h1>
          <p className="mb-8 text-muted-foreground">
            ระบบจะส่งลิงก์ login ไปอีเมลของคุณ
          </p>

          {notice ? (
            <div
              className={`mb-6 rounded-lg border p-4 ${
                notice.tone === "error"
                  ? "border-bad-border bg-bad-bg"
                  : "border-border bg-muted/40"
              }`}
            >
              <p className="mb-1 text-sm font-medium">{notice.title}</p>
              <p className="text-sm text-muted-foreground">{notice.detail}</p>
            </div>
          ) : null}

          {checkEmail ? (
            <div className="rounded-lg border border-border bg-muted/40 p-6 text-center">
              <p className="mb-2 text-lg font-medium">📧 เช็คอีเมลของคุณ</p>
              {sentTo ? (
                // Naming the address is where a typo becomes visible. Without it
                // somebody who typed gmial.com sees a success screen and waits.
                <p className="text-sm text-muted-foreground">
                  ส่งลิงก์ไปที่ <span className="font-medium">{sentTo}</span> แล้ว
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  คลิกลิงก์ในอีเมลเพื่อเข้าสู่ระบบ
                </p>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                {checkEmailHintFor(mode)}
              </p>
              {sentTo ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  กรอกอีเมลผิด?{" "}
                  <a href="/login" className="text-primary underline">
                    ลองใหม่
                  </a>
                </p>
              ) : null}
            </div>
          ) : (
            <form action={requestLink} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium">
                  อีเมล
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2 focus:border-primary focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-primary py-2 font-medium text-primary-foreground hover:opacity-90"
              >
                ส่งลิงก์ login
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            ยังไม่มีบัญชี?{" "}
            <a href="/signup" className="text-primary underline">
              สมัครใช้งาน
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
