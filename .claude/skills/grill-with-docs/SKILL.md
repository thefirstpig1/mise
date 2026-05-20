---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against the project's language and documented decisions, or invokes /grill-with-docs.
---

<what-to-do>

Interview the user relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

</what-to-do>

<supporting-info>

## Mise-specific context

For Mise project, key references:
- CONTEXT.md (root) — domain glossary, sharpens language
- docs/adr/ — Architecture Decision Records
- docs/master-spec-summary.md — Master Spec v1.4 quick ref
- docs/changelog-v5-summary.md — 60 locked decisions
- docs/sprint-progress.md — current sprint state

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with CONTEXT.md, call it out immediately. "Your glossary defines 'Yield' as output/input ratio, but you seem to mean loss percent — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'product' — do you mean RAW or PREPPED? Those are different things in Mise."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Examples for Mise:
- "What happens if supplier has VAT but tenant is not VAT registered?"
- "If GR receives less than PO, how does the system handle the shortage?"
- "If a PREPPED product's yield changes mid-month, what happens to existing recipes?"

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your CLAUDE.md says User uses cuid, but the new schema has User with @db.Uuid — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update CONTEXT.md right there. Don't batch these up — capture them as they happen. Use the format in CONTEXT-FORMAT.md.

CONTEXT.md should be totally devoid of implementation details. Do not treat CONTEXT.md as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in ADR-FORMAT.md.

## When to invoke (Mise-specific)

- Before starting a new sprint (Sprint 2 onward)
- Before implementing a feature with multiple design choices
- When user says "/grill-with-docs" or "grill me with docs"
- When user expresses uncertainty about a design ("I'm not sure if...", "What if we...")
- After significant changes to schema or business logic

</supporting-info>
