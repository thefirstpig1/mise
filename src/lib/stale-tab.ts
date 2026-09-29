// ============================================================
// Mise — a tab older than the server (Kong, 2026-09-28/29)
// ============================================================
// Every deploy (and every dev restart) leaves the open tabs running the OLD
// JavaScript. When one of them calls a Server Action the server no longer has,
// Next does not throw — the call resolves to `undefined` — and code reading
// `res.ok` crashes the page to the error screen.
//
// Two defences, both here so every screen uses the same words:
//   1. VersionBanner (in the app frame) notices a new build on its own — when
//      the tab comes back into view, and every few minutes — and asks for a
//      refresh before anyone presses anything.
//   2. `orStale` at each call site turns the `undefined` (or a throw) into an
//      ordinary refusal carrying STALE_TAB_MESSAGE, and raises the same banner.
//
// A plain module, never "use client": both Server and Client Components import it.
// ============================================================

export const STALE_TAB_MESSAGE = "ระบบเพิ่งอัปเดต หน้านี้เปิดค้างไว้จากเวอร์ชันก่อน — กรุณารีเฟรชหน้าแล้วลองอีกครั้ง";

/** The build this bundle was compiled from (next.config `env`). */
export const CLIENT_BUILD_ID = process.env.MISE_BUILD_ID ?? "";

const EVENT = "mise:stale-tab";

/** Tell the app frame to show its refresh banner. Safe to call on the server (does nothing). */
export function announceStale(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onStaleAnnounced(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/**
 * Await a Server Action and never get `undefined` back. A missing answer or a
 * thrown call becomes `{ ok: false, formError: STALE_TAB_MESSAGE, stale: true }`
 * and raises the banner, so the caller's existing `!res.ok` branch shows it.
 *
 * Only for actions answering `{ ok: true, … } | { ok: false, formError, … }`.
 * The stale answer is typed as the action's own failure: any extra optional
 * field a caller reads on failure (e.g. `needsAcknowledgement`) is simply
 * absent on it, which every such caller already handles.
 */
export async function orStale<T extends { ok: boolean }>(call: Promise<T>): Promise<T> {
  try {
    const r = await call;
    if (r !== undefined && r !== null) return r;
  } catch (e) {
    // A redirect/notFound thrown by the action is navigation, not staleness.
    if (isNextNavigation(e)) throw e;
  }
  announceStale();
  return STALE_RESULT as unknown as T;
}

// Mise's actions name their failure text `formError` or `error`; the stale
// answer carries both so whichever the screen prints, it prints this.
export type StaleResult = { ok: false; formError: string; error: string; stale: true };
export const STALE_RESULT: StaleResult = { ok: false, formError: STALE_TAB_MESSAGE, error: STALE_TAB_MESSAGE, stale: true };

function isNextNavigation(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"));
}
