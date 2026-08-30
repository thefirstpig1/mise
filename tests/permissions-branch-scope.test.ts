// ============================================================
// Mise — no write escapes its branch (Sprint 6 Part 28 L3c, ADR 0029 Q5)
// ============================================================
// Narrowing the branch LIST (rule A5) fixes what a person can see and pick. It
// does nothing about a crafted POST: `branch_id` arrives as a FormData field,
// and a server action that trusts it will move stock at a branch the sender was
// never given. So every action whose input carries a branch must call
// `assertBranch` on it.
//
// WHICH ACTIONS THOSE ARE IS NOT GUESSED FROM THE SOURCE. An earlier version of
// this file looked for `formData.get("branch_id")` inside each exported action
// and was WRONG in both directions: the form parsing lives in module-level
// helpers (`expenseFromFormData`), so the real actions looked innocent while
// whichever function happened to precede the helper got the blame.
//
// Instead the zod schemas are IMPORTED AND INSPECTED. A schema that carries a
// branch field is a fact about the request the action accepts, read from the
// same object the runtime validates against — no second list to drift.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { z } from "zod";

const APP = join(process.cwd(), "src", "app");
const VALIDATIONS = join(process.cwd(), "src", "lib", "validations");

const BRANCH_FIELDS = ["branchId", "fromBranchId", "toBranchId", "branchIds"];

/**
 * Actions that take a branch and deliberately do not assert reach on it.
 * A name alone is not an exemption; B4 requires a reason long enough to have
 * been thought about.
 */
const EXEMPT: Record<string, string> = {
  // These take branch ids to GRANT them to somebody else, which is a different
  // question from acting on a branch, and `assertBranch` answers it wrongly in
  // both directions. It would pass a branch manager handing out `allBranches`
  // (the ids list is empty, so there is nothing to assert), and it says nothing
  // about the act being a grant. Rule 2 — `canGrantReach` in membership.ts —
  // is the stronger check and the one these use: it refuses reach laundering
  // as well as out-of-reach branches. Pinned by Q15-3 in membership-e2e.
  inviteMemberAction:
    "grants reach rather than acting on it; enforced by canGrantReach (rule 2), which also refuses allBranches laundering",
  updateMemberAction:
    "grants reach rather than acting on it; enforced by canGrantReach (rule 2), which also refuses allBranches laundering",
};

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Peel ZodEffects/ZodOptional/... until an object shape appears. */
function shapeOf(schema: unknown): Record<string, unknown> | null {
  let node = schema as { _def?: Record<string, unknown> } | undefined;
  for (let i = 0; i < 8 && node; i++) {
    if (node instanceof z.ZodObject) return node.shape as Record<string, unknown>;
    const def = node._def as { schema?: unknown; innerType?: unknown } | undefined;
    node = (def?.schema ?? def?.innerType) as typeof node;
  }
  return null;
}

