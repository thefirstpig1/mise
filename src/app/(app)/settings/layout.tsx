import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Part 35 L4 — one frame for /settings, /settings/branches, /settings/departments
// and /settings/members; the page used to carry its own header and back link.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="ตั้งค่า" width="3xl">
      {children}
    </PageFrame>
  );
}
