// Sprint 1 Part 5, Step 7 — RSC-serializable view of a Supplier.
//
// Prisma's Decimal (the two rate fields) is a class instance, and class
// instances cannot cross the Server→Client boundary — passing a raw Supplier
// into a "use client" component throws "Only plain objects can be passed to
// Client Components". So the page (Server Component) maps each Supplier through
// toSupplierView() before handing it to SupplierForm / SupplierList: rates
// become plain strings (handy as <input> defaultValue + for display), and the
// timestamp fields the client never uses are dropped from the payload.

import type { Supplier } from "@prisma/client";

export type SupplierView = Omit<
  Supplier,
  | "defaultVatRatePercent"
  | "defaultWhtRatePercent"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
> & {
  defaultVatRatePercent: string | null;
  defaultWhtRatePercent: string | null;
};

export function toSupplierView(s: Supplier): SupplierView {
  // Drop the Date fields no client component reads; keep everything else.
  const { createdAt, updatedAt, deletedAt, ...rest } = s;
  void createdAt;
  void updatedAt;
  void deletedAt;
  return {
    ...rest,
    defaultVatRatePercent: s.defaultVatRatePercent?.toString() ?? null,
    defaultWhtRatePercent: s.defaultWhtRatePercent?.toString() ?? null,
  };
}
