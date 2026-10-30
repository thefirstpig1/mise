import type { ReactNode } from "react";
import MenusFrame from "./MenusFrame";

// Sprint 4 Part 19 L5 — shared chrome for every /menus route.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function MenusLayout({ children }: { children: ReactNode }) {
  return <MenusFrame>{children}</MenusFrame>;
}
