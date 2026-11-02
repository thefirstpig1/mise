import { ShieldCheck } from "lucide-react";

// ============================================================
// คิดครัว — the operator's door (ADR 0043)
// ============================================================
// Kong 2026-11-02: "ผมไม่เห็นหน้าควบคุมด้วยซ้ำ" — the pill under the shop
// switcher looked like one more menu item, and on a phone it sat behind ☰.
// A dark strip at the top of every page instead (mockup UqiLTa77CSent1W8HuoQoC,
// แบบ ก), drawn only for an e-mail in PLATFORM_ADMIN_EMAILS. Hiding it is
// tidiness — /platform checks for itself.
// ============================================================

export default function AdminStrip() {
  return (
    <div className="flex items-center justify-between gap-3 bg-primary px-4 py-1.5 text-sm text-primary-foreground lg:px-8">
      <span className="flex min-w-0 items-center gap-2 opacity-90">
        <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" />
        <span className="truncate">บัญชีผู้ดูแลระบบ</span>
      </span>
      <a
        href="/platform"
        className="shrink-0 rounded-lg border border-primary-foreground/35 bg-primary-foreground/15 px-3 py-0.5 font-display font-semibold hover:bg-primary-foreground/25"
      >
        หน้าควบคุมระบบ ›
      </a>
    </div>
  );
}
