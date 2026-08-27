// ============================================================
// Mise — menu merging view serializers (Sprint 5 Part 25 L4, ADR 0026)
// ============================================================
// Two shapes on their way to a Client Component: a merge, and a candidate to
// make one from. No `Prisma.Decimal` crosses this boundary because no money
// reaches this Part at all (Pitfall #20 is satisfied by there being nothing to
// satisfy it with), and every date leaves as ISO plus a Bangkok label rendered
// HERE.
//
// The words are load-bearing, which is why they are in one file:
//
//   * **A menu is never called "ถูกลบ" or "ยุบแล้ว".** Nothing vanishes. The
//     losing row stays alive, keeps its POS code and goes on collecting sales
//     every day (Q1), so a screen that implied otherwise would send a shop
//     looking for a row that is still there — and, worse, teach it to soft-
//     delete one, which breaks the next import (Context 3+4).
//   * **The two roles are named, not numbered.** "เมนูหลัก" is the dish;
//     "ชื่อที่รวมแล้ว" is the spelling. A row that said only "A → B" would leave
//     the direction to be guessed, and the direction is the whole decision.
//   * **`similarityBadge` is reused, never a raw score.** ADR 0010's rule for
//     products and ADR 0019 Q7's for menus: a person judges names, not numbers.
// ============================================================

import { similarityBadge } from "@/app/sales/_components/sales-view";
import type {
  MenuMergeWithMenus,
  MergeCandidate,
  MergeSubject,
} from "@/server/menu-merge-read";

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const BANGKOK_DATETIME = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const MERGE_WINNER_ROLE_TH = "เมนูหลัก";
export const MERGE_LOSER_ROLE_TH = "ชื่อที่รวมแล้ว";

// ------------------------------------------------------------
// One end of a merge
// ------------------------------------------------------------

export type MergeMenuView = {
  id: string;
  name: string;
  /** "ข้าวผัดกุ้ง (POS: ขผกุ้ง)" — both names, because the difference between
   *  them is exactly what a person is being asked to judge. */
  label: string;
  /** "สาขาอโศก" or "สร้างในระบบ" — for a multi-branch shop this is the reason
   *  the duplicate exists at all (Q7). */
  originLabel: string;
  posMenuCode: string | null;
  isPosStub: boolean;
};

type MenuEnd = {
  id: string;
  name: string;
  posMenuName: string | null;
  posMenuId: string | null;
  isPosStub: boolean;
  posIntegration: { branch: { name: string } } | null;
};

const MISE_ORIGIN = "สร้างในระบบ";
const UNKNOWN_ORIGIN = "ไม่ทราบที่มา";

function menuLabel(name: string, posMenuName: string | null): string {
  return posMenuName && posMenuName !== name
    ? `${name} (POS: ${posMenuName})`
    : name;
}

function toMergeMenuView(m: MenuEnd): MergeMenuView {
  return {
    id: m.id,
    name: m.name,
    label: menuLabel(m.name, m.posMenuName),
    originLabel:
      m.posIntegration?.branch.name ?? (m.posMenuId === null ? MISE_ORIGIN : UNKNOWN_ORIGIN),
    posMenuCode: m.posMenuId,
    isPosStub: m.isPosStub,
  };
}

// ------------------------------------------------------------
// A merge
// ------------------------------------------------------------

export type MenuMergeRowView = {
  id: string;
  winner: MergeMenuView;
  loser: MergeMenuView;
  /** ISO date for a form; `effectiveFromLabel` for a human. */
  effectiveFrom: string;
  effectiveFromLabel: string;
  isRevoked: boolean;
  revokedAtLabel: string | null;
  /** "ใช้งานอยู่" / "ยกเลิกเมื่อ …" — never "ลบแล้ว". The row is never deleted. */
  statusLabel: string;
  /**
   * The one sentence this row must not be read without: reporting has folded
   * everything already, stock only from the effective date. Q5 in the place a
   * person actually looks.
   */
  scopeLabel: string;
};

const ACTIVE_STATUS = "ใช้งานอยู่";

