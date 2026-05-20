---
name: tdd
description: Test-driven development with red-green-refactor loop using vertical slices (tracer bullets). Use when user wants to build features or fix bugs using TDD, mentions "red-green-refactor", wants integration tests, or says "test first".
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means.

See [tests.md](tests.md) for examples and [interface-design.md](interface-design.md) for testability guidelines.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" — produces crap tests because they test imagined behavior, not actual.

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat.
WRONG (horizontal):
RED:   test1, test2, test3, test4, test5
GREEN: impl1, impl2, impl3, impl4, impl5
RIGHT (vertical):
RED→GREEN: test1→impl1
RED→GREEN: test2→impl2
RED→GREEN: test3→impl3

## Workflow

### 1. Planning

Use CONTEXT.md vocabulary so test names match project's domain language.
Respect ADRs in the area you're touching.

Before writing any code:
- [ ] Confirm with user what interface changes are needed
- [ ] Confirm which behaviors to test (prioritize)
- [ ] List behaviors to test (not implementation steps)
- [ ] Get user approval on plan

Ask: "What should the public interface look like? Which behaviors are most important to test?"

**You can't test everything.** Focus on critical paths and complex logic, not every edge case.

### 2. RED — Write failing test

Write ONE test that fails. Should test behavior through public interface.

For Mise:
- Use Vitest (already in package.json)
- Integration tests preferred for Server Actions + Prisma
- Always test with withTenantContext for tenant-scoped operations
- Test RLS isolation explicitly (Tenant A can't see Tenant B's data)

### 3. GREEN — Make it pass

Write minimum code to pass the test. Don't add extras.

### 4. REFACTOR — Clean up

Improve code while keeping test green. Don't add features.

### 5. Repeat

Move to next behavior. One vertical slice at a time.

## Mise-specific TDD patterns

### Testing Server Actions

```typescript
import { describe, it, expect } from 'vitest';
import { createSupplier } from '@/app/suppliers/actions';
import { withTenantContext, withAdminContext } from '@/lib/db';

describe('createSupplier', () => {
  it('creates a supplier under the user tenant', async () => {
    // Setup tenant context
    const result = await withTenantContext(testTenantId, () =>
      createSupplier({ nameFull: 'Test Supplier' })
    );
    expect(result.id).toBeDefined();
    expect(result.nameFull).toBe('Test Supplier');
  });

  it('cannot read suppliers from another tenant (RLS)', async () => {
    // RLS test pattern — defense-in-depth verification
  });
});
```

### Testing RLS

Every tenant-scoped table needs RLS test:
1. Create row as Tenant A
2. Switch context to Tenant B
3. Verify Tenant B cannot read Tenant A's row

This is HIGH-VALUE testing for Mise because RLS is critical security.

## When to invoke

- User says "/tdd" or "test first"
- Before building new feature with multiple behaviors
- When fixing a bug (write reproducing test first)
- Refactoring (existing tests must pass before AND after)
