---
name: management-talk
description: Rewrite engineer-to-engineer content for engineering-org leadership (VPs, directors, PMs, release managers, execs in an engineering-savvy company) and shape it for the channel it is going to — JIRA comment, Slack post, async standup line, email, or meeting talking-points. Trigger when the user asks to write/rewrite for management / exec / VP / director / PM / release manager, asks for an "executive summary / leadership update / status update", says "make this less technical / less jargony", or asks for a slack / email / standup / meeting version of work originally written engineer-to-engineer.
---

# Management Talk

_Source: github.com/9arm/skills (productivity bucket)._

Same audience and translation rules as a written status report, but **shaped for the channel** — JIRA comment, Slack post, async standup, email, or meeting talking-points. The audience reads code names but not code. The channel decides the length, formatting, and how much structure to leave on the page.

Use this any time engineering content needs to flow up the org, sideways into product/release, or into a non-engineering meeting — regardless of the destination.

## When to invoke

- "write something for management / exec / VP / director / PM / release manager"
- "rewrite this for [non-eng audience]"
- "make this non-technical" / "less techy" / "less jargony"
- "send a slack update / standup note / email" *about a piece of engineering work*
- "executive summary" / "exec summary" / "leadership update" / "status update"
- "talking points for [meeting]" *based on an engineering update*

If the channel is unclear after the trigger, ask one short question — *"JIRA, Slack, standup, or email?"* — and stop.

## Audience — what "engineering-org leadership" means

Engineering-savvy non-engineers: VPs, directors, PMs, release managers, execs in companies that ship technical products. They read product/framework names and cross-reference JIRA keys and PRs. They do not read code.

They want: *what's the state, what does it mean for customers, who owns it, what's next.* They do not want: how the bug works at the function level.

This is **not** for marketing, finance, customer-facing, or true ELI5 audiences — those need a different rewrite. Flag and confirm before producing one.

## Tone

**Keep.** Product names, framework names, team-owned component names, JIRA keys, PR numbers, customer/workload identifiers. These are the bridge between engineering and leadership tracking.

**Strip.** Function names, file paths, struct fields, commit SHAs, code expressions, env var names, line numbers, internal data-structure jargon. None of this is actionable to the audience.

**Translate.** Mechanism into one or two sentences of plain-English cause-and-effect. Translate without lying — a race stays a race; a regression stays a regression.

**Don't over-strip.** Engineering-org leadership reads concept-level technical vocabulary fluently — race condition, synchronization, uninitialized buffer, fast-path, workaround, registration, queue, driver, kernel. The line is between *concept exists and matters here* (keep) and *here's the function/struct/file/SHA* (strip). Replacing "race" with "timing issue" patronizes the reader.

**Bias toward** active voice, concrete subjects, short paragraphs.

**Avoid:**
- Hedging that isn't really hedging ("we believe," "appears to," "may have"). State it or don't.
- Re-stating the obvious for thoroughness.
- Telling leadership how to do their job ("you should prioritize," "this needs to land before X"). Give them the facts; they decide.
- Engineering-process minutiae: bisect runs, debug iterations, GDB sessions. They care that you found it, not how.

## Channel shapes

Same content, different shell. Pick the shape that matches where it's going.

### JIRA comment / written status report

Full structured block. Bolded section labels. Easy to scan from the ticket page.

Building blocks (use as many as fit):
- **Status / TL;DR.** One bolded line. Reader can stop here and have the right answer.
- **Impact.** Who's affected, how badly, what they see. Customer / workload / product terms.
- **What broke.** Short paragraph. Plain-English mechanism, one level of why, no code identifiers.
- **Why now / how it slipped through.** Optional. Include when leadership will ask anyway.
- **Owner.** Person + team + their PR/branch/JIRA artifact. One link, not five.
- **Next steps.** Concrete, near-term, ordered.
- **Workaround / mitigation.** If customers are hitting it now, what can they do today? One sentence.
- **Risk.** Optional. Real risks only. Don't manufacture risk to look thorough.

Order by what matters most for *this* item.

### Slack — channel post or DM

Single message, no walls of text. Heavy bolded section labels read as "I escaped from JIRA" — don't.

- One **bolded TL;DR** as the first line.
- 2–4 short bullets underneath: impact, owner+link, next step. Drop blocks that don't apply.
- One link, embedded inline. Not a link wall.
- No greeting, no signoff. The channel is the context.
- If it's a **thread reply** rather than a new post, lose the TL;DR — just lead with the answer.

Length target: under ~80 words for a top-level post; under ~40 for a thread reply.

### Async standup note

The audience scans 10 of these in 30 seconds. Front-load the verb.

- 1–3 lines, max.
- Pattern: *"<state> <thing>. <owner if not me>. <next>."*
- No bullets, no bolded labels. The format **is** the sentence.

### Email — internal exec / cross-team

Subject line is half the value.

- **Subject:** the TL;DR rewritten as a noun phrase.
- **Greeting:** match the recipient register (*Hi Sam,* / *Hi all,*).
- **Body:** the JIRA-comment shape, but as flowing paragraphs separated by blank lines rather than bolded section labels. Two or three paragraphs is plenty.
- **Sign off** with the next decision point that needs the recipient's attention, if any.

### Meeting talking-points

You're going to *say* this, not show it.

- Bullet list, max one short clause per bullet.
- Order is the order you'll speak in.
- Include the numbers/keys you want to reference out loud, in the bullet itself.
- Skip prose.

## Source material

The input is one of:
1. **A ticket key** → fetch the ticket; the most recent substantive comment is what to reframe.
2. **Pasted technical text** → use directly.
3. **The current conversation** → if engineering content was just produced and user says "now in slack" / "now for the VP," reuse context.

If the source is ambiguous, ask one question and stop.

## Output flow

1. **Confirm the channel** if it's not stated.
2. **Produce the draft** as a single chat block, formatted as the channel would render it.
3. **Print-only by default** — the user copies it. Never auto-post to Slack, email, or any channel.
4. **One iteration is normal, three is a smell.** If on the third revision, ask what framing/audience assumption is missing.

## Mise-specific adaptation

Mise context (Thai restaurant SaaS, small team forming):
- "Leadership" for Mise = founders, investors, future non-eng team members, advisors.
- Keep: Mise feature names (Menu Lab, Price Volatility), Sprint numbers, "RLS", "tenant".
- Strip: Prisma model names, function names, file paths, migration hashes.
- Thai option: leadership updates may be requested in Thai — translate plain-English mechanism into Thai, keep technical product nouns. Ask channel + language if unclear.
- Channels likely for Mise: Slack/LINE post, async standup, email to advisor/investor.
- No JIRA in Mise currently — when "to-issues" or a tracker is adopted, JIRA-comment shape applies to that tracker.

## Rules

- **Never invent facts** to make the rewrite cleaner.
- **Never strip a ticket key, PR number, or feature/workload name** during de-jargoning.
- **Never invent owners.** If the source doesn't name one, ask the user.
- **Print-only output** needs no approval; never post to any channel from this skill.
- **Stay out of advocacy.** This skill produces a status update, not a recommendation. If the user wants a recommendation memo, confirm before reframing.
