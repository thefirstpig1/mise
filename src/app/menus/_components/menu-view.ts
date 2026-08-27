// ============================================================
// Mise — menu view serializer (Sprint 4 Part 19 L4)
// ============================================================
// Menus carry no money, so this file is mostly about one thing: making the
// "รอตรวจ" queue legible.
//
// A stub is not an error and must not read like one. It is a dish the kitchen
// started selling before anybody told Mise about it, which is ordinary — so the
// row says what is missing and what it costs the shop to leave it, rather than
// shouting. What it costs is concrete: an unidentified dish cannot be given a
// department, so its revenue sits outside the /cost matrix, and it cannot be
// given a recipe in Sprint 5, so it will never consume stock.
// ============================================================

import type { MenuListRow, MenuSuggestion } from "@/server/menu";
import { similarityBadge } from "@/app/sales/_components/sales-view";

export type MenuRowView = {
  id: string;
  name: string;
  posMenuName: string | null;
  posMenuCode: string | null;
  posName: string | null;
  menuCategoryId: string | null;
  menuCategoryName: string | null;
  primaryDepartmentId: string | null;
  primaryDepartmentName: string | null;
  isPosStub: boolean;
  /** ADR 0027 — the shop has stopped selling this dish. */
  isRetired: boolean;
  /**
   * When this dish last sold, printed only on a retired row (Q3).
   *
   * It is the fact that replaces a `deactivated_at` column. Mise cannot know
   * WHEN somebody pressed เลิกขาย, and does not need to: if a dish marked
   * เลิกขาย sold yesterday, the POS never got the message, and that conclusion
   * is the reader's to draw from a date rather than the system's to infer.
   */
  lastSoldLabel: string | null;
  /** Why this row is in the queue, in one sentence. Null when it is not. */
  todoLabel: string | null;
  /** What the shop loses by leaving it. Null when nothing is missing. */
  consequenceLabel: string | null;
};

const NEEDS_REVIEW = "เมนูใหม่จากไฟล์ ยังไม่ได้ตรวจ";
const NEEDS_CATEGORY = "ยังไม่ได้ระบุหมวด";
const NEEDS_DEPARTMENT = "ยังไม่ได้ระบุแผนกที่รับรายได้";

const NO_CATEGORY_CONSEQUENCE = "จะไม่ปรากฏในกราฟแยกหมวด";
const NO_DEPARTMENT_CONSEQUENCE = "รายได้จะไม่เข้าแผนกไหนในหน้าต้นทุน";

/** A Buddhist-era short date, the way every other Mise screen prints one. */
function formatThaiDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function toMenuRowView(m: MenuListRow, departmentsEnabled: boolean): MenuRowView {
  const todos: string[] = [];
  const consequences: string[] = [];

  if (m.isPosStub) todos.push(NEEDS_REVIEW);
  if (!m.menuCategoryId) {
    todos.push(NEEDS_CATEGORY);
    consequences.push(NO_CATEGORY_CONSEQUENCE);
  }
  // Only worth saying when the shop actually has departments. With the feature
  // off there is one department and everything lands in it, so the words
  // "ไม่ระบุแผนก" would be noise (ADR 0019 Q16 / H.1).
  if (departmentsEnabled && !m.primaryDepartmentId) {
    todos.push(NEEDS_DEPARTMENT);
    consequences.push(NO_DEPARTMENT_CONSEQUENCE);
  }

  return {
    id: m.id,
    name: m.name,
    posMenuName: m.posMenuName,
    posMenuCode: m.posMenuId,
    posName:
      m.posMenuName && m.posMenuName !== m.name
        ? `POS เรียกว่า “${m.posMenuName}”`
        : null,
    menuCategoryId: m.menuCategoryId,
    menuCategoryName: m.menuCategory?.name ?? null,
    primaryDepartmentId: m.primaryDepartmentId,
    primaryDepartmentName: m.primaryDepartment?.name ?? null,
    isPosStub: m.isPosStub,
    isRetired: !m.isActive,
    lastSoldLabel:
      !m.isActive && m.lastSoldAt !== null
        ? `ขายล่าสุด ${formatThaiDate(m.lastSoldAt)}`
        : null,
    todoLabel: todos.length > 0 ? todos.join(" · ") : null,
    consequenceLabel: consequences.length > 0 ? consequences.join(" · ") : null,
  };
}

export type MenuSuggestionRowView = {
  id: string;
  name: string;
  badge: string;
  isPosStub: boolean;
  /** "ผัดกะเพราไก่ (POS: กะเพราไก่)" — both names, because the difference is
   *  exactly what a person is being asked to judge. */
  label: string;
};

export function toMenuSuggestionRowView(s: MenuSuggestion): MenuSuggestionRowView {
  return {
    id: s.id,
    name: s.name,
    badge: similarityBadge(s.score),
    isPosStub: s.isPosStub,
    label:
      s.posMenuName && s.posMenuName !== s.name
        ? `${s.name} (POS: ${s.posMenuName})`
        : s.name,
  };
}
