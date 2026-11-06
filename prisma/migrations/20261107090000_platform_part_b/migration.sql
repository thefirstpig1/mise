-- ADR 0045 part B — what the control page keeps (Kong 2026-11-07: "ก. อนุมัติทั้ง 6 กลุ่ม จัดมาเลย").
-- Hand-written: the generated diff also carried unrelated drift (id defaults,
-- two FKs) that is not this Part's to change. Row security for every new table
-- is in prisma/manual/enable_rls.sql and enforce_rls.sql.

-- Terms accepted and marketing consent (Q12). Null = not given.
ALTER TABLE "app_user"
  ADD COLUMN "terms_version" TEXT,
  ADD COLUMN "terms_accepted_at" TIMESTAMP(3),
  ADD COLUMN "marketing_opt_in_at" TIMESTAMP(3);

-- The setup card's three optional answers (Q14), and the day a closed shop
-- may be erased (Q10; the closing itself is the existing deleted_at).
ALTER TABLE "tenant"
  ADD COLUMN "shop_type" TEXT,
  ADD COLUMN "province" TEXT,
  ADD COLUMN "heard_from" TEXT,
  ADD COLUMN "purge_after" DATE;

ALTER TABLE "tenant" ADD CONSTRAINT "tenant_answers_length_check"
  CHECK (length(coalesce("shop_type", '')) <= 60 AND length(coalesce("province", '')) <= 60 AND length(coalesce("heard_from", '')) <= 60);
-- A shop is erased only after it was closed.
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_purge_needs_close_check"
  CHECK ("purge_after" IS NULL OR "deleted_at" IS NOT NULL);

CREATE TABLE "login_event" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_event_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "login_event_created_idx" ON "login_event"("created_at");
CREATE INDEX "login_event_user_idx" ON "login_event"("user_id", "created_at");

CREATE TABLE "user_activity_day" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_activity_day_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_activity_day_key" ON "user_activity_day"("tenant_id", "user_id", "day");
CREATE INDEX "user_activity_day_day_idx" ON "user_activity_day"("day");
ALTER TABLE "user_activity_day" ADD CONSTRAINT "user_activity_day_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_announcement" (
    "id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "stopped_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_announcement_ends_idx" ON "platform_announcement"("ends_at");
ALTER TABLE "platform_announcement" ADD CONSTRAINT "platform_announcement_tone_check" CHECK ("tone" IN ('info', 'important'));
ALTER TABLE "platform_announcement" ADD CONSTRAINT "platform_announcement_message_check" CHECK (length(btrim("message")) > 0 AND length("message") <= 300);
ALTER TABLE "platform_announcement" ADD CONSTRAINT "platform_announcement_window_check" CHECK ("ends_at" > "starts_at");

CREATE TABLE "data_request" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "shop_id" UUID,
    "shop_name" TEXT,
    "requester" TEXT NOT NULL,
    "requested_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "note" TEXT,
    "done_at" TIMESTAMP(3),
    "done_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_request_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "data_request_open_idx" ON "data_request"("done_at", "due_on");
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_kind_check" CHECK ("kind" IN ('export', 'delete', 'personal'));
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_due_check" CHECK ("due_on" >= "requested_on");
