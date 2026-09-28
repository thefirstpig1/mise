import type { ReactNode } from "react";
import ProductsFrame from "./ProductsFrame";

// Sprint 1 Part 7a — shared chrome for every /products route.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
// 2026-09-28: the list became a card grid, so the width now follows the path
// (ProductsFrame) — wide for the list, narrow for the forms.
export default function ProductsLayout({ children }: { children: ReactNode }) {
  return <ProductsFrame>{children}</ProductsFrame>;
}
