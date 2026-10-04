// ============================================================
// Mise — client READS over GET (Kong 2026-10-04, mise-ui-review §5c)
// ============================================================
// Reads a client component makes after paint go to a GET route handler, never
// a Server Action: Next queues actions one at a time and can drop an answer
// when the URL changes while one is queued. A GET is an ordinary request — the
// browser runs them side by side and nothing in the router can lose one.
//
// The input travels as JSON in `q`; every route validates it exactly as the
// action it replaced did. Any answer that is not JSON (a redirect to /login or
// /denied, an error page) comes back as an ordinary `{ ok: false }`, so call
// sites keep the one `!res.ok` branch they already have.
//
// A plain module, never "use client" (mise-ui-review §7).
// ============================================================

export type ReadFailure = { ok: false; formError: string; stale?: boolean };

export async function readApi<T extends { ok: boolean }>(
  path: string,
  what: string,
  input?: unknown
): Promise<T | ReadFailure> {
  const qs = new URLSearchParams({ what });
  if (input !== undefined) qs.set("q", JSON.stringify(input));
  try {
    const res = await fetch(`${path}?${qs}`, { cache: "no-store" });
    if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
      return { ok: false, formError: "เปิดข้อมูลไม่ได้ — กรุณารีเฟรชหน้าแล้วลองอีกครั้ง", stale: true };
    }
    return (await res.json()) as T | ReadFailure;
  } catch {
    return { ok: false, formError: "เชื่อมต่อไม่ได้ — ลองอีกครั้ง" };
  }
}

/** The `q` a route received, parsed; null when it is missing or not JSON. */
export function readInput(url: URL): unknown {
  const raw = url.searchParams.get("q");
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Run a route's read; malformed input that slips past validation becomes a
 * 400 instead of a 500 — but a redirect (signed out → /login, refused →
 * /denied) is Next's control flow and must pass through untouched.
 */
export async function guardRead(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR"))) throw e;
    console.error("[read-api] read failed", e);
    return Response.json({ ok: false, formError: "คำขอไม่ถูกต้อง", error: "คำขอไม่ถูกต้อง" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
