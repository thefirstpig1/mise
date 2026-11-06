// ADR 0045 part B — คำขอข้อมูล: a shop asking for its data back or to be
// deleted, or a person asking about their own record. Each has 30 days
// (terms §10, privacy §8), and an open one sits in ต้องทำ with its due date.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { listDataRequestsLogic, listShopsLogic } from "@/server/platform";
import RequestsView from "../_components/RequestsView";

export default async function PlatformRequestsPage({ searchParams }: { searchParams: Promise<{ shop?: string; kind?: string }> }) {
  const actor = await requirePlatformAdmin();
  const [sp, requests, shops] = await Promise.all([searchParams, listDataRequestsLogic(actor), listShopsLogic(actor)]);
  return (
    <RequestsView
      requests={requests}
      shops={shops.map((s) => ({ id: s.id, name: s.name, owners: s.owners }))}
      today={computeBangkokToday().toISOString().slice(0, 10)}
      preset={{ shopId: sp.shop ?? null, kind: sp.kind === "export" || sp.kind === "delete" || sp.kind === "personal" ? sp.kind : null }}
    />
  );
}
