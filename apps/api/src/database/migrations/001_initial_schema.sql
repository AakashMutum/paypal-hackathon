-- Migration: 001_initial_schema.sql
-- Description: Creates initial schema for TRUSTORA:
--              merchant_records, checkout_sessions, risk_assessments, payment_decisions

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table 1: merchant_records
CREATE TABLE IF NOT EXISTS merchant_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id VARCHAR(100) UNIQUE,
    domain VARCHAR(255) NOT NULL,
    claimed_name VARCHAR(255) NOT NULL,
    payee_email VARCHAR(255),
    verification_status VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED',
    reputation_score NUMERIC(5, 2) DEFAULT 50.00,
    domain_created_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_merchant_verification_status CHECK (
        verification_status IN ('UNVERIFIED', 'VERIFIED_GENUINE', 'FLAGGED_SUSPICIOUS', 'CONFIRMED_FRAUD')
    ),
    CONSTRAINT chk_merchant_reputation_score CHECK (
        reputation_score >= 0.00 AND reputation_score <= 100.00
    )
);

CREATE INDEX IF NOT EXISTS idx_merchant_records_domain ON merchant_records (domain);
CREATE INDEX IF NOT EXISTS idx_merchant_records_payee_email ON merchant_records (payee_email);
CREATE INDEX IF NOT EXISTS idx_merchant_records_verification_status ON merchant_records (verification_status);

-- Table 2: checkout_sessions
CREATE TABLE IF NOT EXISTS checkout_sessions (
    id VARCHAR(128) PRIMARY KEY,
    merchant_id UUID REFERENCES merchant_records(id) ON DELETE SET NULL,
    storefront_url TEXT NOT NULL,
    domain VARCHAR(255) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    paypal_order_id VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED',
    buyer_reference VARCHAR(100),
    order_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_checkout_amount CHECK (amount >= 0),
    CONSTRAINT chk_checkout_currency_length CHECK (char_length(currency) = 3),
    CONSTRAINT chk_checkout_status CHECK (
        status IN ('CREATED', 'EVALUATING', 'PENDING_REVIEW', 'ALLOWED', 'WARNED', 'PAUSED', 'COMPLETED', 'CANCELLED')
    )
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_domain ON checkout_sessions (domain);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_paypal_order_id ON checkout_sessions (paypal_order_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON checkout_sessions (status);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_created_at ON checkout_sessions (created_at);

-- Table 3: risk_assessments
-- Component score weights:
--   Domain reputation: 30%
--   Merchant identity consistency: 40%
--   Pricing anomalies: 20%
--   SSL/technical indicators: 10%
CREATE TABLE IF NOT EXISTS risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(128) NOT NULL REFERENCES checkout_sessions(id) ON DELETE CASCADE,
    merchant_id UUID REFERENCES merchant_records(id) ON DELETE SET NULL,
    overall_score NUMERIC(5, 2) NOT NULL,
    domain_reputation_score NUMERIC(5, 2) NOT NULL,
    merchant_consistency_score NUMERIC(5, 2) NOT NULL,
    pricing_anomaly_score NUMERIC(5, 2) NOT NULL,
    ssl_technical_score NUMERIC(5, 2) NOT NULL,
    weights_applied JSONB NOT NULL DEFAULT '{"domain": 0.30, "merchant_consistency": 0.40, "pricing_anomaly": 0.20, "ssl_technical": 0.10}'::jsonb,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_overall_score CHECK (overall_score >= 0.00 AND overall_score <= 100.00),
    CONSTRAINT chk_domain_reputation_score CHECK (domain_reputation_score >= 0.00 AND domain_reputation_score <= 100.00),
    CONSTRAINT chk_merchant_consistency_score CHECK (merchant_consistency_score >= 0.00 AND merchant_consistency_score <= 100.00),
    CONSTRAINT chk_pricing_anomaly_score CHECK (pricing_anomaly_score >= 0.00 AND pricing_anomaly_score <= 100.00),
    CONSTRAINT chk_ssl_technical_score CHECK (ssl_technical_score >= 0.00 AND ssl_technical_score <= 100.00)
);

CREATE INDEX IF NOT EXISTS idx_risk_assessments_session_id ON risk_assessments (session_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_overall_score ON risk_assessments (overall_score);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_evaluated_at ON risk_assessments (evaluated_at);

-- Table 4: payment_decisions
-- Decision thresholds:
--   ALLOW: 0–39
--   WARN: 40–74
--   PAUSE: 75–100
CREATE TABLE IF NOT EXISTS payment_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(128) NOT NULL REFERENCES checkout_sessions(id) ON DELETE CASCADE,
    risk_assessment_id UUID REFERENCES risk_assessments(id) ON DELETE SET NULL,
    decision VARCHAR(10) NOT NULL,
    action_taken VARCHAR(50) NOT NULL DEFAULT 'EVALUATED',
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    intervention_triggered BOOLEAN NOT NULL DEFAULT false,
    override_details JSONB,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_payment_decision CHECK (decision IN ('ALLOW', 'WARN', 'PAUSE')),
    CONSTRAINT chk_payment_action_taken CHECK (
        action_taken IN ('EVALUATED', 'PROCEED', 'WARN_DISPLAYED', 'CAPTURE_PAUSED', 'USER_OVERRIDE', 'USER_ABANDONED')
    )
);

CREATE INDEX IF NOT EXISTS idx_payment_decisions_session_id ON payment_decisions (session_id);
CREATE INDEX IF NOT EXISTS idx_payment_decisions_decision ON payment_decisions (decision);
CREATE INDEX IF NOT EXISTS idx_payment_decisions_decided_at ON payment_decisions (decided_at);

