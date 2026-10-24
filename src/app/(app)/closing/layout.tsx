import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// ปิดร้านประจำวัน (ADR 0042) — shared frame for /closing and /closing/day.
export default function ClosingLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="ปิดร้านประจำวัน" width="5xl">
      {children}
    </PageFrame>
  );
}
