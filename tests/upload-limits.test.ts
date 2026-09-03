// ============================================================
// Mise — the framework must not refuse before we do
// (Sprint 7 Part 34, ADR 0033 fact 3)
// ============================================================
// Two numbers in two files that must stay in a particular ORDER, in a place
// where nothing else would ever notice they had drifted.
//
// `MAX_SALES_FILE_BYTES` is the app's own limit, and Part 19 wrote a Thai
// sentence naming it. Next's Server Action body limit is the framework's, and
// it defaults to 1 MB — so from Part 19 until Part 34 every sales file over
// 1 MB was refused with an English 413 before `readUploadedFile` ran, and the
// sentence written for that exact case could not be reached.
//
// The relationship is an inequality, not an equality: the framework's ceiling
// must sit ABOVE ours, so the file that is one byte too large is refused by us,
// in Thai, with the size named. Equal values would hand that refusal back to
// the framework.
// ============================================================

import { describe, it, expect } from "vitest";

import nextConfig from "../next.config";
import { MAX_SALES_FILE_BYTES } from "@/lib/validations/sales-import";

/** "16mb" -> bytes. Only the shapes Next itself accepts. */
function toBytes(limit: string | number): number {
  if (typeof limit === "number") return limit;
  const m = limit.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!m) throw new Error(`unparseable body size limit: ${limit}`);
  const scale = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 } as const;
  return Number(m[1]) * scale[(m[2] ?? "b") as keyof typeof scale];
}

describe("upload limits", () => {
  it("U1: the Server Action body limit is set at all", () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;

    expect(
      limit,
      `Unset means Next's default of 1 MB (action-handler.js:434), which is ` +
        `fifteen times smaller than the file MAX_SALES_FILE_BYTES promises to ` +
        `accept. The failure is a 413 in English before any of our code runs.`
    ).toBeDefined();
  });

  it("U2: it sits ABOVE the app's own limit, so the app owns the refusal", () => {
    const framework = toBytes(
      nextConfig.experimental!.serverActions!.bodySizeLimit!
    );

    expect(
      framework,
      `The framework limit (${framework}) must exceed MAX_SALES_FILE_BYTES ` +
        `(${MAX_SALES_FILE_BYTES}). At or below it, a file just over the app's ` +
        `limit is refused by Next in English instead of by readUploadedFile in ` +
        `Thai — and the message naming the size never appears.`
    ).toBeGreaterThan(MAX_SALES_FILE_BYTES);
  });
});
