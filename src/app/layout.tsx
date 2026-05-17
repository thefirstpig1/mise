import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="th">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
