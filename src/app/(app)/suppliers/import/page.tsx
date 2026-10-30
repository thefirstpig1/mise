// /suppliers/import — นำเข้าบิลซื้อย้อนหลัง (คิวงานข้อ 5c, Kong 2026-10-30,
// mockup https://claude.ai/artifact/YFU35adTUBXVQ6PPppFcHP round 2). Keeps the
// suppliers, who sells what, and the price on each date — no stock, no expense.
// The prompt carries the shop's ingredient names so its AI can match a bill's
// wording to them.

import Link from "next/link";
import { requireTenant } from "@/lib/require-tenant";
import { buildBillImportPrompt } from "@/lib/bill-import";
import { getBillPromptNamesLogic } from "@/server/bill-import";
import ImportGuide from "@/components/import/ImportGuide";
import BillImport from "./_components/BillImport";

export default async function BillImportPage() {
  const { tenantId } = await requireTenant("master:write");
  const names = await getBillPromptNamesLogic(tenantId);
  const prompt = buildBillImportPrompt(names);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-subtle">
            <Link href="/suppliers" className="hover:text-foreground">
              ผู้ขาย
            </Link>{" "}
            › นำเข้าบิลซื้อย้อนหลัง
          </p>
          <h2 className="text-2xl font-semibold">นำเข้าบิลซื้อย้อนหลัง</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            เก็บผู้ขายและราคาจากบิลเก่า <b className="font-medium text-foreground">ไม่ลงสต๊อก ไม่ลงค่าใช้จ่าย</b> · บันทึกเมื่อกดปุ่มบันทึกเท่านั้น
          </p>
        </div>
        <ImportGuide prompt={prompt} kind="bills" />
      </div>
      <BillImport prompt={prompt} productCount={names.length} />
    </div>
  );
}
