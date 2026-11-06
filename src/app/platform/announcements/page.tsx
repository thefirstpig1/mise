// ADR 0045 part B — ประกาศ: a strip at the top of every page of every shop,
// between two moments (mockup Q7BabbD2jHMDtdqEYxLmUR §3). Before charging, or
// changing the terms, the 30 days' notice goes here as well as by e-mail.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { listAnnouncementsLogic } from "@/server/platform";
import AnnouncementsView from "../_components/AnnouncementsView";

export default async function PlatformAnnouncementsPage() {
  const actor = await requirePlatformAdmin();
  return <AnnouncementsView items={await listAnnouncementsLogic(actor)} />;
}
