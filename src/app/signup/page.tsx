// สมัครใช้งาน (review 2026-10-28, mockup GG5e43SSLmNFxEHfa5RQJH).
// The form and its two steps are SignupForm; the action and the Part 31
// reasoning about failed sends are in actions.ts.

import Link from "next/link";
import { auth } from "@/lib/auth";
import Logo from "@/components/layout/Logo";
import SignupForm from "./SignupForm";
import { signOutToUseAnotherEmail } from "./actions";

export default async function SignupPage() {
  const session = await auth();
  const signedInEmail = session?.user?.email ?? null;

  return (
    <main className="flex min-h-screen justify-center px-5 py-10">
      <div className="w-full max-w-lg space-y-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={36} />
          <span className="font-display text-[22px] font-semibold text-primary">คิดครัว</span>
        </Link>

        <SignupForm signedInEmail={signedInEmail} />

        {signedInEmail ? (
          // 🔴 NOT a link to /login. A signed-in person with no shop is
          // bounced /login → /dashboard → /signup, straight back here, so
          // "เข้าสู่ระบบ" was a button that did nothing (Kong, 2026-09-27).
          // What they can actually want from this spot is a different
          // address, and that means signing out first.
          <form action={signOutToUseAnotherEmail} className="text-center text-sm text-muted-foreground">
            หากต้องการใช้อีเมลอื่น{" "}
            <button type="submit" className="font-semibold text-primary underline">
              ออกจากระบบ
            </button>
          </form>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            มีบัญชีแล้ว?{" "}
            <Link href="/login" className="font-semibold text-primary underline">
              เข้าสู่ระบบ
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
