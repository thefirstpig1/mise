// ============================================================
// Mise — what the two letters may and may not contain (Part 31 L1)
// ============================================================
// ADR 0031 Q5 line 1 is the load-bearing rule of this Part: the invitation
// carries NO credential. It is the reason adding an invitation email does not
// reopen ADR 0029 Q2, which refused a second credential on purpose.
//
// A rule that lives only in a comment is a rule nothing tests, so E3 asserts
// the emptiness directly — and E3b pins the seam it cannot see, which is that
// the CALLER has to hand in a plain URL. The template can only promise it adds
// nothing of its own.
//
// No network, no transport, no env: templates.ts imports nothing at all.
// ============================================================

import { describe, it, expect } from "vitest";
import { magicLinkEmail, invitationEmail } from "@/lib/email/templates";

const MAGIC_URL =
  "https://mise.example/api/auth/callback/email?token=abc123&email=somchai%40example.com";
const LOGIN_URL = "https://mise.example/login";

describe("the magic link letter (ADR 0031 Q9)", () => {
  it("E1 — the url is reachable as a button AND as copyable text", () => {
    const mail = magicLinkEmail({ url: MAGIC_URL, expiresHours: 24 });

    // The button.
    expect(mail.html).toContain(`href="${MAGIC_URL}"`);
    // The same url again as plain text, because a button that a mail client
    // strips must not take the only way into Mise down with it.
    const withoutHref = mail.html.split(`href="${MAGIC_URL}"`).join("");
    expect(withoutHref).toContain(MAGIC_URL);

    // And the text part, which is what a plain-text reader gets.
    expect(mail.text).toContain(MAGIC_URL);
  });

  it("E2 — the lifetime in the sentence comes from the caller, never a copy", () => {
    // auth.ts owns maxAge. If this template held its own 24 it would keep
    // saying 24 on the day maxAge changed, and the letter would lie.
    const day = magicLinkEmail({ url: MAGIC_URL, expiresHours: 24 });
    const hour = magicLinkEmail({ url: MAGIC_URL, expiresHours: 1 });

    expect(day.text).toContain("24 ชั่วโมง");
    expect(hour.text).toContain("1 ชั่วโมง");
    expect(hour.text).not.toContain("24 ชั่วโมง");
    expect(hour.html).toContain("1 ชั่วโมง");
  });

  it("E3 — it says what to do if you did not ask for it", () => {
    const mail = magicLinkEmail({ url: MAGIC_URL, expiresHours: 24 });
    expect(mail.text).toContain("ถ้าคุณไม่ได้เป็นคนขอลิงก์นี้ ไม่ต้องทำอะไร");
    expect(mail.html).toContain("ถ้าคุณไม่ได้เป็นคนขอลิงก์นี้ ไม่ต้องทำอะไร");
  });
});

describe("the invitation letter carries no credential (ADR 0031 Q5)", () => {
  const invite = () =>
    invitationEmail({
      shopName: "ร้านเจ๊แดง",
      roleLabel: "ผู้จัดการ",
      loginUrl: LOGIN_URL,
    });

  it("E4 — no token, no callback, no query string anywhere in it", () => {
    const mail = invite();
    const everything = `${mail.subject}\n${mail.text}\n${mail.html}`;

    // The three shapes a credential would arrive in. If a future edit ever
    // personalises this letter with a link that signs someone in, one of these
    // goes red before it reaches a shop.
    expect(everything).not.toContain("token");
    expect(everything).not.toContain("callback");
    expect(everything).not.toContain("?");
  });

  it("E5 — it points at the plain sign-in page and says to type your own address", () => {
    const mail = invite();
    // Following this link signs nobody in. Asking for a link IS the acceptance
    // step, which is how ADR 0029 Q2 stays intact.
    expect(mail.text).toContain(LOGIN_URL);
    expect(mail.html).toContain(`href="${LOGIN_URL}"`);
    expect(mail.text).toContain("ใส่อีเมลนี้");
  });

  it("E6 — it names the shop and the role so a wrong recipient can tell", () => {
    const mail = invite();
    expect(mail.subject).toContain("ร้านเจ๊แดง");
    expect(mail.text).toContain("ร้านเจ๊แดง");
    expect(mail.text).toContain("ผู้จัดการ");
  });

  it("E7 — the Q8 safety net sentence is present in both parts", () => {
    // A mistyped address reaches a stranger, and the stranger is the person
    // best placed to know it is wrong. This sentence is the whole mitigation.
    const mail = invite();
    expect(mail.text).toContain("ถ้าคุณไม่รู้จักร้านนี้ ไม่ต้องทำอะไร");
    expect(mail.html).toContain("ถ้าคุณไม่รู้จักร้านนี้ ไม่ต้องทำอะไร");
  });

  it("E8 — a shop name is user data and must not be able to break the markup", () => {
    const mail = invitationEmail({
      shopName: `ร้าน "เจ๊แดง" & <ลูก>`,
      roleLabel: "พนักงาน",
      loginUrl: LOGIN_URL,
    });

    // html escapes it...
    expect(mail.html).toContain("&lt;ลูก&gt;");
    expect(mail.html).toContain("&amp;");
    expect(mail.html).not.toContain("<ลูก>");
    // ...and the plain-text part keeps it exactly as the owner typed it.
    expect(mail.text).toContain(`ร้าน "เจ๊แดง" & <ลูก>`);
  });
});