/** Names of exported schemas whose input carries a branch. */
async function branchCarryingSchemas(): Promise<Set<string>> {
  const names = new Set<string>();

  for (const full of walk(VALIDATIONS, ".ts")) {
    const rel = relative(process.cwd(), full).split(sep).join("/");
    const mod: Record<string, unknown> = await import(
      /* @vite-ignore */ "/" + rel.replace(/^src\//, "@/").replace("@/", "src/")
    ).catch(() => ({}));

    for (const [name, value] of Object.entries(mod)) {
      const shape = shapeOf(value);
      if (shape && BRANCH_FIELDS.some((f) => f in shape)) names.add(name);
    }
  }
  return names;
}

interface Fn {
  file: string;
  name: string;
  line: number;
  body: string;
}

/** Every exported async function in a "use server" module, with its body. */
function actionFunctions(): Fn[] {
  const fns: Fn[] = [];

  for (const full of walk(APP, ".ts")) {
    const raw = readFileSync(full, "utf8").replace(/\r\n/g, "\n");
    if (!raw.startsWith('"use server"')) continue;

    const file = relative(process.cwd(), full).split(sep).join("/");
    const lines = raw.split("\n");

    let start = -1;
    let name = "";
    const push = (end: number) => {
      if (start >= 0) {
        fns.push({ file, name, line: start + 1, body: lines.slice(start, end).join("\n") });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^export async function (\w+)/);
      if (m) {
        push(i);
        start = i;
        name = m[1];
      }
    }
    push(lines.length);
  }
  return fns;
}

describe("branch scope on writes (ADR 0029 Part 28 L3c)", () => {
  const fns = actionFunctions();

  it("B1 — the scan finds the action modules at all", () => {
    // If the walker or the "use server" check stops matching, every assertion
    // below passes over an empty list and the suite lies while looking green.
    expect(fns.length).toBeGreaterThan(50);
  });

  it("B2 — every action whose schema carries a branch asserts reach on it", async () => {
    const branchSchemas = await branchCarryingSchemas();
    expect(branchSchemas.size, "no branch-carrying schema found").toBeGreaterThan(5);

    const takesBranch = (f: Fn) =>
      [...branchSchemas].some((s) => f.body.includes(`${s}.safeParse`));

    const scoped = fns.filter(takesBranch);
    expect(scoped.length, "no branch-scoped action found").toBeGreaterThan(8);

    const unguarded = scoped
      .filter((f) => !EXEMPT[f.name])
      .filter((f) => !f.body.includes("assertBranch("))
      .map((f) => `${f.file}:${f.line} ${f.name}`);

    expect(unguarded).toEqual([]);
  });

  it("B5 — every branch listing narrows to reach", () => {
    // Rule A5 lives at the SET of branches, so it is enforced by there being no
    // unnarrowed `branch.findMany` anywhere — not by remembering at each read.
    //
    // This test exists because removing `branchScopeWhere` from `getBranchesLogic`
    // was tried and NOTHING WENT RED: the unit tests cover the helper, and the 26
    // screens that call it have no test of their own. A static scan is the
    // cheapest thing that can see it.
    // A listing that must NOT narrow, with the reason. The only one.
    //
    // `assertBranchesExist` asks "is this branch part of this SHOP", which is a
    // different question from "may you reach it" and has to stay that way: if
    // it narrowed to the actor's reach, a manager granting สีลม would be told
    // "ไม่พบสาขา" — that the branch does not exist — when the truth is that it
    // does and they may not hand it out. Rule 2 gives that person the right
    // sentence, and it runs first.
    const MUST_NOT_NARROW: Record<string, string> = {
      "src/server/membership.ts":
        "tenant membership check, not a reach check — narrowing it would report a real branch as missing",
    };

    const offenders: string[] = [];

    const src = join(process.cwd(), "src");
    for (const full of [...walk(src, ".ts"), ...walk(src, ".tsx")]) {
      const text = readFileSync(full, "utf8");
      const file = relative(process.cwd(), full).split(sep).join("/");
      const lines = text.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        if (!/\bbranch\.findMany\(/.test(lines[i])) continue;
        // the where clause sits within a few lines of the call
        const near = lines.slice(i, i + 12).join("\n");
        if (!near.includes("branchScopeWhere(") && !MUST_NOT_NARROW[file]) {
          offenders.push(`${file}:${i + 1}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("B3 — a dispatch asserts BOTH ends of a transfer", () => {
    // Stock in transit belongs to the RECEIVING branch from the moment of
    // dispatch (ADR 0018), so a person who reaches only the sender could still
    // push stock into a branch they have nothing to do with. Both legs, or the
    // guard is decorative.
    const dispatch = fns.find((f) => f.name === "dispatchTransferAction");
    expect(dispatch, "dispatchTransferAction not found").toBeDefined();
    const calls = dispatch!.body.match(/assertBranch\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("B4 — every exemption carries a reason, not just a name", () => {
    // An exemption list is where a guard goes to die. Each entry has to name
    // a function that still exists and give a reason long enough to have been
    // thought about — otherwise the next person adds a name and moves on.
    expect(Object.keys(EXEMPT).length, "exemptions are creeping").toBeLessThan(5);

    for (const [name, why] of Object.entries(EXEMPT)) {
      expect(fns.some((f) => f.name === name), `${name} no longer exists`).toBe(true);
      expect(why.length, `${name} needs a real reason`).toBeGreaterThan(30);
    }
  });
});
