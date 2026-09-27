"use client";

// ============================================================
// "ส่งลิงก์อีกครั้ง" — the resend on the check-email screen
// ============================================================
// Found on the first production login (2026-09-27): the letter was sent and
// did not arrive where the reader looked, and the only way to ask again was
// "ลองใหม่" — which throws away the address and makes them type it again.
//
// 🔴 THE COUNTDOWN IS NOT DECORATION. Layer 1 of the rate limit refuses once
// an address holds MAX_OUTSTANDING_LINKS (5) unused links, and every press
// here mints one. A button that could be pressed five times in five seconds
// would lock a person out of their own shop with their own impatience — and
// the screen cannot even say that was the reason (every refusal arrives as
// `Configuration`, see login-messages.ts). Sixty seconds is also roughly how
// long a slow letter takes, so the wait is honest rather than arbitrary.
//
// It posts to the SAME server action as the form, so the resend walks through
// both rate-limit layers exactly as a first request does. Nothing here trusts
// the client: the countdown is kindness, the server is the limit.
// ============================================================

import { useEffect, useState } from "react";

export const RESEND_COOLDOWN_SECONDS = 60;

export default function ResendLink({
  email,
  action,
}: {
  email: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [left, setLeft] = useState(RESEND_COOLDOWN_SECONDS);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const waiting = left > 0 || pending;

  return (
    <form action={action} onSubmit={() => setPending(true)} className="mt-5">
      <input type="hidden" name="email" value={email} />
      {/* Spoken to a customer, not a colleague: polite particle-free Thai
          that asks rather than instructs (Kong, 2026-09-27). */}
      <p className="mb-2 text-xs text-muted-foreground">
        หากยังไม่ได้รับอีเมล กรุณาตรวจสอบในกล่องจดหมายขยะ (Spam) หรือแท็บโปรโมชัน
      </p>
      <button
        type="submit"
        disabled={waiting}
        className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? "กำลังส่ง…"
          : left > 0
            ? `ขอลิงก์ใหม่ได้ในอีก ${left} วินาที`
            : "ส่งลิงก์ใหม่อีกครั้ง"}
      </button>
    </form>
  );
}
