# Good and Bad Tests

## Good Tests

**Integration-style**: Test through real interfaces, not mocks of internal parts.

```typescript
// GOOD: Tests observable behavior
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

Characteristics:
- Tests behavior users/callers care about
- Uses public API only
- Survives internal refactors
- Describes WHAT, not HOW
- One logical assertion per test

## Bad Tests

**Implementation-detail tests**: Coupled to internal structure.

```typescript
// BAD: Tests implementation details
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

Red flags:
- Mocking internal collaborators
- Testing private methods
- Asserting on call counts/order
- Test breaks when refactoring without behavior change
- Test name describes HOW not WHAT

```typescript
// BAD: Bypasses interface to verify
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});

// GOOD: Verifies through interface
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

## Mise-specific examples

```typescript
// GOOD: tenant isolation via public interface
test("Tenant B cannot read Tenant A's supplier", async () => {
  const supplierA = await withTenantContext(tenantAId, () =>
    createSupplier({ nameFull: "A's Supplier" })
  );

  const result = await withTenantContext(tenantBId, () =>
    getSupplier(supplierA.id)
  );

  expect(result).toBeNull(); // RLS blocks access
});

// BAD: tests RLS via direct SQL (implementation detail)
test("RLS policy exists on supplier table", async () => {
  const policies = await db.$queryRaw`SELECT * FROM pg_policies WHERE tablename = 'supplier'`;
  expect(policies.length).toBeGreaterThan(0);
});
```

The bad test passes even if the policy is broken. The good test fails if the policy doesn't actually work.
