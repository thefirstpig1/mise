// ============================================================
// คิดครัว — the announcement strip every shop sees (ADR 0045 part B)
// ============================================================
// Read by the app's own role: platform_announcement's only policy for it is
// SELECT (Q9). Kept for a minute per server, because every page of every shop
// asks; setting or stopping one in the control page drops the copy at once.
// ============================================================

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

export const ANNOUNCEMENT_TAG = "platform-announcements";

export type LiveAnnouncement = { id: string; message: string; tone: "info" | "important"; endsAt: string };

/** Live now and not stopped — at most three, most recent first. Never throws: no strip beats a broken page. */
export const getLiveAnnouncements = unstable_cache(
  async (): Promise<LiveAnnouncement[]> => {
    try {
      const now = new Date();
      const rows = await prisma.platformAnnouncement.findMany({
        where: { stoppedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: { startsAt: "desc" },
        take: 3,
        select: { id: true, message: true, tone: true, endsAt: true },
      });
      return rows.map((r) => ({ id: r.id, message: r.message, tone: r.tone === "important" ? "important" : "info", endsAt: r.endsAt.toISOString() }));
    } catch (e) {
      console.error("[announcements] read failed", e);
      return [];
    }
  },
  ["platform-announcements-live"],
  { revalidate: 60, tags: [ANNOUNCEMENT_TAG] }
);
