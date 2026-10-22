// The sidebar's badge counts (par alerts) move when the shop WRITES something.
// Anything that wrote fires this, and the sidebar reads the counts again —
// a page change alone re-reads only a count older than a minute (Kong 2026-10-22).
// A plain module, so both client components and client helpers can import it.

export const NAV_BADGES_EVENT = "kitkrua:nav-badges";

/** Ask the sidebar to read its counts again. Safe to call on the server (does nothing). */
export function refreshNavBadges(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_BADGES_EVENT));
}
