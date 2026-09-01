// ============================================================
// Mise — what the login page says when something went wrong
// (Part 31 L3, ADR 0031 Q9)
// ============================================================
// Pure string mapping, kept out of the page so it can be tested without
// rendering anything.
//
// 🔴 THE HONEST LIMIT, AND WHY IT IS NOT A SHRUG. @auth/core labels every
// non-AuthError as `Configuration` (index.js:131), so an SMTP failure and the
// Q6 rate-limit refusal arrive at this page as the SAME code. There is no
// side channel that would separate them and inventing one would be machinery
// built to make a sentence prettier.
//
// So the Configuration sentence is written to be TRUE OF BOTH: it says the
// send did not happen, and it says the thing that is worth knowing if the
// cause was the limit — the links already sent still work. Neither half is a
// guess about which case the reader is in.
//
// The one thing it must never do is claim success. A screen that says
// "check your email" after a failed send sends someone to wait for a letter
// that is not coming, and they conclude Mise is broken rather than that one
// send failed (rules C10/W4, applied to a screen instead of a number).
// ============================================================

export type LoginNotice = {
  tone: "error" | "info";
  title: string;
  detail: string;
};

export function loginNoticeFor(errorCode: string | undefined): LoginNotice | null {
  if (!errorCode) return null;

  switch (errorCode) {
    case "Verification":
      // The link was already used, or it is older than maxAge. Auth.js reports
      // this one properly, so it gets a sentence of its own.
      return {
        tone: "info",
        title: "ลิงก์นี้ใช้ไม่ได้แล้ว",
        detail:
          "ลิงก์เข้าสู่ระบบใช้ได้ครั้งเดียวและหมดอายุใน 24 ชั่วโมง กรอกอีเมลด้านล่างเพื่อขอลิงก์ใหม่",
      };

    case "SignupEmailFailed":
      // Ours, not Auth.js's. The shop exists; only the letter failed. Saying
      // so is what stops the person pressing "สร้างบัญชี" again and getting a
      // second shop with the same name.
      return {
        tone: "error",
        title: "สร้างร้านเรียบร้อยแล้ว แต่ส่งอีเมลไม่สำเร็จ",
        detail:
          "ไม่ต้องสมัครใหม่ — ร้านของคุณถูกสร้างแล้ว กรอกอีเมลเดิมด้านล่างเพื่อขอลิงก์เข้าสู่ระบบอีกครั้ง",
      };

    case "AccessDenied":
      return {
        tone: "error",
        title: "เข้าสู่ระบบไม่ได้",
        detail: "อีเมลนี้ไม่ได้รับอนุญาตให้เข้าใช้งาน",
      };

    default:
      // Configuration, and anything Auth.js has not named. True whether the
      // transport failed or the request was refused for coming too often.
      return {
        tone: "error",
        title: "ส่งอีเมลไม่สำเร็จ",
        detail:
          "ลองใหม่อีกครั้ง — ถ้าคุณเพิ่งขอลิงก์ไปหลายครั้ง ลิงก์ล่าสุดที่ส่งไปแล้วยังใช้ได้",
      };
  }
}

/**
 * The line under "เช็คอีเมลของคุณ".
 *
 * Before Part 31 this was hardcoded as "(Dev mode — ลิงก์จะแสดงใน terminal ของ
 * dev server)", which was true of every visitor for as long as nothing could
 * send. The moment a letter really goes out it becomes an instruction to look
 * in a terminal the reader does not have — so it is a function of the same
 * decision auth.ts made about that very letter, and lives here rather than in
 * JSX so it can be held to that.
 */
export function checkEmailHintFor(mode: "send" | "console" | "refuse"): string {
  return mode === "console"
    ? "(ยังไม่ได้ตั้งค่าอีเมล — ลิงก์จะแสดงใน terminal ของ dev server)"
    : "ลิงก์ใช้ได้ 24 ชั่วโมง และใช้ได้ครั้งเดียว";
}

/**
 * `?check-email=` is displayed back to the reader, and anyone can put anything
 * in a query string. React escapes it so there is no injection, but arbitrary
 * attacker-chosen text on a Mise login page is still a sentence we did not
 * write — so only something shaped like an address is echoed, and everything
 * else falls back to the generic line.
 */
export function displayableAddress(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}
