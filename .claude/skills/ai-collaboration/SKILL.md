---
name: ai-collaboration
description: Behavioral baseline for Mise project. Read at start of every session. Codifies Sprint 0-1 lessons to prevent common AI failure modes (debugging spirals, destructive operations, over-engineering, scope creep).
---

# AI Collaboration Patterns for Mise

Read this skill at the start of EVERY session. These patterns prevent
the common LLM failure modes we encountered in Sprint 0-1.

## 1. Think Before Coding

### Before any non-trivial change:
- State assumptions explicitly in chat
- If uncertain, ASK — don't guess silently
- If multiple approaches exist, present trade-offs
- Identify what's unclear BEFORE writing code

### What counts as "non-trivial":
- Touching schema.prisma
- Adding new tables or columns
- Changing auth/permission logic
- Anything affecting RLS policies
- Anything in src/server/ or src/lib/

### What can proceed without asking:
- Reading files for context
- Running read-only commands (git status, prisma validate, count queries)
- Adding UI text (Thai labels, button copy)
- Writing tests for explicit requirements

## 2. Simplicity First

### Write minimum code that works:
- No speculative features ("might be useful later")
- No abstractions for code used once
- No "flexibility" not requested
- No error handling for impossible cases

### Mise-specific anti-patterns:
- ❌ Adding "isAdmin" field "just in case" when not asked
- ❌ Wrapping every query in try/catch when no clear failure mode
- ❌ Adding loading skeletons when "กำลังโหลด..." text suffices
- ❌ Custom hooks for one-time use

### Self-test before writing 100+ lines:
"Would a senior engineer ขำใส่นี้?" ถ้าใช่ — rewrite.

## 3. Surgical Changes

### Touch only what's requested:
- Don't "improve" adjacent code
- Don't refactor code that works
- Match existing style even if you'd do it differently
- Mention unrelated issues — don't fix silently

### When YOUR changes leave orphans:
- Remove imports YOUR changes made unused
- Don't remove pre-existing dead code unless asked

### Mise-specific:
- Don't touch Sprint 0 code unless Sprint 1 needs it
- Don't modify RLS policies without explicit instruction
- Don't change package.json scripts without asking
- Don't modify .env file without asking (contains secrets)

## 4. Goal-Driven Execution

### Transform vague tasks into verifiable goals:

| Vague | Verifiable |
|-------|------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before AND after" |
| "Build CRUD" | "User can create/read/update/delete via UI, RLS prevents leak" |

### For multi-step tasks, state plan FIRST:

[Step] → verify: [check]
[Step] → verify: [check]
[Step] → verify: [check]


### Strong success criteria = loop independently
### Weak success criteria = constant back-and-forth

## 5. Stop Conditions (Mise-specific)

### STOP and ask user when:
- About to run destructive command (DROP, TRUNCATE, RESET, DELETE > 1 row, rm -rf)
- About to install new dependency (especially native modules)
- About to modify .env file
- About to modify .claude/skills/ or docs/master-spec-summary.md
- Encountered same error 2x — root cause unclear
- Plan exceeds 5 sub-steps

### Why these specifically:
- Sprint 0-1 has REAL ARTIFACTS in Neon — destructive = data loss
- Native modules on Windows = setup pain (we abandoned Docker for this)
- .env contains DATABASE_URL/DIRECT_URL/AUTH_SECRET — critical
- Skills/docs = project memory, changes affect future sessions
- Repeated errors = debugging spiral risk (hit this in Part 3a)

## 6. Anti-Spiral Rules (lessons from Sprint 1 Part 3a)

### When debugging:
1. First action: state hypothesis
2. Second action: simplest possible verification
3. If verification disproves hypothesis: STOP, re-think
4. Don't chain hypotheses without verifying each

### Specifically:
- ❌ "Maybe it's TCP" → "Let me install pg" → "Let me check global paths"
- ✅ "P1001 means connection failed" → "Check DATABASE_URL" → root cause found

### Spiral warning signs:
- Adding new dependencies to debug
- Running 3+ diagnostic commands in a row
- Hypotheses getting more exotic, not simpler

### When you notice yourself spiraling:
Stop. Tell user: "I've tried X, Y, Z without success. Could be [list 2-3
plausible causes]. Should we step back?"

## 7. Workshop Mode Compatibility

This is a LEARNING project, not a production rush.

### Optimize for:
- User understanding (explain WHY when introducing new concept)
- Reversibility (commit after each working state)
- Debugging visibility (verbose logs in dev)

### Don't optimize for:
- Premature performance
- Premature abstraction
- Premature "production hardening"

### When user says "ลุย" / "ไปต่อ":
- They want momentum, not exhaustive verification
- Quick sanity check OK; deep test suite NO
- If something needs careful attention, say so — don't slow silently

## 8. Communication Defaults

### Format outputs as:
- Status table for multi-step results
- Diff preview before applying changes (when 5+ files affected)
- Thai language for user-facing, English for technical

### When uncertain about user intent:
- Quote the ambiguous part back
- Offer 2-3 interpretations
- Ask which fits

### When you finish a task:
- State what changed (one line each, max 5 lines)
- State what was tested (or "not tested because X")
- State next logical step (don't auto-execute)
