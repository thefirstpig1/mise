import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { decideEmailDelivery, isProductionRuntime } from "@/lib/email/delivery";
import { isEmailConfigured } from "@/lib/email/transport";
import {
  loginNoticeFor,
  displayableAddress,
  checkEmailHintFor,
} from "@/lib/email/login-messages";
import Logo from "@/components/layout/Logo";
import ResendLink from "./ResendLink";
import {
  KitchenDoodle,
  MarkerUnderline,
  EnvelopeDoodle,
} from "@/components/layout/Doodles";

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
  //
  // 🔴 `redirectTo` IS NOT OPTIONAL HERE. Without it Auth.js takes the page the
  // request came from — /login — as where the link lands, so the first
  // production login (2026-09-27) verified the token, created a session, and
  // put the person straight back on this form as if nothing had happened.
  // /dashboard sends someone with no shop on to /signup by itself
  // (require-tenant.ts), so this one target is right for both.
  const outcome = await signIn("email", {
    email,
    redirectTo: "/home",
    redirect: false,
  });

  const code = new URL(outcome, "http://internal").searchParams.get("error");
  if (code) redirect(`/login?error=${encodeURIComponent(code)}`);

  // `sent` is only a render key: a resend lands on this same URL, and without a
  // new value the resend button would keep its finished countdown and its
  // "กำลังส่ง…" state instead of starting over.
  redirect(`/login?check-email=${encodeURIComponent(email)}&sent=${Date.now()}`);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ "check-email"?: string; error?: string; sent?: string }>;
}) {
  // Somebody already signed in has no business on this form — and showing it
  // to them reads as "the link did not work". Every link sent before the fix
  // above still lands here, so this is what rescues those.
  const session = await auth();
  if (session?.user) redirect("/home");

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
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="flex w-full max-w-3xl flex-col items-center gap-10 md:flex-row md:gap-12">
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
          {/* Desktop only: on a phone it would push the form below the fold. */}
          <KitchenDoodle className="mt-2 hidden w-72 md:block" />
        </div>
        <div className="w-full max-w-md">
          <h1 className="mb-2 text-3xl font-bold">
            <span className="relative inline-block">
              <span className="relative z-10">เข้าสู่ระบบ</span>
              <MarkerUnderline className="absolute -bottom-1 left-0 h-3 w-full" />
            </span>
          </h1>
          <p className="mb-8 text-muted-foreground">
            ใส่อีเมลที่ใช้สมัคร ระบบจะส่งลิงก์เข้าสู่ระบบไปให้ ไม่ต้องใช้รหัสผ่าน
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
              <EnvelopeDoodle className="mx-auto mb-3 w-28" />
              <p className="mb-2 text-lg font-medium">ตรวจอีเมลของคุณ</p>
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
              {mode === "send" ? (
                // What people get wrong with a magic link (review 2026-10-28):
                // opening it on another device signs THAT device in.
                <ol className="mx-auto mt-4 max-w-xs space-y-2 text-left text-sm text-muted-foreground">
                  {["เปิดอีเมลจาก คิดครัว แล้วกด “เข้าสู่ระบบ”", "กดลิงก์บนเครื่องที่จะใช้งาน ถ้าขอจากคอมแต่กดในมือถือ จะเข้าระบบบนมือถือ", checkEmailHintFor(mode)].map((t, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">{i + 1}</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">{checkEmailHintFor(mode)}</p>
              )}
              {sentTo && mode === "send" ? (
                // Only when a letter really goes out. In console mode the link
                // is in the terminal already, and there is nothing to resend to.
                <ResendLink
                  key={params.sent ?? "first"}
                  email={sentTo}
                  action={requestLink}
                />
              ) : null}
              {sentTo ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  <a href="/login" className="font-semibold text-primary underline">
                    ใช้อีเมลอื่น
                  </a>
                </p>
              ) : null}
            </div>
          ) : (
            <form action={requestLink} className="space-y-4">
              <div>
                <label htmlFor="email" className="label mb-1">
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
                ส่งลิงก์เข้าสู่ระบบ
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
