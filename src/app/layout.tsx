import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// ============================================================
// Mise — type (Part 33, theme)
// ============================================================
// 🔴 THIS FILE HAD A HOLE, NOT A STYLE. `tailwind.config.ts` has referenced
// `var(--font-sans)` since Sprint 0 and nothing ever defined it, so every
// screen fell through to `system-ui` — Thai rendered as whatever the operating
// system happened to supply. Tahoma on Windows, Thonburi on iOS, something
// else again on Android: three different products depending on the device,
// and nobody had ever chosen any of them.
//
// IBM Plex Sans Thai covers both scripts from ONE superfamily, so Thai and
// Latin in the same sentence share a skeleton instead of colliding. Plex Mono
// is its sibling and carries the figures: a back-office page is columns of
// money, and money that does not line up is money that is hard to check.
// ============================================================

const sans = IBM_Plex_Sans_Thai({
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
    <html lang="th" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
