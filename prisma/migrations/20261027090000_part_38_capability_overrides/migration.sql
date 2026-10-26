-- ============================================================
-- ADR 0038 — สิทธิ์ที่ร้านปรับเอง (Kong 2026-10-26, mockup ShGwn4G37nphkvnQrnf3WN).
--
-- * Defaults stay in TypeScript (ROLE_CAPABILITIES). These tables hold only
--   what a shop changed: per role, and per person.
-- * role / capability are plain text like tenant_membership.role; the code
--   reads only names it knows, so an unknown string grants nothing.
-- * permission_change_log is append-only: no updated_at, no deleted_at.
--   Exactly one of role / tenant_membership_id names the target.
-- RLS: enable_rls.sql / enforce_rls.sql (manual SQL, applied every release).
-- ============================================================

CREATE TABLE "role_capability_override" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_capability_override_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "membership_capability_override" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "tenant_membership_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_capability_override_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permission_change_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "role" TEXT,
    "tenant_membership_id" UUID,
    "capability" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_change_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "permission_change_log_one_target" CHECK (("role" IS NULL) <> ("tenant_membership_id" IS NULL)),
    CONSTRAINT "permission_change_log_change_check" CHECK ("change" IN ('grant', 'revoke', 'reset'))
);

CREATE UNIQUE INDEX "role_capability_override_tenant_id_role_capability_key" ON "role_capability_override"("tenant_id", "role", "capability");
CREATE INDEX "membership_capability_override_tenant_id_idx" ON "membership_capability_override"("tenant_id");
CREATE UNIQUE INDEX "membership_capability_override_tenant_membership_id_capabil_key" ON "membership_capability_override"("tenant_membership_id", "capability");
CREATE INDEX "permission_change_log_tenant_id_created_at_idx" ON "permission_change_log"("tenant_id", "created_at");

ALTER TABLE "role_capability_override" ADD CONSTRAINT "role_capability_override_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_capability_override" ADD CONSTRAINT "role_capability_override_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_capability_override" ADD CONSTRAINT "membership_capability_override_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_capability_override" ADD CONSTRAINT "membership_capability_override_tenant_membership_id_fkey" FOREIGN KEY ("tenant_membership_id") REFERENCES "tenant_membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_capability_override" ADD CONSTRAINT "membership_capability_override_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "permission_change_log" ADD CONSTRAINT "permission_change_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "permission_change_log" ADD CONSTRAINT "permission_change_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "permission_change_log" ADD CONSTRAINT "permission_change_log_tenant_membership_id_fkey" FOREIGN KEY ("tenant_membership_id") REFERENCES "tenant_membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
