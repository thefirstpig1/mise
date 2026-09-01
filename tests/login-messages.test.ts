// ============================================================
// Mise — the sentences the login page shows (Part 31 L3, ADR 0031 Q9)
// ============================================================
// Part 29 paid twice for the lesson these cases are written around: two
// refusals that share a phrase are ONE assertion, not two. Three of the four
// notices here contain the words "ส่งอีเมลไม่สำเร็จ", so every case asserts on
// the half that only it has — otherwise deleting a branch would leave the
// suite green.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  loginNoticeFor,
  displayableAddress,
  checkEmailHintFor,
} from "@/lib/email/login-messages";

describe("loginNoticeFor (ADR 0031 Q9)", () => {
  it("N1 — no error code means no box at all", () => {
    expect(loginNoticeFor(undefined)).toBeNull();
    expect(loginNoticeFor("")).toBeNull();
  });

  it("N2 — an expired or used link says so, and invites a new one", () => {
    const notice = loginNoticeFor("Verification");
    // The distinctive half: only this notice talks about the link itself
    // being spent, and only this one is not an error in the shop's eyes.
    expect(notice?.detail).toContain("ใช้ได้ครั้งเดียว");
    expect(notice?.tone).toBe("info");
  });

  it("N3 — a signup whose letter failed says the shop EXISTS, do not sign up again", () => {
    const notice = loginNoticeFor("SignupEmailFailed");
    // The whole reason this code exists: pressing สร้างบัญชี a second time
    // makes a second shop, because createTenant is not idempotent.
    expect(notice?.detail).toContain("ไม่ต้องสมัครใหม่");
    expect(notice?.title).toContain("สร้างร้านเรียบร้อยแล้ว");
  });

  it("N4 — Configuration is written to be true of BOTH causes", () => {
    // @auth/core labels an SMTP failure and the Q6 rate-limit refusal with the
    // same code, so this sentence may not assume either. It says the send did
    // not happen, and it says the thing worth knowing if the cause was the
    // limit — that the links already sent still work.
    const notice = loginNoticeFor("Configuration");
    expect(notice?.detail).toContain("ลิงก์ล่าสุดที่ส่งไปแล้วยังใช้ได้");
    expect(notice?.tone).toBe("error");
  });

  it("N5 — an error code nobody has named still produces a notice", () => {
    // Silence would be the worst outcome: the send failed and the page would
    // look exactly like a page that had done nothing.
    const notice = loginNoticeFor("SomethingAuthjsAddedLater");
    expect(notice).not.toBeNull();
    expect(notice?.detail).toContain("ลิงก์ล่าสุดที่ส่งไปแล้วยังใช้ได้");
  });

  it("N6 — no notice ever claims the letter was sent", () => {
    // The one thing a failure screen must never do. A person told to check
    // their inbox waits for a letter that is not coming and concludes Mise is
    // broken, rather than that one send failed.
    for (const code of [
      "Verification",
      "SignupEmailFailed",
      "AccessDenied",
      "Configuration",
      "Whatever",
    ]) {
      const notice = loginNoticeFor(code);
      const words = `${notice?.title} ${notice?.detail}`;
      expect(words, code).not.toContain("เช็คอีเมลของคุณ");
      expect(words, code).not.toContain("ส่งลิงก์ไปที่");
    }
  });
});

describe("displayableAddress — echoing a query param back at the reader", () => {
  it("N7 — a real address is shown, so a typo becomes visible", () => {
    expect(displayableAddress("somchai@example.com")).toBe("somchai@example.com");
    expect(displayableAddress("  malee@shop.co.th  ")).toBe("malee@shop.co.th");
  });

  it("N8 — anything not shaped like an address is refused", () => {
    // Anyone can craft /login?check-email=<their own sentence>. React escapes
    // it so there is no injection, but attacker-chosen text sitting on a Mise
    // login page is still a sentence Mise did not write.
    for (const junk of [
      "ติดต่อเจ้าหน้าที่ที่ line @scammer",
      "<b>hello</b>",
      "not-an-email",
      "@example.com",
      "a@b",
      "a@b.",
      "two words@example.com",
      "",
    ]) {
      expect(displayableAddress(junk), JSON.stringify(junk)).toBeNull();
    }
    expect(displayableAddress(undefined)).toBeNull();
  });

  it("N9 — an absurdly long value is refused rather than rendered", () => {
    const long = `${"a".repeat(250)}@example.com`;
    expect(displayableAddress(long)).toBeNull();
  });
});

describe("checkEmailHintFor — the line that used to name a terminal", () => {
  it("N10 — when a real letter went out, nobody is told to read a terminal", () => {
    // The bug ADR 0031 Q7 names: this string was hardcoded, and the moment
    // sending was switched on it started instructing shop owners to look at a
    // dev server they do not have.
    for (const mode of ["send", "refuse"] as const) {
      expect(checkEmailHintFor(mode), mode).not.toContain("terminal");
      expect(checkEmailHintFor(mode), mode).not.toContain("dev");
    }
  });

  it("N11 — with no transport configured it still says where the link is", () => {
    // A fresh clone must keep working exactly as before.
    expect(checkEmailHintFor("console")).toContain("terminal");
  });
});
