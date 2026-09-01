// ============================================================
// Mise — the wire (Part 31 L1, ADR 0031 Q3/Q4)
// ============================================================
// SMTP THROUGH NODEMAILER, NOT A VENDOR SDK (Q3). nodemailer has been in
// package.json since Sprint 0 with zero call sites — it arrived with next-auth
// and was never chosen. Choosing it now costs no new dependency, and it makes
// Q4's answer reversible by editing .env: Resend, Postmark, SES and Brevo all
// speak SMTP, so swapping vendors never touches this file.
//
// Verified against the vendor's own docs on 2026-09-01, not from memory:
//   host smtp.resend.com · port 587 (explicit STARTTLS) · user "resend"
//   password = the API key · resend.dev sends ONLY to the account owner
//
// Port 587 on purpose: every vendor in Q3 offers it, so a vendor swap does not
// drag a port change along with it.
//
// THE CONDITIONS THAT WOULD FORCE A MOVE TO AN HTTP SDK are recorded in
// ADR 0031 Consequence 3 — a host that blocks outbound 25/465/587, a cold-start
// handshake slow enough that people press the button twice, per-message bounce
// webhooks, or a vendor feature offered over HTTP only. This file is the whole
// of what such a move would rewrite.
//
// NOTHING IS BUILT AT IMPORT TIME. `src/lib/auth.ts` is imported by every page
// through the session, so a missing or half-filled .env must never throw on
// import — it must be a question this module can ANSWER (isEmailConfigured),
// which is what lets auth.ts pick a cell of the Q7 table instead of crashing.
// ============================================================

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

const DEFAULT_PORT = 587;

function read(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  // Sprint 0 shipped .env.example with EMAIL_SERVER_USER="" and
  // EMAIL_SERVER_PASSWORD="" — present but empty. Treating an empty string as
  // configured would put production in the "send" cell of the Q7 table with
  // nothing to send through.
  return trimmed === "" ? null : trimmed;
}

export type EmailConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

/**
 * The four values that have to be present for a message to leave the building,
 * plus the address it leaves from. Returns null rather than throwing: "is it
 * configured" is a question with a legitimate no.
 */
export function readEmailConfig(): EmailConfig | null {
  const host = read("EMAIL_SERVER_HOST");
  const user = read("EMAIL_SERVER_USER");
  const password = read("EMAIL_SERVER_PASSWORD");
  const from = read("EMAIL_FROM");

  if (!host || !user || !password || !from) return null;

  // Unset (or blank) means "did not choose" and takes the default. Anything
  // PRESENT but not a port is a typo, and silently falling back to 587 would
  // hide it — so it refuses to call itself configured, which sends it to the
  // cell of the Q7 table that says so out loud.
  //
  // Number.parseInt is not the test: parseInt("587x", 10) is 587, so a typo
  // would sail through as a valid port. The whole string has to be digits.
  const portRaw = read("EMAIL_SERVER_PORT");
  if (portRaw !== null && !/^\d+$/.test(portRaw)) return null;

  const port = portRaw === null ? DEFAULT_PORT : Number.parseInt(portRaw, 10);
  if (port <= 0 || port > 65535) return null;

  return { host, port, user, password, from };
}

/** Q7's switch, phrased as the question the switch actually asks. */
export function isEmailConfigured(): boolean {
  return readEmailConfig() !== null;
}

let cached: { transporter: Transporter; key: string } | null = null;

function transporterFor(config: EmailConfig): Transporter {
  // Keyed on the config so a changed .env in a long-lived dev server takes
  // effect, while a stable one keeps its connection pool.
  const key = `${config.host}:${config.port}:${config.user}`;
  if (cached && cached.key === key) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is implicit TLS; 587 and 25 start in plaintext and STARTTLS up.
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });

  cached = { transporter, key };
  return transporter;
}

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Sends, or throws. It does NOT decide whether sending was the right thing to
 * do — that is auth.ts's Q7 table and the invitation's own rule, and both of
 * them treat a failure here differently (Q9 point 4). A function that both
 * decided and sent would force one answer on both.
 */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const config = readEmailConfig();
  if (!config) {
    // Reaching here means a caller skipped isEmailConfigured(). Say which
    // promise was broken rather than letting nodemailer report a missing host.
    throw new Error(
      "sendEmail called with no SMTP configuration — check isEmailConfigured() first",
    );
  }

  await transporterFor(config).sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
