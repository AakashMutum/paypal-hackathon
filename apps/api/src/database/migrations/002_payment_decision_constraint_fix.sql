-- Migration: 002_payment_decision_constraint_fix.sql
-- Description: Widen payment_decisions.decision from VARCHAR(10) to VARCHAR(20)
--              so that invalid decision values are rejected by the named
--              chk_payment_decision CHECK constraint rather than by a
--              column-length violation.
--
-- Safe to run on databases where 001_initial_schema.sql has already been
-- applied. Uses ALTER TABLE ... ALTER COLUMN TYPE which is non-destructive
-- for existing rows (all valid decisions ALLOW/WARN/PAUSE fit within 20 chars).
--
-- Idempotency: the ALTER COLUMN TYPE succeeds regardless of current length,
-- so re-running this migration after it has been applied is a no-op.

ALTER TABLE payment_decisions
    ALTER COLUMN decision TYPE VARCHAR(20);

-- Re-affirm the CHECK constraint (already exists from migration 001, but
-- applied again for clarity and to guarantee it is present on fresh databases
-- where this migration runs after 001).
ALTER TABLE payment_decisions
    DROP CONSTRAINT IF EXISTS chk_payment_decision;

ALTER TABLE payment_decisions
    ADD CONSTRAINT chk_payment_decision CHECK (decision IN ('ALLOW', 'WARN', 'PAUSE'));