// ============================================================
// คิดครัว — buttons come from the kit (Kong 2026-11-05)
// ============================================================
// "ดีไซน์บางจุดเหมือนมาจากคนละแอพ ... ไม่สอดคล้องกันเลยทั้งๆที่อยู่ข้างๆกัน"
// The audit counted ~500 hand-styled clickables out of 943. They are being
// moved onto the kit (.btn / .btn-secondary / .btn-danger(-solid) / .btn-sm /
// .icon-btn / .pill / .seg-item / .link) one menu group at a time, so this is
// a RATCHET: each shape below may only go down. When a sweep lowers a count,
// lower its ceiling here in the same commit — the test says by how much.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Every opening <button …> / <a …> / <Link …> tag with a static className. */
function clickables(): { file: string; cls: string; tag: string }[] {
  const found: { file: string; cls: string; tag: string }[] = [];
  for (const file of walk(join(ROOT, "src"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<(button|a|Link)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})[^>]*>/gs)) {
      found.push({ file: relative(ROOT, file), cls: m[2] ?? m[3] ?? "", tag: m[0] });
    }
  }
  return found;
}

const KIT = /\b(btn|btn-secondary|btn-ghost|btn-danger|btn-danger-solid|icon-btn|help-btn|pill|seg-item|tab|link)\b/;

/** The shapes the audit found, each a way of drawing a button by hand. */
const SHAPES: Record<string, (c: { cls: string; tag: string }) => boolean> = {
  /** A filled olive button made of utilities instead of `.btn`. */
  handMadePrimary: (c) => /\bbg-primary\b/.test(c.cls) && /\b(px|py|h)-/.test(c.cls) && !KIT.test(c.cls),
  /** A filled red confirm made of utilities instead of `.btn-danger-solid`. */
  handMadeDanger: (c) => /\bbg-bad\b(?!-)/.test(c.cls) && !KIT.test(c.cls),
  /** A small outlined capsule acting as a button (22–26px) instead of `.btn-sm` / `.pill`. */
  capsuleAction: (c) => /\brounded-full\b/.test(c.cls) && /\bborder\b/.test(c.cls) && /\bpy-(0\.5|1)\b/.test(c.cls) && /\btext-xs\b/.test(c.cls) && !KIT.test(c.cls),
  /** A close × that is not `.icon-btn`. */
  closeButton: (c) => /aria-label="ปิด"/.test(c.tag) && !/\bicon-btn\b/.test(c.cls) && !/\binset-0\b/.test(c.cls),
  /** An underlined text link drawn by hand instead of `.link` (three underline styles existed). */
  textLink: (c) => /(^|\s)(hover:)?underline(\s|$)/.test(c.cls) && !KIT.test(c.cls) && !/\b(border|bg-[a-z]|rounded)/.test(c.cls),
};

/** Ceilings as of 2026-11-05 — lower them as each menu group is swept. */
const CEILING: Record<keyof typeof SHAPES, number> = {
  handMadePrimary: 9,
  handMadeDanger: 0,
  capsuleAction: 0,
  closeButton: 0,
  textLink: 0,
};

describe("buttons come from the kit (ratchet)", () => {
  const all = clickables();
  for (const [name, test] of Object.entries(SHAPES) as [keyof typeof SHAPES, (c: { cls: string; tag: string }) => boolean][]) {
    it(`${name} does not grow past ${CEILING[name]}`, () => {
      const hits = all.filter(test).map((c) => `${c.file}: ${c.cls.slice(0, 90)}`);
      if (hits.length < CEILING[name]) {
        console.log(`[button-kit] ${name}: ${hits.length} left — lower its ceiling from ${CEILING[name]} to ${hits.length}`);
      }
      expect(hits.length, `hand-styled ${name}:\n${hits.join("\n")}`).toBeLessThanOrEqual(CEILING[name]);
    });
  }
});
