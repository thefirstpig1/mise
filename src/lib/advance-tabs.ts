// Kong 2026-11-05: ซื้อเอง / สำรองจ่าย and ค้างคืนพนักงาน are one story told
// from two sides (staff pay first → the shop pays back), and sat in two menu
// groups. One menu item now, with a tab for each side the reader may open.
import type { Requirement } from "@/lib/permissions/service";
import type { SectionTab } from "@/components/ui/SectionTabs";

export function advanceTabs(can: (need: Requirement) => boolean): SectionTab[] {
  return [
    ...(can("purchase:self") ? [{ href: "/my-advances", label: "ของฉัน" }] : []),
    ...(can("refund:pay") ? [{ href: "/advances", label: "ต้องคืนพนักงาน" }] : []),
  ];
}