export function toMenuMergeRowView(m: MenuMergeWithMenus): MenuMergeRowView {
  const effectiveLabel = BANGKOK_DATE.format(m.effectiveFrom);
  return {
    id: m.id,
    winner: toMergeMenuView(m.winningMenu),
    loser: toMergeMenuView(m.losingMenu),
    effectiveFrom: m.effectiveFrom.toISOString().slice(0, 10),
    effectiveFromLabel: effectiveLabel,
    isRevoked: m.revokedAt !== null,
    revokedAtLabel: m.revokedAt === null ? null : BANGKOK_DATETIME.format(m.revokedAt),
    statusLabel:
      m.revokedAt === null
        ? ACTIVE_STATUS
        : `ยกเลิกเมื่อ ${BANGKOK_DATETIME.format(m.revokedAt)}`,
    scopeLabel:
      m.revokedAt === null
        ? `รายงานรวมย้อนหลังทั้งหมด · ตัดสต๊อกรวมตั้งแต่ ${effectiveLabel}`
        : "ไม่มีผลแล้ว — ทั้งรายงานและการตัดสต๊อกแยกกันตามเดิม",
  };
}

/**
 * The spellings folded into one dish, for the menu screen's collapsed rows (Q6).
 *
 * Keyed by the WINNER, which is the row that stays visible. The losers are
 * nested beneath it — not hidden, because a row that still collects money every
 * day must not disappear, and not listed as equals, because that would give back
 * the duplicate the shop just merged away.
 */
export function groupMergesByWinner(
  merges: readonly MenuMergeRowView[]
): Map<string, MenuMergeRowView[]> {
  const out = new Map<string, MenuMergeRowView[]>();
  for (const m of merges) {
    if (m.isRevoked) continue;
    const list = out.get(m.winner.id);
    if (list === undefined) out.set(m.winner.id, [m]);
    else list.push(m);
  }
  return out;
}

/** "+2 ชื่อที่รวมแล้ว" — the collapsed row's own label (Q6). */
export function mergedSpellingsLabel(count: number): string {
  return `+${count} ${MERGE_LOSER_ROLE_TH}`;
}

// ------------------------------------------------------------
// A candidate
// ------------------------------------------------------------

export type MergeCandidateRowView = {
  id: string;
  name: string;
  label: string;
  originLabel: string;
  isPosStub: boolean;
  /** "ตรงกันมาก" / "ใกล้เคียง" / "อาจเกี่ยวข้อง". Never the number. */
  badge: string;
  /**
   * Why this row may not be the one folded away, in Thai — `null` when it may.
   * `mergeMenusLogic` refuses the same two cases; this is so the screen does not
   * wait for a round trip to say what it already knows.
   */
  blockedAsLoserReason: string | null;
  /** Why it may not be the dish kept, in Thai — `null` when it may. */
  blockedAsWinnerReason: string | null;
};

const ALREADY_MERGED_AS_LOSER =
  "รวมเข้ากับเมนูอื่นอยู่แล้ว — ต้องยกเลิกการรวมเดิมก่อน";
const ALREADY_A_WINNER =
  "เป็นเมนูหลักของชื่ออื่นอยู่แล้ว จึงถูกรวมเข้ากับเมนูอื่นไม่ได้";
const ALREADY_MERGED_AS_WINNER =
  "เมนูนี้เป็นชื่อที่รวมเข้ากับเมนูอื่นแล้ว จึงเป็นเมนูหลักไม่ได้";

function blockedAsLoser(c: MergeSubject): string | null {
  if (c.mergedIntoMenuId !== null) return ALREADY_MERGED_AS_LOSER;
  if (c.spellingCount > 0) return ALREADY_A_WINNER;
  return null;
}

/** A star may grow; a chain may not. Only the loser side blocks a winner. */
function blockedAsWinner(c: MergeSubject): string | null {
  return c.mergedIntoMenuId === null ? null : ALREADY_MERGED_AS_WINNER;
}

export function toMergeCandidateRowView(c: MergeCandidate): MergeCandidateRowView {
  return {
    id: c.id,
    name: c.name,
    label: menuLabel(c.name, c.posMenuName),
    originLabel:
      c.branchName ?? (c.posMenuCode === null ? MISE_ORIGIN : UNKNOWN_ORIGIN),
    isPosStub: c.isPosStub,
    badge: similarityBadge(c.score),
    blockedAsLoserReason: blockedAsLoser(c),
    blockedAsWinnerReason: blockedAsWinner(c),
  };
}

export type MergeSubjectView = Omit<MergeCandidateRowView, "badge">;

export function toMergeSubjectView(s: MergeSubject): MergeSubjectView {
  return {
    id: s.id,
    name: s.name,
    label: menuLabel(s.name, s.posMenuName),
    originLabel:
      s.branchName ?? (s.posMenuCode === null ? MISE_ORIGIN : UNKNOWN_ORIGIN),
    isPosStub: s.isPosStub,
    blockedAsLoserReason: blockedAsLoser(s),
    blockedAsWinnerReason: blockedAsWinner(s),
  };
}
