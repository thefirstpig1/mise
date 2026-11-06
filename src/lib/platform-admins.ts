// ============================================================
// คิดครัว — the platform admins' e-mail list (ADR 0043 Q1)
// ============================================================
// A plain module: no sign-in code, so the platform overview can leave the
// admins' own shops out of its figures (ADR 0045 Q3) without loading Auth.js.
// The check that USES a session stays in src/lib/platform-admin.ts.
// ============================================================

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
