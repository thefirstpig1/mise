import type { ReactNode } from "react";
import SectionEyebrow from "@/components/layout/SectionEyebrow";

// Part 35 L4 — what each section's layout keeps once the sidebar exists: its
// title and its reading width. The "← กลับหน้าหลัก" link and the logo went
// away with the header, because the sidebar is on every page now.
//
// ONE width for every page (Kong 2026-10-28, kit Tjr5K9RzEXyJ2Es8C6fh7Q:
// "ทุกหน้ากว้างเท่ากัน"). Sections used to choose 3xl–7xl, so moving between
// pages made the content jump left and right. A narrow form now keeps its
// own inner width inside the same frame.

export default function PageFrame({
  title,
  width,
  children,
}: {
  /**
   * Only for a page the sidebar does not list (/recipes): every listed page
   * shows its sidebar GROUP instead (SectionEyebrow, queue item 9), which can
   * never repeat the page's own heading or breadcrumb (Kong 2026-10-27).
   */
  title?: string;
  /** @deprecated Every page is the same width now; kept so old layouts compile. */
  width?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
      {/* Queue item 9: the sidebar group, in gold, on every page; `title` is
          only the fallback for a page the sidebar does not list. */}
      <SectionEyebrow fallback={title} className="mb-1.5" />
      {children}
    </div>
  );
}
