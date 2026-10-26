// ADR 0038 — what the permission settings screen may send.
import { z } from "zod";
import { ADJUSTABLE_CAPABILITIES, ALL_ROLES, LOCKED_ROLES, type Capability, type Role } from "@/lib/permissions/service";

const adjustableCapability = z
  .string()
  .refine((c): c is Capability => ADJUSTABLE_CAPABILITIES.has(c as Capability), "ปรับสิทธิ์นี้ไม่ได้");

const editableRole = z
  .string()
  .refine((r) => (ALL_ROLES as readonly string[]).includes(r) && !LOCKED_ROLES.has(r as Role), "ปรับบทบาทนี้ไม่ได้");

/** The whole adjustable set a role should hold. `reset` = back to the default. */
export const setRoleCapabilitiesInputSchema = z.object({
  role: editableRole,
  capabilities: z.array(adjustableCapability).max(32),
  reset: z.boolean().default(false),
});
export type SetRoleCapabilitiesInput = z.infer<typeof setRoleCapabilitiesInputSchema>;

/** One person, one capability: follow the role, or open / close it for them. */
export const setMemberCapabilityInputSchema = z.object({
  membershipId: z.string().uuid(),
  capability: adjustableCapability,
  state: z.enum(["inherit", "grant", "revoke"]),
});
export type SetMemberCapabilityInput = z.infer<typeof setMemberCapabilityInputSchema>;
