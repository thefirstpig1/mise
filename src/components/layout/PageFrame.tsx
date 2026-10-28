import type { ReactNode } from "react";

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
   * Omit when every page in the section names itself with its own breadcrumb
   * (expenses, Kong 2026-10-27: the label above "ค่าใช้จ่าย › …" said it twice).
   */
  title?: string;
  /** @deprecated Every page is the same width now; kept so old layouts compile. */
  width?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
      {title && <p className="mb-2 text-xs font-medium text-muted-subtle">{title}</p>}
      {children}
    </div>
  );
}
