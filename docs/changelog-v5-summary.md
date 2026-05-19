# Changelog v5 — Decision Summary

**Full version:** Google Drive ID 1uWxAg2dU7RnyQfHhK5KjLW3L0B3uCuXtsPigeuHCOqg

## v1.4 Decisions (May 15, 2026) — Functional Correctness Patch

- #54: Cost cascade strategy = mark stale + recompute on read
- #55: Tenant isolation via PostgreSQL RLS
- #56: GR excess receipt = flag for manager review
- #57: Unknown POS menu = auto-create stub
- #58: Recipe recursion depth limit = 5
- #59: Yield math formula = qty × (100/yield_percent)
- #60: All DATE_TRUNC uses tenant timezone

## v1.3 Decisions (May 11, 2026) — Implementation Specs (H.1-H.8)
- #46-53: Implementation patterns for tenant init, triggers, RLS, etc.

## v1.2 Decisions (May 11, 2026) — Tax + Dept Opt-in
- #34-45: VAT, WHT, dept opt-in, revenue attribution

## v1.0-v1.1 Decisions
- #1-33: Foundation decisions (branching, sync, cost confidence, units, etc.)

For full context on any decision, search Google Drive: "Mise Changelog & Decision History v5"
