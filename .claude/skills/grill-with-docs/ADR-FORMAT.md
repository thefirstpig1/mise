# ADR Format

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

Create the `docs/adr/` directory lazily — only when the first ADR is needed.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording *that* a decision was made and *why* — not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions are revisited
- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Numbering

Scan `docs/adr/` for the highest existing number and increment by one.

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it — you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies (for Mise)

- **Architectural shape.** "Multi-tenant via RLS, not separate databases." "Server Components by default."
- **Integration patterns.** "POS sync via diff-and-resolve, not webhooks."
- **Technology lock-in.** Database (Postgres on Neon), Auth.js v5, Prisma ORM. Not every library — just things that take a quarter to swap.
- **Boundary decisions.** "Recipe data owned by Recipe context; other contexts reference by ID."
- **Deliberate deviations.** "Using cuid for User (Auth.js requirement) but uuid for everything else."
- **Constraints not visible in code.** "Thai SME pricing model: max ฿2000/month."
- **Rejected alternatives non-obvious.** "Considered GraphQL, chose REST/Server Actions because..."

## ADRs that should already exist (backfill candidates)

These are decisions Mise made implicitly that might deserve ADRs:
- Multi-tenant via RLS (vs separate DBs) — Decision #55
- User.id cuid vs uuid — discovered during Sprint 0
- Cost cascade strategy — Decision #54
- Yield math formula — Decision #59
- Neon pooled + direct URLs — Pitfall #18

Don't backfill all at once. Create ADRs as decisions come up in grilling sessions.
