// ============================================================
// คิดครัว — a "use server" file exports async functions only (queue item 9)
// ============================================================
// Next refuses the WHOLE module when a "use server" file exports anything
// else, and it does so only when an action in it is first called — tsc and
// build both pass, the page renders, and the button breaks. /consumption's
// `POST_CONSUMPTION_INIT` sat in its actions file like that until 2026-11-04.
// Initial states and labels belong in the screen or a plain module.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe('"use server" files', () => {
  it("export nothing but async functions (types are fine — they are erased)", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      if (!/^\s*["']use server["']/.test(src.replace(/^(\s*\/\/.*\n)+/, ""))) continue;
      const rel = relative(ROOT, file).split(sep).join("/");
      for (const m of src.matchAll(/^export\s+(const|let|var|class|enum|default\s+(?!async))\s*(\w*)/gm)) {
        offenders.push(`${rel}: export ${m[1].trim()} ${m[2]}`);
      }
      for (const m of src.matchAll(/^export\s+function\s+(\w+)/gm)) offenders.push(`${rel}: non-async function ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });
});
