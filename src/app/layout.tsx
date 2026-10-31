import type { Metadata } from "next";
import { preload } from "react-dom";
import "./fonts.css";
import "./globals.css";
import NumberFieldBehaviour from "@/components/NumberFieldBehaviour";

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

// The faces themselves live in ./fonts.css, served from /public/fonts
// (2026-10-31 — next/font/google failed builds at random; see that file).
// Preloaded: the Thai body face and the Thai heading weight every page opens
// with, the two a first paint cannot do without — what next/font preloaded
// for us before.
const PRELOAD = ["/fonts/noto-sans-thai-v29-thai.woff2", "/fonts/prompt-v12-600-thai.woff2"];

export const metadata: Metadata = {
  title: "คิดครัว — ระบบหลังร้านสำหรับร้านอาหาร",
  description: "ระบบหลังบ้านสำหรับร้านอาหาร",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  for (const href of PRELOAD) preload(href, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <html lang="th">
      <body className="min-h-screen bg-background font-sans antialiased">
        <NumberFieldBehaviour />
        {children}
      </body>
    </html>
  );
}
