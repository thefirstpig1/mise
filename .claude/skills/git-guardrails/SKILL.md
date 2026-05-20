---
name: git-guardrails
description: Documentation for the git safety hook installed in Mise. Blocks dangerous git commands (push, reset --hard, clean -fd, branch -D, etc.) before they execute. Read this if you encounter "BLOCKED" message from git command.
---

# Git Guardrails for Mise

Mise has a PreToolUse hook that blocks dangerous git commands before Claude Code executes them.

## What Gets Blocked

- `git push` (all variants including `--force`)
- `git reset --hard`
- `git clean -f` / `git clean -fd`
- `git branch -D`
- `git checkout .` / `git restore .`

When blocked, Claude Code sees a message telling it that the user has prevented these commands.

## Why

Mise has REAL artifacts in Neon production database + GitHub remote.
Accidents at this level = data loss / lost work / pushed mistakes.

Sprint 0-1 lessons:
- Sprint 0 we lost ~1 hour to schema drift from accidental db push
- We have public GitHub repo — bad pushes are visible
- Workshop Mode = many commits, easy to lose track

## How to use blocked commands

If user genuinely needs a blocked command:
1. User runs it manually in their own terminal (outside Claude Code)
2. User explicitly disables hook for one command (then re-enables)
3. NEVER bypass by suggesting Claude Code use a different tool

If you see BLOCKED message:
- Tell user what was blocked
- Explain why
- Ask if they want to run it manually
- Do NOT try workarounds

## Hook location

Project-scoped (only Mise):
- Script: .claude/hooks/block-dangerous-git.sh
- Settings: .claude/settings.json

## Files in this skill

- SKILL.md (this file) — documentation
- The actual hook script is at .claude/hooks/block-dangerous-git.sh
