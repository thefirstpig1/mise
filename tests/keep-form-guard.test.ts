// ============================================================
// คิดครัว — a refused form keeps what was typed (Kong 2026-10-30)
// ============================================================
// React 19 resets <form action={dispatch}> after every submission, refused
// ones included. Setting up a shop, one missing VAT rate wiped the supplier's
// name and phone. `useKeepForm` (src/lib/keep-form.ts) fixes it per form, and
// this test keeps the next new form from quietly going back to the old way:
// a client component that binds a useActionState dispatch straight onto a
// <form action={…}> fails here, by name.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Forms with no field to lose — a single button, confirmed in a dialog. */
const ALLOWED: Record<string, string> = {
  "src/app/(app)/expenses/_components/DeleteExpenseButton.tsx": "one delete button behind a confirm dialog; nothing typed",
  "src/app/(app)/expenses/_components/RetireRecurringButton.tsx": "one button behind a confirm dialog; nothing typed",
  "src/app/(app)/products/_components/DeleteMappingButton.tsx": "one delete button behind a confirm dialog; nothing typed",
};

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("forms keep typed values when the action refuses", () => {
  it("no client form binds a useActionState dispatch to action={…} directly", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file).split(sep).join("/");
      // Comment lines out: several files describe the old binding in prose.
      const src = readFileSync(file, "utf8").replace(/^\s*(\/\/|\/?\*).*$/gm, "");
      if (!src.includes("useActionState")) continue;
      const dispatches = [...src.matchAll(/const \[\w+, (\w+), \w+\] = useActionState/g)].map((m) => m[1]);
      for (const d of dispatches) {
        // the dispatch on a <form …> tag, on its own or among other attributes
        const bound = new RegExp(`<form[^>]*\\saction=\\{${d}\\}`, "s");
        if (bound.test(src) && !ALLOWED[rel]) offenders.push(`${rel} (${d})`);
      }
    }
    expect(offenders, "use `<form {...useKeepForm(dispatch, state)}>` — see src/lib/keep-form.ts").toEqual([]);
  });
});
