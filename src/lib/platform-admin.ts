// ============================================================
// คิดครัว — who runs the platform (ADR 0043 Q1)
// ============================================================
// A platform admin is an e-mail address in the PLATFORM_ADMIN_EMAILS secret.
// Not a database column, not a button: anything the app can write, somebody
// who has taken over an account in the app can write too. Changing this list
// takes the Fly account, which is a different lock.
//
// Someone who is not on the list gets 404 from every platform page — not
// "no permission", which would confirm the page exists.
// ============================================================

import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/** The configured admins, lower-cased. Empty = nobody, which is the safe default. */
export function platformAdminEmails(raw: string | undefined = process.env.PLATFORM_ADMIN_EMAILS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"))
  );
}

export function isPlatformAdminEmail(email: string | null | undefined, raw?: string): boolean {
  return !!email && platformAdminEmails(raw).has(email.trim().toLowerCase());
}

/**
 * The only way to obtain one — so every function in src/server/platform.ts,
 * which takes it as its first argument, cannot be called without the check.
 */
export type PlatformActor = { readonly userId: string; readonly email: string; readonly __platform: true };

export async function requirePlatformAdmin(): Promise<PlatformActor> {
  const session = await auth();
  const email = session?.user?.email;
  if (!session?.user?.id || !email) redirect("/login");
  if (!isPlatformAdminEmail(email)) notFound();
  return { userId: session.user.id, email: email.toLowerCase(), __platform: true };
}

/** For the sidebar: whether to show the door at all. Hiding it is tidiness; the pages check. */
export async function sessionIsPlatformAdmin(): Promise<boolean> {
  const session = await auth();
  return isPlatformAdminEmail(session?.user?.email);
}
