-- CreateTable
CREATE TABLE "stock_cost_declaration" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "input_unit_cost" DECIMAL(15,4) NOT NULL,
    "input_unit_id" UUID NOT NULL,
    "unit_cost" DECIMAL(15,4) NOT NULL,
    "note" TEXT,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declared_by" TEXT NOT NULL,
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "stock_cost_declaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_cost_declaration_tenant_id_idx" ON "stock_cost_declaration"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_cost_declaration_movement_idx" ON "stock_cost_declaration"("movement_id");

-- AddForeignKey
ALTER TABLE "stock_cost_declaration" ADD CONSTRAINT "stock_cost_declaration_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_cost_declaration" ADD CONSTRAINT "stock_cost_declaration_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_cost_declaration" ADD CONSTRAINT "stock_cost_declaration_input_unit_id_fkey" FOREIGN KEY ("input_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_cost_declaration" ADD CONSTRAINT "stock_cost_declaration_declared_by_fkey" FOREIGN KEY ("declared_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Inline CHECK constraints (Part 14, ADR 0014)
-- ============================================================
-- Prisma cannot express CHECKs; they live here rather than in prisma/manual/,
-- which is reserved for what a migration file cannot write by hand (partial
-- index / NULLS NOT DISTINCT / CREATE EXTENSION). Precedent: Part 10's sign
-- check and Part 11's five range checks.
--
-- A cost is never negative. Zero IS allowed and is meaningful: it is the value
-- of the UNPRICED fallback (ADR 0014 Q10) — stock of a product that has never
-- been purchased, which the read reports with costSource = UNPRICED rather than
-- pretending the number is real.
ALTER TABLE stock_cost_declaration
  ADD CONSTRAINT stock_cost_declaration_input_unit_cost_check
  CHECK (input_unit_cost >= 0);

ALTER TABLE stock_cost_declaration
  ADD CONSTRAINT stock_cost_declaration_unit_cost_check
  CHECK (unit_cost >= 0);

-- A row is superseded by a LATER declaration, never by an earlier one. Guards
-- the supersede path against writing a timestamp that predates the statement it
-- is meant to close.
ALTER TABLE stock_cost_declaration
  ADD CONSTRAINT stock_cost_declaration_superseded_after_declared_check
  CHECK (superseded_at IS NULL OR superseded_at >= declared_at);

-- NOTE: "the movement must be an ADJUST_GAIN" (ADR 0014 Q6) is NOT here. The
-- rule reads stock_movement.type, and a Postgres CHECK cannot reference another
-- table; a trigger would be the only DB-level option. Enforced in-app inside the
-- write transaction instead — the same call ADR 0012 Q2 made for the
-- allocation-sum invariant.
