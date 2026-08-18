// Sprint 3 Part 18 L5a — /transfers/new: send stock to another branch.
//
// Server Component that hands the form its options. `?from=` preselects the
// sending branch so a link from /stock lands on the shelf the user was looking
// at — the same courtesy Part 17 gave /stock-counts/new with `?branch=`.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getProductsLogic } from "@/server/product";
import { dispatchTransferAction } from "../actions";
import TransferDispatchForm, {
  type TransferBranchOption,
  type TransferProductOption,
} from "../_components/TransferDispatchForm";

/**
 * "Now" as a `datetime-local` value in Bangkok.
 *
 * The zod window is checked against BANGKOK today (Decision #60), so a device in
 * another timezone offered its own local clock would be handed an instant the
 * server rejects — and the message would be about a date the user can see is
 * fine on their own screen.
 */
function nowBangkokLocalValue(): string {
  const now = new Date();
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 16);
}

export default async function NewTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;

  const [products, branches] = await Promise.all([
    getProductsLogic(tenantId),
    getBranchesLogic(tenantId),
  ]);

  if (branches.length < 2) {
    return (
      <div className="space-y-4">
        <a href="/transfers" className="text-sm text-muted-foreground hover:underline">
          ← กลับรายการใบโอน
        </a>
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
          การโอนต้องมีอย่างน้อย 2 สาขา — ตอนนี้ระบบมี {branches.length} สาขา
          <br />
          <a href="/settings" className="mt-2 inline-block underline">
            เพิ่มสาขาในหน้าตั้งค่า
          </a>
        </div>
      </div>
    );
  }

  // getProductsLogic orders by the category tree (built for the product page);
  // a picker reads better by name.
  const productOptions: TransferProductOption[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      baseUnitName: p.productUnits.find((u) => u.isBase)?.unitName ?? null,
      units: p.productUnits
        .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase }))
        // Base unit first — the unit stock is kept in.
        .sort((a, b) => Number(b.isBase) - Number(a.isBase)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  // The sending branch from the link, if it is a real one — an unknown id falls
  // back to the first branch rather than erroring.
  const ordered: TransferBranchOption[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
  }));
  const preferred = ordered.find((b) => b.id === sp.from);
  const branchOptions = preferred
    ? [preferred, ...ordered.filter((b) => b.id !== preferred.id)]
    : ordered;

  return (
    <div className="space-y-6">
      <a href="/transfers" className="text-sm text-muted-foreground hover:underline">
        ← กลับรายการใบโอน
      </a>
      <h2 className="text-xl font-bold">สร้างใบโอน</h2>

      <TransferDispatchForm
        action={dispatchTransferAction}
        products={productOptions}
        branches={branchOptions}
        nowBangkok={nowBangkokLocalValue()}
      />
    </div>
  );
}
