// /sales/import/profiles/new — teach Mise one POS file shape, for one branch.
//
// Round 2 of the friend's-shop feedback (Kong 2026-11-01, mockup
// 225p68BDqKAZTpd9MqDeph): the old page was two forms — a POS form that saved
// the moment a brand was picked, then a long builder with thirteen dropdowns
// over a raw table. It is now one wizard of five pages with Back on each, and
// nothing is written until its last page (FirstImportWizard).
//
// `?branch=` opens it on that branch: each branch keeps its own POS and its own
// formats, because a shop's branches need not run the same brand (Kong: "ร้าน
// เดียวกัน ต่างสาขาอาจจะใช้ POS ไม่เหมือนกันได้"). A branch id outside the
// reader's reach is ignored, never trusted (rule A5).

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getPosIntegrationsLogic } from "@/server/menu";
import PageHeader from "@/components/ui/PageHeader";
import FirstImportWizard, { type WizardBranch } from "./_components/FirstImportWizard";

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export default async function NewProfilePage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const [{ tenantId, reach, membership }, sp] = await Promise.all([requireTenant("sales:import"), searchParams]);
  const [integrations, branches] = await Promise.all([getPosIntegrationsLogic(tenantId), getBranchesLogic(tenantId, reach)]);

  const list: WizardBranch[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
    cutoff: hhmm(b.salesDayCutoffMinutes),
    pos: integrations.filter((i) => i.branchId === b.id).map((i) => ({ id: i.id, name: i.name, formats: i.profiles.length })),
  }));
  const initial = list.find((b) => b.id === sp.branch)?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ตั้ง POS และรูปแบบไฟล์"
        description="ทำครั้งเดียวต่อรูปแบบไฟล์ ครั้งต่อไปอัปไฟล์หน้าตาเดิม ระบบอ่านเองไม่ถามอีก"
        actions={
          <a href="/sales/import" className="btn-secondary">
            ‹ หน้านำเข้ายอดขาย
          </a>
        }
      />
      <FirstImportWizard key={initial ?? "none"} branches={list} initialBranchId={initial} shopVatRegistered={membership.tenant.isVatRegistered} />
    </div>
  );
}
