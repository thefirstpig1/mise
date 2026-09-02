import type { Metadata } from "next";
import { Prompt, Noto_Sans_Thai, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// ============================================================
// Mise — type (Part 33, theme)
// ============================================================
// 🔴 THIS FILE ONCE HAD A HOLE, NOT A STYLE. `tailwind.config.ts` referenced
// `var(--font-sans)` from Sprint 0 and nothing ever defined it, so every
// screen fell through to `system-ui` — Thai rendered as whatever the operating
// system happened to supply. Tahoma on Windows, Thonburi on iOS, something
// else on Android: three different products depending on the device, and
// nobody had ever chosen any of them.
//
// TWO FACES, EACH WITH A JOB.
//
// Prompt carries headings and figures. It is a Thai geometric sans whose
// letter skeletons are rounded — modern without playing — and its digits are
// drawn, not inherited, which matters on a page that is mostly money.
//
// Noto Sans Thai carries body text and tables. It is narrower than Prompt, so
// a dense row of columns still fits at a size people can read. Using Prompt
// for both would cost either the density or the reading size, and a back
// office cannot spend either.
//
// Plex Mono stays for ids and codes — one usage in the whole app, and it is
// the one place where character-for-character alignment is the point.
//
// Where each face actually lands is in globals.css: headings and anything
// carrying `tabular-nums` get the display face, everything else gets the body
// face. That is one rule in one file rather than a class on every heading.
// ============================================================

const display = Prompt({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mise — Restaurant Back-Office",
  description: "ระบบหลังบ้านสำหรับร้านอาหาร",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="th"
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
