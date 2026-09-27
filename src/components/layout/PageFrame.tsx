import type { ReactNode } from "react";

// Part 35 L4 — what each section's layout keeps once the sidebar exists: its
// title and its reading width. The "← กลับหน้าหลัก" link and the logo went
// away with the header, because the sidebar is on every page now.
//
// Widths stay per section on purpose (purchase-orders/layout.tsx explains why
// an order needs max-w-5xl where the stock screen reads best at 3xl).

const WIDTH = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "7xl": "max-w-7xl",
} as const;

export default function PageFrame({
  title,
  width,
  children,
}: {
  title: string;
  width: keyof typeof WIDTH;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto w-full ${WIDTH[width]} px-4 py-6 lg:px-8 lg:py-8`}>
      <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}
