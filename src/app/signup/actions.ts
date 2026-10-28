"use server";

// สมัครใช้งาน — create the shop, then send the sign-in link.
// Review 2026-10-28 (mockup GG5e43SSLmNFxEHfa5RQJH): a missing field used to
// THROW, which showed the error screen; it now comes back to the field that is
// wrong. Everything else is the Part 31 flow, unchanged — read the 🔴 below.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createTenant } from "@/server/tenant-init";
import { salesDayCutoffSchema } from "@/lib/validations/branch";
import { auth, signIn, signOut } from "@/lib/auth";

export type SignupState = { ok: false; formError?: string; fieldErrors?: Record<string, string>; step?: 1 | 2 } | { ok: true };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  // Somebody who already signed in with a magic link and has no shop is sent
  // here by require-tenant.ts. Their address is PROVEN — asking for it again
  // and mailing a second link would make them wait on a letter to reach a
  // shop they could have in one click. So the session's address wins over the
  // form (which does not even show the field for them), and the letter is
  // skipped.
  const session = await auth();
  const signedInEmail = session?.user?.email ?? null;

  const email = (signedInEmail ?? String(formData.get("email") ?? "")).trim();
  const name = String(formData.get("name") ?? "").trim();
  const tenantName = String(formData.get("tenant_name") ?? "").trim();
  const branchName = String(formData.get("branch_name") ?? "").trim();
  const vat = formData.get("is_vat_registered");
  const late = formData.get("open_past_midnight");

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "กรุณาใส่ชื่อของคุณ";
  if (!signedInEmail && !EMAIL.test(email)) fieldErrors.email = "กรุณาใส่อีเมลให้ถูกต้อง";
  if (!tenantName) fieldErrors.tenant_name = "กรุณาใส่ชื่อร้าน";
  else if (tenantName.length > 100) fieldErrors.tenant_name = "ชื่อร้านยาวได้ไม่เกิน 100 ตัวอักษร";
  const step1Bad = Object.keys(fieldErrors).length > 0;
  // Both are the shop's nature, not a preference with a safe default — a
  // guessed answer here is wrong every day after (rule: shop-nature ambiguity
  // is asked, never assumed).
  if (vat !== "yes" && vat !== "no") fieldErrors.is_vat_registered = "กรุณาเลือกว่าร้านจด VAT หรือยัง";
  if (late !== "yes" && late !== "no") fieldErrors.open_past_midnight = "กรุณาเลือกว่าร้านเปิดเลยเที่ยงคืนไหม";
  if (Object.keys(fieldErrors).length) {
    return { ok: false, formError: "ยังสร้างร้านไม่ได้ กรุณาแก้ช่องที่มีข้อความสีแดง", fieldErrors, step: step1Bad ? 1 : 2 };
  }

  // Rule P24 ★ — a shop open past midnight whose day splits at the wrong hour
  // gets every night's sales on two days. A shop that closes before midnight
  // keeps the default, which never splits its day.
  const cutoff = late === "yes" ? salesDayCutoffSchema.safeParse(formData.get("sales_day_cutoff")) : null;
  const firstBranchSalesDayCutoffMinutes = cutoff?.success ? cutoff.data : undefined;

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
    isVatRegistered: vat === "yes",
    firstBranchName: branchName || "สาขาหลัก",
    firstBranchSalesDayCutoffMinutes,
  });

  if (signedInEmail) redirect("/dashboard");

  // 3. Send magic link to login
  //
  // 🔴 THE SHOP ALREADY EXISTS BY THE TIME WE GET HERE. The send can fail on
  // its own (SMTP down, or the ADR 0031 Q6 limit) — and a failure that just
  // bubbles leaves a real user with a real shop looking at an error page. The
  // obvious thing to do next is press "สร้างร้าน" again, and `createTenant`
  // would happily make a SECOND shop with the same name, because
  // `prisma.user.upsert` above finds the user and nothing here is idempotent.
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

export async function signOutToUseAnotherEmail() {
  await signOut({ redirectTo: "/login" });
}
