// ============================================================
// Mise — what the two letters say (Part 31 L1, ADR 0031 Q5/Q9)
// ============================================================
// TWO LETTERS AND THEY OBEY DIFFERENT RULES.
//
//   magic link   — carries the credential. It IS the way in.
//   invitation   — carries NOTHING that can sign anyone in (ADR 0031 Q5,
//                  line 1). It names the shop and points at /login, and the
//                  person has to ask for their own link. That is what keeps
//                  ADR 0029 Q2's refusal of a second credential intact.
//
// The invitation's emptiness is a property worth a test, not a comment, so
// tests/email-templates.test.ts asserts that no token and no callback URL can
// appear in it.
//
// ZERO DEPENDENCIES ON PURPOSE. Rendering must be testable without a network,
// a transport, or an env var — so this file imports nothing and every input
// arrives as a parameter, including how long a link lasts (see below).
//
// Multipart text + html (Q9): plain text carries the deliverability, html
// carries the "this is a real product" look for a shop owner. nodemailer sends
// both in one message. Every html letter ALSO prints the full URL as copyable
// text, because a button that does not survive somebody's mail app must not
// take the only way in down with it.
// ============================================================

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

/**
 * The shop name is user data and lands inside markup. A shop called
 * `ร้าน "เจ๊แดง" & ลูก` must render as itself, not as broken html.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', sans-serif";

/** One shell for both letters, so they cannot drift apart in look. */
function shell(bodyHtml: string): string {
  return [
    `<div style="font-family:${FONT_STACK};max-width:480px;margin:0 auto;padding:24px;color:#111">`,
    `<p style="font-size:20px;font-weight:700;margin:0 0 24px">Mise</p>`,
    bodyHtml,
    `<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px">`,
    `<p style="font-size:12px;color:#666;margin:0">Mise — ระบบหลังร้านสำหรับร้านอาหาร</p>`,
    `</div>`,
  ].join("");
}

function button(url: string, label: string): string {
  // The href is a URL this server just built, not user input — but the copyable
  // line below it is the one that has to survive a mail client that strips
  // styling, so both are always present.
  return [
    `<p style="margin:0 0 24px">`,
    `<a href="${url}" style="display:inline-block;background:#111;color:#fff;`,
    `text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">`,
    `${label}</a></p>`,
  ].join("");
}

function copyableUrl(url: string): string {
  return [
    `<p style="font-size:13px;color:#666;margin:0 0 8px">`,
    `ถ้าปุ่มกดไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์</p>`,
    `<p style="font-size:13px;word-break:break-all;margin:0 0 24px">${url}</p>`,
  ].join("");
}

// ------------------------------------------------------------
// 1. The magic link — login and signup both use this one
// ------------------------------------------------------------

/**
 * `expiresHours` is a PARAMETER, not a constant, because the number in the
 * sentence has to be the number `auth.ts` actually enforces. A letter that
 * says 24 hours while the token dies in one is a letter that lies, and the
 * only defence against that is refusing to hold a second copy of the value.
 */
export function magicLinkEmail(input: {
  url: string;
  expiresHours: number;
}): RenderedEmail {
  const { url, expiresHours } = input;

  const text = [
    "คลิกลิงก์ด้านล่างเพื่อเข้าสู่ระบบ Mise",
    "",
    url,
    "",
    `ลิงก์นี้ใช้ได้ ${expiresHours} ชั่วโมง และใช้ได้ครั้งเดียว`,
    "ถ้าคุณไม่ได้เป็นคนขอลิงก์นี้ ไม่ต้องทำอะไร",
  ].join("\n");

  const html = shell(
    [
      `<p style="margin:0 0 24px">คลิกปุ่มด้านล่างเพื่อเข้าสู่ระบบ Mise</p>`,
      button(url, "เข้าสู่ระบบ"),
      copyableUrl(url),
      `<p style="font-size:13px;color:#666;margin:0">`,
      `ลิงก์นี้ใช้ได้ ${expiresHours} ชั่วโมง และใช้ได้ครั้งเดียว<br>`,
      `ถ้าคุณไม่ได้เป็นคนขอลิงก์นี้ ไม่ต้องทำอะไร</p>`,
    ].join(""),
  );

  return { subject: "ลิงก์เข้าสู่ระบบ Mise", text, html };
}

// ------------------------------------------------------------
// 2. The invitation — carries no credential (ADR 0031 Q5, Q8)
// ------------------------------------------------------------

/**
 * `loginUrl` is the plain sign-in page. It is not personalised, it holds no
 * token, and following it signs nobody in — the reader has to type their own
 * address and ask for a link, which IS the acceptance step ADR 0029 says the
 * magic link already performs.
 *
 * The closing sentence is the Q8 safety net: a mistyped address reaches a
 * stranger, and the stranger is the person best placed to know it is wrong.
 */
export function invitationEmail(input: {
  shopName: string;
  roleLabel: string;
  loginUrl: string;
}): RenderedEmail {
  const { shopName, roleLabel, loginUrl } = input;

  const text = [
    `คุณถูกเชิญให้เข้าใช้งานระบบหลังร้านของ ${shopName}`,
    "",
    `ร้าน: ${shopName}`,
    `สิทธิ์: ${roleLabel}`,
    "",
    `เข้าใช้งานได้ที่ ${loginUrl}`,
    "ใส่อีเมลนี้แล้วระบบจะส่งลิงก์เข้าสู่ระบบไปให้",
    "",
    "ถ้าคุณไม่รู้จักร้านนี้ ไม่ต้องทำอะไร",
  ].join("\n");

  const shop = escapeHtml(shopName);
  const role = escapeHtml(roleLabel);

  const html = shell(
    [
      `<p style="margin:0 0 16px">คุณถูกเชิญให้เข้าใช้งานระบบหลังร้านของ <strong>${shop}</strong></p>`,
      `<p style="margin:0 0 24px;font-size:14px;color:#444">`,
      `ร้าน: ${shop}<br>สิทธิ์: ${role}</p>`,
      button(loginUrl, "เข้าใช้งาน"),
      copyableUrl(loginUrl),
      `<p style="font-size:13px;color:#666;margin:0">`,
      `ใส่อีเมลนี้ในหน้าเข้าสู่ระบบ แล้วระบบจะส่งลิงก์ไปให้<br>`,
      `ถ้าคุณไม่รู้จักร้านนี้ ไม่ต้องทำอะไร</p>`,
    ].join(""),
  );

  return {
    subject: `คุณถูกเชิญเข้าใช้งาน Mise ของ ${shopName}`,
    text,
    html,
  };
}
