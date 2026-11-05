import type { ReactNode } from "react";
import MenusFrame from "./MenusFrame";
import { requireTenant } from "@/lib/require-tenant";

// Kong 2026-11-05: ทดลองเมนู is a tab of จัดการเมนู — a dish being tried
// becomes a menu on the same screen, which already had "ทดลองเมนูใหม่".
export default async function MenusLayout({ children }: { children: ReactNode }) {
  const { can } = await requireTenant("any:member");
  const tabs = [{ href: "/menus", label: "เมนูที่ขาย" }, ...(can("recipe:draft") ? [{ href: "/menus/lab", label: "กำลังทดลอง" }] : [])];
  return <MenusFrame tabs={tabs}>{children}</MenusFrame>;
}
