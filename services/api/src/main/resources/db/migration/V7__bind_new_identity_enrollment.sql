-- Never infer the issuer of an existing subject. Pre-V7 production accounts
-- remain denied until an operator-approved identity migration binds them.
ALTER TABLE users ADD COLUMN oidc_issuer VARCHAR(2048) NULL;
ALTER TABLE users ADD CONSTRAINT ck_users_oidc_issuer_not_blank
    CHECK (oidc_issuer IS NULL OR char_length(trim(oidc_issuer)) BETWEEN 1 AND 2048);

-- Subjects remain globally unique as a conservative restriction: the same
-- subject from a different issuer is rejected rather than silently rebound.
CREATE UNIQUE INDEX uq_users_issuer_subject ON users (oidc_issuer, oidc_subject);
-- Existing duplicate emails deliberately fail migration and require review;
-- no data is deleted or accounts merged. New writes normalize email to lowercase.
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- Serialize rare enrollment writes across API instances, including idempotent
-- retries and case-insensitive checks against legacy email rows.
CREATE TABLE account_enrollment_lock (
    id INTEGER PRIMARY KEY,
    CONSTRAINT ck_account_enrollment_singleton CHECK (id = 1)
);
INSERT INTO account_enrollment_lock (id) VALUES (1);
