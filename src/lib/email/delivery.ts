// ============================================================
// Mise — which of the four cells we are in (Part 31 L2, ADR 0031 Q7)
// ============================================================
// Until this Part the switch was `process.env.NODE_ENV === "development"`,
// which meant proving that email works at all required running the whole app
// in production mode. Q7 moves it to a question about credentials:
//
//                   | SMTP configured | not configured
//   ----------------|-----------------|----------------
//   development     | send            | console
//   production      | send            | REFUSE
//
// The bottom-right cell is the point of the table. A production server with no
// credentials must not quietly log the link: that is a working credential
// sitting in server logs AND a person told to check an inbox nothing will ever
// arrive in. Refusing is louder and safer than both.
//
// Pure on purpose — it takes two booleans and returns a word, so all four cells
// are testable without touching process.env or a transport.
// ============================================================

export type DeliveryMode = "send" | "console" | "refuse";

export function decideEmailDelivery(input: {
  isProduction: boolean;
  configured: boolean;
}): DeliveryMode {
  if (input.configured) return "send";
  return input.isProduction ? "refuse" : "console";
}

/**
 * Read once, here, so nothing else in the email path has to know that
 * "production" is spelled with NODE_ENV.
 */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}
