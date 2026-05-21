---
name: token-awareness
description: Monitor context/token budget. Warn user BEFORE running out so user can save work + /handoff cleanly. Never leave files, code, or skills half-written due to token exhaustion.
---

# Token Awareness

Apply EVERY response. No exceptions.

## Self-check before any reply

Ask 3 questions silently:
1. How much context have I used? (estimate: short = <40%, medium = 40-70%, high = >70%)
2. Will this task likely finish in current budget?
3. If interrupted mid-task, will user lose work?

## Thresholds

- **<60%**: proceed normally
- **60-75%**: finish current task, then warn user
- **>75%**: STOP before starting new task. Warn first.
- **>85%**: Refuse new work. Only save/handoff allowed.

## Warn format (short, one block)

⚠️ Token check: ~XX% used
- Current task: [name]
- Estimated to finish: [low/med/high risk]
- Recommend: [continue / save+handoff now / stop here]

## Hard rules

1. **Never start writing a file/skill/script if budget might not cover it.**
   If unsure → tell user, ask to split or defer.

2. **Never leave artifacts half-done.**
   Better: stop before starting. Worst: half a SKILL.md or broken code.

3. **Pre-commit checkpoint at >70%.**
   Suggest: "Save current work to disk + commit + handoff now."

4. **Save-first ordering when low.**
   Priority: (1) commit pending work → (2) update sprint-progress.md → (3) /handoff → (4) reply.
   Skip ornamental output (tables, recaps) to save room.

5. **Chat-side AI (architect): keep replies short when user signals low budget.**
   No long explanations. No big tables. Direct answers + one action.

## When user says "token เหลือน้อย" / "ใกล้หมด" / "save"

Switch to terse mode immediately:
- Stop all elaboration
- Confirm: "Saving + handoff. Anything else critical first?"
- Execute save → handoff → done

## When Claude Code receives task from chat

Before executing:
- Estimate output size (files, lines, commands)
- If task large + budget unclear → ask user to confirm: "This will write ~N files (~M lines). OK to proceed?"

## Integration with handoff skill

If budget <25% remaining → suggest /handoff immediately, regardless of task state.
Better to handoff a partial task than fail mid-write.

## What this skill is NOT

- Not a hard cutoff (model can't see exact tokens)
- Not an excuse to refuse work prematurely (<60% = proceed)
- Not a substitute for /handoff (use both)
