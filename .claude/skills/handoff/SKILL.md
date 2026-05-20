---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up. Use when user wants to preserve context for the next session, says "/handoff", or before ending a long session.
argument-hint: "What will the next session focus on?"
---

# Session Handoff

Write a handoff document summarising the current conversation so a fresh agent can continue the work.

## Save location

Save to a temp location:
- Windows: `%TEMP%\mise-handoff-{timestamp}.md`
- Linux/Mac: `/tmp/mise-handoff-{timestamp}.md`

NOT in the project workspace (would clutter git).

## Content

Include:

### 1. Current state
- What sprint, what part
- What's working
- What's pending
- Last commit hash

### 2. Active task
- What user was trying to accomplish
- What's been tried
- What's blocking (if anything)

### 3. Suggested skills section
List skills the next agent should invoke:
- `/ai-collaboration` — always read first
- `/grill-with-docs` if user is exploring a design
- `/tdd` if user is implementing
- `/handoff` again when wrapping up
- ... whatever matches the upcoming work

### 4. Reference paths
- CLAUDE.md (root context)
- docs/sprint-progress.md (LIVE status)
- .claude/skills/known-pitfalls/SKILL.md
- Last commit

## What NOT to include

- Don't duplicate content from PRDs/plans/ADRs — reference by path
- Don't include secrets (API keys, passwords)
- Don't include long debug logs — summarize root cause + fix

## Mise-specific handoff template

```markdown
# Mise Session Handoff — {date}

## Current Sprint: {Sprint N — Title}
## Last commit: {hash}
## Next focus: {user's arg or "general"}

## What's done
- {milestone 1}
- {milestone 2}

## What's pending
- {next task}
- {after that}

## Active work (if interrupted mid-task)
- Trying to: {goal}
- Tried: {approach 1}, {approach 2}
- Result: {what happened}
- Stuck on: {if blocked}

## Suggested skills next session
- Read CLAUDE.md first
- Then: ai-collaboration, {others as needed}

## References
- Sprint progress: docs/sprint-progress.md
- Last commit: git log -1
- Known pitfalls: .claude/skills/known-pitfalls/SKILL.md
```

## When invoked

User says one of:
- "/handoff"
- "ทำ handoff ก่อนปิด session"
- "save context"
- "compact this session"

If user passes argument like "/handoff Sprint 2 setup", treat as the focus of next session.
