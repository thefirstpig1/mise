# Interface Design for Testability

Good interfaces make testing natural:

## 1. Accept dependencies, don't create them

```typescript
// Testable
function processOrder(order, paymentGateway) {}

// Hard to test
function processOrder(order) {
  const gateway = new StripeGateway();
}
```

## 2. Return results, don't produce side effects

```typescript
// Testable
function calculateDiscount(cart): Discount {}

// Hard to test
function applyDiscount(cart): void {
  cart.total -= discount;
}
```

## 3. Small surface area
- Fewer methods = fewer tests needed
- Fewer params = simpler test setup

## Mise-specific: Server Actions

Server Actions in Next.js are challenging for testability because they're often co-located with UI and use auth() implicitly.

Pattern that works:

```typescript
// Pure business logic — easy to test
export async function createSupplierLogic(
  tenantId: string,
  input: SupplierInput
) {
  return withTenantContext(tenantId, (tx) =>
    tx.supplier.create({ data: { ...input, tenantId } })
  );
}

// Server Action wrapper — thin, hard to test
export async function createSupplier(formData: FormData) {
  "use server";
  const { tenant } = await requireTenant();
  const input = parseFormData(formData);
  return createSupplierLogic(tenant.id, input);
}
```

Test `createSupplierLogic` directly. The Server Action wrapper is glue code — verify via E2E if needed.
