"use server";

// ADR 0038 — the two writes behind ตั้งสิทธิ์ของร้าน. Thin: gate, parse, call
// the logic, turn each refusal into a sentence somebody can act on.

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import { capabilityLabelTh } from "@/lib/permissions/labels";
import {
  setMemberCapabilityInputSchema,
  setRoleCapabilitiesInputSchema,
} from "@/lib/validations/permissions";
import {
  CannotGrantCapabilityError,
  ExceptionTargetError,
  OwnerOnlyError,
  PairBrokenError,
  setMemberCapabilityLogic,
  setRoleCapabilitiesLogic,
} from "@/server/capability-settings";

export type PermissionActionState = { ok: true } | { ok: false; formError: string };

function toFormError(e: unknown): PermissionActionState {
  if (e instanceof OwnerOnlyError) {
    return { ok: false, formError: "ตารางสิทธิ์ของบทบาทแก้ได้โดยเจ้าของร้านเท่านั้น" };
  }
  if (e instanceof PairBrokenError) {
    return {
      ok: false,
      formError: `“${capabilityLabelTh(e.capability)}” ต้องมาคู่กับ “${capabilityLabelTh(e.needs)}” เพราะหน้านั้นแสดงตัวเลขเงิน`,
    };
  }
  if (e instanceof CannotGrantCapabilityError) {
    return {
      ok: false,
      formError: `คุณให้ “${capabilityLabelTh(e.capability)}” ไม่ได้ เพราะตัวคุณเองไม่มีสิทธิ์นี้`,
    };
  }
  if (e instanceof ExceptionTargetError) {
    const why = {
      owner: "เจ้าของร้านมีทุกสิทธิ์เสมอ จึงตั้งข้อยกเว้นไม่ได้",
      self: "แก้สิทธิ์ของตัวเองไม่ได้ กรุณาให้เจ้าของร้านหรือผู้ดูแลคนอื่นแก้ให้",
      missing: "ไม่พบสมาชิกคนนี้",
    }[e.reason];
    return { ok: false, formError: why };
  }
  throw e;
}

const BAD_INPUT: PermissionActionState = { ok: false, formError: "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองอีกครั้ง" };

function done(): PermissionActionState {
  revalidatePath("/settings/permissions");
  // The menu is filtered by capability — it changes on the next load.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setRoleCapabilitiesAction(input: unknown): Promise<PermissionActionState> {
  const ctx = await requireTenant("member:manage");
  const parsed = setRoleCapabilitiesInputSchema.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  try {
    await setRoleCapabilitiesLogic(
      ctx.tenantId,
      { userId: ctx.membership.userId, role: ctx.role, capabilities: ctx.capabilities },
      parsed.data
    );
  } catch (e) {
    return toFormError(e);
  }
  return done();
}

export async function setMemberCapabilityAction(input: unknown): Promise<PermissionActionState> {
  const ctx = await requireTenant("member:manage");
  const parsed = setMemberCapabilityInputSchema.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  try {
    await setMemberCapabilityLogic(
      ctx.tenantId,
      { userId: ctx.membership.userId, role: ctx.role, capabilities: ctx.capabilities },
      parsed.data
    );
  } catch (e) {
    return toFormError(e);
  }
  return done();
}
