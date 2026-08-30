"use server";

// ============================================================
// Mise — people Server Actions (Sprint 6 Part 29 L4, ADR 0029)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here — all four live in permissions/service.ts and membership.ts,
// where a test can reach them without a session.
//
// Two things specific to this slice:
//
//   * **The actor is passed down, not looked up.** `requireTenant` already knows
//     the role and the reach, and handing them to the logic keeps that layer a
//     pure function of its inputs — which is what let the four rules be tested
//     without a browser at all.
//   * **Every refusal names the thing.** "คุณให้บทบาทนี้ไม่ได้" with no role in
//     it sends somebody to guess; a refusal that cannot be acted on is the
//     failure ADR 0027 spent a whole question on.
//
// Per the convention this glue layer has NO unit tests: coverage = zod (L2) +
// logic (L3) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import {
  inviteMemberInputSchema,
  setMemberActiveInputSchema,
  updateMemberInputSchema,
  ROLE_LABELS_TH,
  MEMBER_FIELD_LABELS_TH,
} from "@/lib/validations/membership";
import {
  AlreadyMemberError,
  BranchNotFoundError,
  CannotGrantBranchError,
  CannotGrantRoleError,
  CannotTouchOwnerError,
  LastOwnerError,
  MembershipNotFoundError,
  inviteMemberLogic,
  setMemberActiveLogic,
  updateMemberLogic,
  type MembershipActor,
} from "@/server/membership";
import type { Role } from "@/lib/permissions/service";
import type { ZodError } from "zod";

export type MemberActionState =
  | { ok: true; message: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

function toFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.errors) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) {
      out[key] = issue.message || `${MEMBER_FIELD_LABELS_TH[key] ?? key}ไม่ถูกต้อง`;
    }
  }
  return out;
}

const roleTh = (role: string) => ROLE_LABELS_TH[role as Role] ?? role;

/** Every refusal in this Part, turned into a sentence somebody can act on. */
function toFormError(e: unknown): MemberActionState {
  if (e instanceof CannotGrantRoleError) {
    return {
      ok: false,
      formError: `คุณให้บทบาท "${roleTh(e.role)}" ไม่ได้ เพราะบทบาทของคุณเองไม่มีสิทธิ์ทั้งหมดที่บทบาทนั้นมี`,
    };
  }
  if (e instanceof CannotTouchOwnerError) {
    return {
      ok: false,
      formError: "บัญชีเจ้าของร้านแก้ไขได้โดยเจ้าของร้านเท่านั้น",
    };
  }
  if (e instanceof CannotGrantBranchError) {
    return {
      ok: false,
      formError:
        e.branchIds.length > 0
          ? "คุณให้สิทธิ์สาขาที่ตัวเองเข้าถึงไม่ได้"
          : 'คุณให้สิทธิ์ "ทุกสาขา" ไม่ได้ เพราะตัวคุณเองเข้าถึงบางสาขาเท่านั้น',
    };
  }
  if (e instanceof LastOwnerError) {
    return {
      ok: false,
      formError:
        "ร้านต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน — ตั้งเจ้าของคนใหม่ก่อน แล้วค่อยเปลี่ยนคนนี้",
    };
  }
  if (e instanceof AlreadyMemberError) {
    return { ok: false, fieldErrors: { email: "อีเมลนี้อยู่ในร้านนี้อยู่แล้ว" } };
  }
  if (e instanceof BranchNotFoundError) {
    return { ok: false, fieldErrors: { branchIds: "ไม่พบสาขาที่เลือก" } };
  }
  if (e instanceof MembershipNotFoundError) {
    return { ok: false, formError: "ไม่พบสมาชิกคนนี้" };
  }
  throw e;
}

function revalidateMembers(): void {
  revalidatePath("/settings/members");
  // The dashboard menu is filtered by capability, so a role change alters what
  // the person sees the moment they reload.
  revalidatePath("/dashboard");
}

const actorOf = (ctx: {
  membership: { userId: string };
  role: string;
  reach: { allBranches: boolean; allowedBranchIds: string[] };
}): MembershipActor => ({
  userId: ctx.membership.userId,
  role: ctx.role,
  reach: ctx.reach,
});

/** Add somebody to the shop. The row IS the invitation (ADR 0029 Q2). */
export async function inviteMemberAction(
  _prevState: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const ctx = await requireTenant("member:manage");

  const parsed = inviteMemberInputSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
    allBranches: formData.get("all_branches"),
    branchIds: formData.getAll("branch_id"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const res = await inviteMemberLogic(ctx.tenantId, parsed.data, actorOf(ctx));
    revalidateMembers();
    return {
      ok: true,
      message: res.wasReactivated
        ? `เพิ่ม ${parsed.data.email} กลับเข้าร้านแล้ว`
        : `เชิญ ${parsed.data.email} แล้ว — เข้าใช้งานได้ทันทีเมื่อล็อกอินด้วยอีเมลนี้`,
    };
  } catch (e) {
    return toFormError(e);
  }
}

/** Change what somebody may do, and where. */
export async function updateMemberAction(
  _prevState: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const ctx = await requireTenant("member:manage");

  const parsed = updateMemberInputSchema.safeParse({
    membershipId: formData.get("membership_id"),
    role: formData.get("role"),
    allBranches: formData.get("all_branches"),
    branchIds: formData.getAll("branch_id"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    await updateMemberLogic(ctx.tenantId, parsed.data, actorOf(ctx));
    revalidateMembers();
    return { ok: true, message: "บันทึกแล้ว" };
  } catch (e) {
    return toFormError(e);
  }
}

/** Remove somebody, or bring them back. Never a delete (ADR 0029 Q2). */
export async function setMemberActiveAction(
  _prevState: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const ctx = await requireTenant("member:manage");

  const parsed = setMemberActiveInputSchema.safeParse({
    membershipId: formData.get("membership_id"),
    isActive: formData.get("is_active"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    await setMemberActiveLogic(ctx.tenantId, parsed.data, actorOf(ctx));
    revalidateMembers();
    return {
      ok: true,
      message: parsed.data.isActive ? "เปิดใช้งานแล้ว" : "นำออกจากร้านแล้ว",
    };
  } catch (e) {
    return toFormError(e);
  }
}
