// ============================================================
// Mise — Auth.js v5 Configuration
// ============================================================
// Email magic link login (no password — simpler for SME)
// Dev mode: logs link to console instead of sending email
// ============================================================

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    {
      id: "email",
      name: "Email Magic Link",
      type: "email",
      maxAge: 24 * 60 * 60, // 24 hours
      async sendVerificationRequest({
        identifier: email,
        url,
      }: {
        identifier: string;
        url: string;
      }) {
        if (process.env.NODE_ENV === "development") {
          // Dev mode: log to console
          console.log("\n" + "=".repeat(60));
          console.log("📧 Magic link login (dev mode)");
          console.log("=".repeat(60));
          console.log(`To: ${email}`);
          console.log(`Click here: ${url}`);
          console.log("=".repeat(60) + "\n");
          return;
        }
        // Production: integrate with SendGrid/Resend
        throw new Error("Production email not configured yet (Sprint 7)");
      },
    } as any,
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login?check-email",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});
