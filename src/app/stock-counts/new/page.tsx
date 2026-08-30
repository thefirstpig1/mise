// Sprint 3 Part 15 L5a — open a new count sheet.
//
// Deliberately small: opening a sheet is three decisions (which branch, which
// date it is called, and whether the counter sees the expected figure), and the
// counting itself happens on the sheet.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getOpenStockCountLogic } from "@/server/stock-count";
import { computeBangkokToday } from "@/lib/bangkok-date";
import OpenCountForm from "../_components/OpenCountForm";
import { openStockCountAction } from "../actions";

// `?branch=<id>` is honoured (Part 17 L5b): the below-par list links here for a
// specific branch, and a link that silently ignored which branch it named would
// send the counter to the wrong shelf. `searchParams` is a PROMISE in Next 15 —
// the plain-object signature type-checks under tsc and fails `next build`.
export default async function NewStockCountPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenantId } = await requireTenant("count:write");
  const [branches, { branch: branchParam }] = await Promise.all([
    getBranchesLogic(tenantId),
    searchParams,
  ]);

  if (branches.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
        ยังไม่มีสาขาในระบบ
      </div>
    );
  }

  // Which branches are already counting — surfaced BEFORE the user picks one,
  // so "this branch already has an open sheet" is not a surprise on submit (Q8).
  const openByBranch: Record<string, string> = {};
  for (const b of branches) {
    const open = await getOpenStockCountLogic(tenantId, b.id);
    if (open) openByBranch[b.id] = open.id;
  }

  // Bangkok today, computed on the SERVER: a device in another timezone would
  // otherwise default the sheet to a date the shop does not think it is.
  const todayBangkok = computeBangkokToday().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <a
          href="/stock-counts"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายการใบนับ
        </a>
        <h2 className="mt-1 text-xl font-bold">เปิดใบนับใหม่</h2>
      </div>

      <OpenCountForm
        action={openStockCountAction}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        openByBranch={openByBranch}
        todayBangkok={todayBangkok}
        // An unknown or foreign id falls through to the form's own default
        // rather than erroring — the id never reaches a query unvalidated.
        preselectBranchId={
          branches.some((b) => b.id === branchParam) ? branchParam : undefined
        }
      />
    </div>
  );
}
