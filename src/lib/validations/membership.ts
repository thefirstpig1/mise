// ============================================================
// Mise — inviting and managing people (Sprint 6 Part 29 L2, ADR 0029 Q2/Q10)
// ============================================================
// An invitation has no shape of its own. It IS a `tenant_membership` row, and
// there is no acceptance step, because the magic link that logs everybody in
// already proves the person owns the address (Q2). So this file validates two
// things and no third: who is being added, and what they are being given.
//
// WHAT IS DELIBERATELY ABSENT: a token, an expiry, a "resend", a status. Each
// would be machinery for a credential that already exists — and the second
// email it would need cannot be sent until Sprint 7 anyway.
// ============================================================

import { z } from "zod";
import { ALL_ROLES, type Role } from "@/lib/permissions/service";

const blankToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

export const MAX_MEMBER_NAME_LENGTH = 100;

/**
 * Roles a person can be given through the UI.
 *
 * Every role including `owner` — the refusal of an escalation is a RULE
 * (Q10), decided against the actor, not a hole in the vocabulary. Leaving
 * `owner` out here would make "transfer the shop to my co-founder" impossible
 * rather than merely guarded.
 */
export const assignableRoleSchema = z.enum(
  ALL_ROLES as unknown as [Role, ...Role[]],
  { errorMap: () => ({ message: "บทบาทไม่ถูกต้อง" }) }
);

/**
 * Branch reach as a form posts it.
 *
 * `allBranches` and a list are not alternatives in the data — the flag wins and
 * the list is what remains if the flag is ever cleared — but a form that posts
 * both is normal, so both are accepted and the write path stores both.
 */
const reachShape = {
  allBranches: z.preprocess(
    (v) => v === "on" || v === "true" || v === true,
    z.boolean()
  ),
  branchIds: z.preprocess(
    (v) => (Array.isArray(v) ? v : v === undefined || v === "" ? [] : [v]),
    z.array(z.string().uuid("สาขาไม่ถูกต้อง"))
  ),
};

export const inviteMemberInputSchema = z.object({
  /**
   * Lower-cased and trimmed, because it is the identity: `user.upsert` keys on
   * it, and "Kong@Example.com" inviting a second time must find the same person
   * rather than create a stranger with the same inbox.
   */
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().email("อีเมลไม่ถูกต้อง")
  ),
  /** Only used when this email has never signed in — never overwrites a name. */
  name: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(MAX_MEMBER_NAME_LENGTH, `ชื่อต้องไม่เกิน ${MAX_MEMBER_NAME_LENGTH} ตัวอักษร`)
      .nullable()
  ),
  role: assignableRoleSchema,
  ...reachShape,
});

export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>;

/**
 * Changing what an existing person may do.
 *
 * The same two things an invitation sets, because there is nothing else on a
 * membership a human should edit — `isActive` has its own action, since
 * removing somebody and adjusting them are different intentions and one should
 * never be a slip of the other.
 */
export const updateMemberInputSchema = z.object({
  membershipId: z.string().uuid("สมาชิกไม่ถูกต้อง"),
  role: assignableRoleSchema,
  ...reachShape,
});

export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;

export const setMemberActiveInputSchema = z.object({
  membershipId: z.string().uuid("สมาชิกไม่ถูกต้อง"),
  isActive: z.preprocess(
    (v) => v === "on" || v === "true" || v === true,
    z.boolean()
  ),
});

export type SetMemberActiveInput = z.infer<typeof setMemberActiveInputSchema>;

/** Thai field labels, the shape every form in this project uses. */
export const MEMBER_FIELD_LABELS_TH: Record<string, string> = {
  email: "อีเมล",
  name: "ชื่อ",
  role: "บทบาท",
  allBranches: "ทุกสาขา",
  branchIds: "สาขา",
  membershipId: "สมาชิก",
};

/** What each role is called on screen. */
export const ROLE_LABELS_TH: Record<Role, string> = {
  owner: "เจ้าของร้าน",
  admin: "ผู้ดูแลส่วนกลาง",
  manager: "ผู้จัดการ",
  purchaser: "ฝ่ายจัดซื้อ",
  kitchen_staff: "พนักงานครัว",
  accountant: "บัญชี",
  viewer: "ดูอย่างเดียว",
};

/**
 * One line saying what the role is FOR, shown under its name.
 *
 * A shop owner picking from a dropdown of seven job titles needs to know what
 * each one can see, and "manager" tells them nothing about cost.
 */
export const ROLE_HINTS_TH: Record<Role, string> = {
  owner: "ทำได้ทุกอย่าง รวมบิลลิ่ง และเป็นบทบาทเดียวที่แก้ไขเจ้าของคนอื่นได้",
  admin: "ทำได้ทุกอย่างในการปฏิบัติงาน แต่แตะบัญชีเจ้าของไม่ได้ และไม่มีบิลลิ่ง",
  manager: "ดูแลสาขาที่เข้าถึงได้ทั้งหมด รวมถึงเพิ่ม/แก้ไขคนในสาขานั้น",
  purchaser: "ใบสั่งซื้อ รับของ ผู้ขาย และเห็นราคาซื้อ",
  kitchen_staff: "นับสต๊อก ของเสีย มื้อพนักงาน อ่านสูตรได้ — แต่ไม่เห็นต้นทุน",
  accountant: "ค่าใช้จ่าย ยอดขาย และต้นทุน ไม่แก้ไขงานปฏิบัติการ",
  viewer: "ดูได้อย่างเดียว ไม่บันทึกอะไรเลย",
};
