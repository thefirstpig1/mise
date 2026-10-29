-- ADR 0043 Q4 (Kong 2026-10-30: "เอาตามแผน ทำให้เลย"): every change made from
-- the platform screens. Not tenant-scoped, no FK to tenant on purpose — the
-- record outlives the shop. RLS (enabled + forced, NO policy) lives in
-- prisma/manual/enable_rls.sql / enforce_rls.sql, as for every table.

CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_tenant_id" UUID,
    "target_name" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_target_idx" ON "platform_audit_log"("target_tenant_id");
CREATE INDEX "platform_audit_created_idx" ON "platform_audit_log"("created_at");
