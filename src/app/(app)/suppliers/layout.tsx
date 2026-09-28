import type { ReactNode } from "react";
import SuppliersFrame from "./SuppliersFrame";

// Sprint 1 Part 5, Step 7.1 — shared chrome for every /suppliers route.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
// 2026-09-28: the order catalog is wide, the rest narrow (SuppliersFrame).
export default function SuppliersLayout({ children }: { children: ReactNode }) {
  return <SuppliersFrame>{children}</SuppliersFrame>;
}
