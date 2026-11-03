-- Migration: 003_investigations_policies_events.sql
-- Description: Persists investigations (frontend orders and agent checkouts), agent spend
--              policies, and an audit trail of every payment state change.

-- Table: investigations. One row per order investigation or agent checkout. The full record is
-- kept as JSON; the columns hold what is filtered, sorted or summed.
CREATE TABLE IF NOT EXISTS investigations (
    id VARCHAR(128) PRIMARY KEY,
    kind VARCHAR(30) NOT NULL DEFAULT 'order',
    order_id VARCHAR(128),
    paypal_order_id VARCHAR(128),
    agent_id VARCHAR(100),
    verdict VARCHAR(10),
    capture_state VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    amount NUMERIC(12, 2),
    currency VARCHAR(3),
    simulated BOOLEAN NOT NULL DEFAULT TRUE,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_investigation_kind CHECK (kind IN ('order', 'agent_checkout')),
    CONSTRAINT chk_investigation_verdict CHECK (verdict IS NULL OR verdict IN ('ALLOW', 'WARN', 'PAUSE')),
    CONSTRAINT chk_investigation_capture_state CHECK (
        capture_state IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'HELD', 'VOIDED', 'FAILED')
    )
);

CREATE INDEX IF NOT EXISTS idx_investigations_order_id ON investigations (order_id);
CREATE INDEX IF NOT EXISTS idx_investigations_kind_created ON investigations (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigations_agent_created ON investigations (agent_id, created_at DESC);

-- Table: spend_policies. One policy per agent.
CREATE TABLE IF NOT EXISTS spend_policies (
    agent_id VARCHAR(100) PRIMARY KEY,
    per_order_cap NUMERIC(12, 2) NOT NULL,
    daily_cap NUMERIC(12, 2) NOT NULL,
    first_purchase_cap NUMERIC(12, 2),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_spend_policy_caps CHECK (per_order_cap >= 0 AND daily_cap >= 0)
);

-- Table: payment_events. Append-only audit trail of capture state changes. No secrets.
CREATE TABLE IF NOT EXISTS payment_events (
    id BIGSERIAL PRIMARY KEY,
    investigation_id VARCHAR(128) NOT NULL,
    from_state VARCHAR(20),
    to_state VARCHAR(20) NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    simulated BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_events_investigation ON payment_events (investigation_id, id);
