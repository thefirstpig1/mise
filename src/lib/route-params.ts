// ============================================================
// คิดครัว — an id in the URL that cannot be an id (Kong 2026-11-03)
// ============================================================
// `/purchase-orders/zzz` reached Prisma, which refuses to turn "zzz" into a
// uuid and throws — so a mistyped or cut-off link showed "เกิดข้อผิดพลาด"
// (and a report-this-problem button) instead of "ไม่พบหน้านี้". 16 of 17
// pages with an id did this; only the Menu Lab checked, and loosely.
//
// Every segment of every `[id]` page in this app is a uuid, so the page reads
// its params through this and a malformed one is simply a page that is not
// there. tests/route-params-guard.test.ts fails for a new `[x]` page that
// forgets — the day a segment is not a uuid, that page says so there.
// ============================================================

import { notFound } from "next/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string): boolean => UUID.test(s);

/** The page's params, or the 404 page when any of them is not a uuid. */
export async function uuidParams<T extends Record<string, string>>(params: Promise<T>): Promise<T> {
  const p = await params;
  for (const v of Object.values(p)) if (!isUuid(v)) notFound();
  return p;
}
