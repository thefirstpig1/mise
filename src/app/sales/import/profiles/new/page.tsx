// Sprint 4 Part 19 L5 — /sales/import/profiles/new: teach Mise one file shape.
//
// Server Component; the builder itself is a client form because it reads a file
// in the browser and maps columns against what it finds.
//
// A shop with no POS registered yet cannot map anything, so the page offers that
// step first rather than showing an empty dropdown. Registering a POS asks for
// three things and NO credentials — there is nothing to connect to (ADR 0019
// Q2), the POS entry exists to say which branch a file belongs to and to give
// its menus a namespace.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getPosIntegrationsLogic } from "@/server/menu";
import { POS_TYPE_VALUES } from "@/lib/validations/sales-import";
import NewPosForm from "./_components/NewPosForm";
import ProfileBuilder, { type PosOption } from "./_components/ProfileBuilder";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

const POS_TYPE_LABELS: Record<string, string> = {
  FOODSTORY: "FoodStory",
  WONGNAI: "Wongnai POS",
  OCHA: "Ocha",
  STOREHUB: "StoreHub",
  LOYVERSE: "Loyverse",
  CUSTOM: "อื่น ๆ / ไม่ระบุ",
};

export default async function NewProfilePage() {
  const { tenantId } = await requireTenant();
  const [integrations, branches] = await Promise.all([
    getPosIntegrationsLogic(tenantId),
    getBranchesLogic(tenantId),
  ]);

  if (integrations.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-base font-bold">ลงทะเบียนเครื่อง POS ก่อน</h2>
        <p className="text-sm text-muted-foreground">
          บอกระบบว่าไฟล์ยอดขายมาจากสาขาไหน — ไม่ต้องกรอกรหัสผ่านหรือเชื่อมต่ออะไรทั้งสิ้น
          Mise ไม่เคยเข้าไปแตะ POS ของคุณ
        </p>
        <NewPosForm branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
      </div>
    );
  }

  const posOptions: PosOption[] = integrations.map((i) => ({
    id: i.id,
    label: `${i.branch.name} · ${i.name}`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold">ตั้งค่ารูปแบบไฟล์</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ทำครั้งเดียวต่อรูปแบบไฟล์หนึ่งแบบ — ครั้งต่อไปอัปไฟล์หน้าตาเดิม ระบบอ่านเองไม่ถามอะไรอีก
        </p>
      </div>
      <ProfileBuilder posOptions={posOptions} />
    </div>
  );
}
