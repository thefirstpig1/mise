// ============================================================
// Mise — Auth.js v5 Configuration
// ============================================================
// Email magic link login (no password — simpler for SME).
//
// Part 31 (ADR 0031) replaced "log in dev, throw in production" with the Q7
// table, which switches on whether SMTP credentials exist rather than on
// NODE_ENV — so a real letter can be proved on a dev machine, while a
// production server with no credentials still refuses out loud.
//
// 🔴 THE REFUSALS BELOW MUST THROW A PLAIN `Error`, NEVER AN `AuthError`.
// Read from @auth/core/index.js, not from the docs:
//
//     if (isAuthError && isRaw && !isRedirect) throw error;
//
// `signIn()` called from a Server Action runs in `raw` mode, so an AuthError
// is re-thrown into the caller and takes the page down at the error boundary.
// A plain Error falls through to the redirect below it and lands on
// `pages.error` — which is why one is used and the other is not.
//
// A consequence worth knowing before debugging: every failure here arrives at
// the login page as `?error=Configuration`, because that branch labels any
// non-AuthError that way. SMTP failure and the rate-limit refusal therefore
// cannot be told apart by the screen, and the Thai message it shows is written
// to be true of both rather than inventing a side channel to separate them.
// ============================================================

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { decideEmailDelivery, isProductionRuntime } from "./email/delivery";
import { isEmailConfigured, sendEmail } from "./email/transport";
import { magicLinkEmail } from "./email/templates";
import { tooManyOutstandingLinks } from "./email/rate-limit";

/** One source of truth for the link's life — the letter is told, never guesses. */
const MAGIC_LINK_MAX_AGE_SECONDS = 24 * 60 * 60;

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
      maxAge: MAGIC_LINK_MAX_AGE_SECONDS,
      async sendVerificationRequest({
        identifier: email,
        url,
      }: {
        identifier: string;
        url: string;
      }) {
        const mode = decideEmailDelivery({
          isProduction: isProductionRuntime(),
          configured: isEmailConfigured(),
        });

        if (mode === "refuse") {
          // Production with no credentials. Logging the link here would put a
          // working credential in the server log and tell the person to watch
          // an inbox nothing is coming to (ADR 0031 Q7 point 3).
          console.error(
            "[email] refusing to send: no SMTP configuration in production",
          );
          throw new Error("email transport is not configured");
        }

        if (mode === "console") {
          console.log("\n" + "=".repeat(60));
          console.log("📧 Magic link login (no SMTP configured)");
          console.log("=".repeat(60));
          console.log(`To: ${email}`);
          console.log(`Click here: ${url}`);
          console.log("=".repeat(60) + "\n");
          return;
        }

        // Layer 1 of ADR 0031 Q6. Deliberately before the send and after the
        // mode decision: a dev machine with no credentials should not be rate
        // limited for printing to its own terminal.
        if (await tooManyOutstandingLinks(prisma, email)) {
          console.error(
            `[email] refusing to send: too many unused links outstanding for ${email}`,
          );
          throw new Error("too many outstanding sign-in links");
        }

        const letter = magicLinkEmail({
          url,
          expiresHours: MAGIC_LINK_MAX_AGE_SECONDS / 3600,
        });

        try {
          await sendEmail({ to: email, ...letter });
        } catch (cause) {
          // English in the log with the SMTP cause, Thai on the screen with
          // none of it (CLAUDE.md). Rethrown as a plain Error for the reason
          // in the header comment.
          console.error("[email] magic link send failed", cause);
          throw new Error("failed to send the sign-in email");
        }
      },
    } as any,
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login?check-email",
    // Without this, any failure lands on Auth.js's own English page at
    // /api/auth/error. The login page reads `?error=` and says it in Thai.
    error: "/login",
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
