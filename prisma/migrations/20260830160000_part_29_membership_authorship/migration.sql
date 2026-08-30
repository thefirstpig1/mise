-- ============================================================
-- Part 29 — who changed your permissions  (ADR 0029 Q14)
-- ============================================================
-- Two columns, and they exist because Part 29 is the first time a membership
-- can be changed by somebody OTHER than the person it belongs to. Until now
-- `tenant_membership` had exactly one writer — tenant-init, making the owner —
-- so "who did this to me" had an obvious answer and no column was needed.
--
-- From this Part an `admin` and a `manager` can both change other people's
-- roles and reach (Q10), and `tenant_membership` is a row that gets UPDATED
-- rather than appended to. Every other authorship question in Mise is answered
-- by the append-only ledger; this one has nothing to read.
--
-- WHY NOT A LOG TABLE. `membership_change_log` was considered and refused. It
-- is a new table plus an RLS policy plus an entry in TENANT_SCOPED_DELETE_ORDER
-- plus a screen to read it, bought to answer a question nobody asks — "how many
-- times has my role changed?". The dispute a shop actually has is about the
-- PRESENT: "why can I not see cost any more, and who did that". The last change
-- answers that completely, and these two columns are the whole of it.
--
-- HOW THIS DIFFERS FROM PART 27, which refused two columns on the same grounds.
-- There, `deactivated_at` was refused because the question it was bought for
-- already had an answer in the data (the last sale date). Here nothing in the
-- system answers the question even approximately. A column with no competitor
-- and a column with one are not the same purchase.
--
-- NULL IS THE HONEST DEFAULT, not a backfill target. A row nobody has touched
-- since creation has no changer, and that includes every owner tenant-init has
-- ever made. Writing `created_by` into these would be inventing an event.
--
-- ON DELETE: `role_changed_by` is a plain nullable FK to `app_user` with no
-- cascade. A user row is never deleted in this product (Auth.js owns it), and
-- if one ever were, losing the name of who made a change is preferable to
-- losing the membership itself.
-- ============================================================

ALTER TABLE "tenant_membership"
  ADD COLUMN "role_changed_at" TIMESTAMP(3),
  ADD COLUMN "role_changed_by" TEXT;

ALTER TABLE "tenant_membership"
  ADD CONSTRAINT "tenant_membership_role_changed_by_fkey"
  FOREIGN KEY ("role_changed_by") REFERENCES "app_user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Both or neither. A timestamp with no author, or an author with no time, is a
-- half-written fact that every reader would have to guess at.
ALTER TABLE "tenant_membership"
  ADD CONSTRAINT "tenant_membership_role_change_pair_check"
  CHECK (
    ("role_changed_at" IS NULL AND "role_changed_by" IS NULL)
    OR ("role_changed_at" IS NOT NULL AND "role_changed_by" IS NOT NULL)
  );
