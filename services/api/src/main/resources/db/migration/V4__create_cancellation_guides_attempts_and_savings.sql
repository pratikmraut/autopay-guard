-- Re-declare the unchanged V2 category constraint so an H2 database upgraded
-- across separate Flyway runs does not retain H2's stale constant-set object.
-- PostgreSQL receives the same constraint definition and prior checksums/rows
-- remain untouched.
ALTER TABLE merchants DROP CONSTRAINT ck_merchants_category;
ALTER TABLE merchants
    ADD CONSTRAINT ck_merchants_category
        CHECK (category IN (
            'SUBSCRIPTION', 'UTILITY', 'MEMBERSHIP', 'SOFTWARE', 'EMI_LOAN',
            'INSURANCE', 'INVESTMENT_COMMITMENT', 'EDUCATION', 'OTHER'
        ));

CREATE TABLE idempotency_records (
    owner_user_id UUID NOT NULL,
    operation VARCHAR(40) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    resource_id UUID NOT NULL,
    response_body VARCHAR(20000) NULL,
    response_version BIGINT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (owner_user_id, operation, key_hash),
    CONSTRAINT fk_idempotency_records_owner
        FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_idempotency_records_operation
        CHECK (operation IN (
            'OCCURRENCE_DECISION', 'CANCELLATION_ATTEMPT',
            'ATTEMPT_VERIFICATION', 'GUIDE_FEEDBACK'
        )),
    CONSTRAINT ck_idempotency_records_key_hash
        CHECK (char_length(key_hash) = 64),
    CONSTRAINT ck_idempotency_records_request_hash
        CHECK (char_length(request_hash) = 64),
    CONSTRAINT ck_idempotency_records_response
        CHECK (
            (
                operation = 'OCCURRENCE_DECISION'
                AND response_body IS NOT NULL
                AND response_version IS NULL
            )
            OR
            (
                operation IN ('CANCELLATION_ATTEMPT', 'ATTEMPT_VERIFICATION')
                AND response_body IS NOT NULL
                AND response_version >= 0
            )
            OR
            (
                operation = 'GUIDE_FEEDBACK'
                AND response_body IS NULL
                AND response_version IS NULL
            )
        )
);

CREATE TABLE occurrence_decisions (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    household_id UUID NOT NULL,
    commitment_id UUID NOT NULL,
    occurrence_id UUID NOT NULL,
    scheduled_date DATE NOT NULL,
    sequence_number INTEGER NOT NULL,
    commitment_version BIGINT NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    category VARCHAR(40) NOT NULL,
    payment_rail VARCHAR(40) NOT NULL,
    expected_amount_minor BIGINT NULL,
    amount_kind VARCHAR(24) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    action VARCHAR(40) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_occurrence_decisions_owner_household
        FOREIGN KEY (household_id, owner_user_id)
            REFERENCES households (id, owner_user_id) ON DELETE CASCADE,
    CONSTRAINT fk_occurrence_decisions_commitment
        FOREIGN KEY (household_id, commitment_id)
            REFERENCES recurring_commitments (household_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_occurrence_decisions_sequence
        UNIQUE (commitment_id, scheduled_date, sequence_number),
    CONSTRAINT ck_occurrence_decisions_sequence
        CHECK (sequence_number >= 1),
    CONSTRAINT ck_occurrence_decisions_version
        CHECK (commitment_version >= 0),
    CONSTRAINT ck_occurrence_decisions_display_name
        CHECK (char_length(trim(display_name)) BETWEEN 1 AND 160),
    CONSTRAINT ck_occurrence_decisions_category
        CHECK (category IN (
            'SUBSCRIPTION', 'UTILITY', 'MEMBERSHIP', 'SOFTWARE', 'EMI_LOAN',
            'INSURANCE', 'INVESTMENT_COMMITMENT', 'EDUCATION', 'OTHER'
        )),
    CONSTRAINT ck_occurrence_decisions_payment_rail
        CHECK (payment_rail IN (
            'UPI_AUTOPAY', 'CARD_RECURRING', 'NACH_ENACH', 'APP_STORE',
            'MERCHANT_DIRECT', 'CASH_OR_MANUAL', 'UNKNOWN'
        )),
    CONSTRAINT ck_occurrence_decisions_money
        CHECK (
            expected_amount_minor IS NULL
            OR expected_amount_minor BETWEEN 1 AND 999999999999
        ),
    CONSTRAINT ck_occurrence_decisions_amount_kind
        CHECK (
            (amount_kind = 'UNKNOWN_VARIABLE' AND expected_amount_minor IS NULL)
            OR
            (amount_kind IN ('FIXED', 'ESTIMATED') AND expected_amount_minor IS NOT NULL)
        ),
    CONSTRAINT ck_occurrence_decisions_currency
        CHECK (currency = upper(currency) AND char_length(currency) = 3),
    CONSTRAINT ck_occurrence_decisions_action
        CHECK (action IN (
            'KEEP', 'REVIEW', 'PAUSE_TRACKING', 'CANCEL_WITH_PROVIDER',
            'DOWNGRADE_WITH_PROVIDER', 'SWITCH_PROVIDER', 'CONFIRM_BILL',
            'COMPARE_PROVIDERS', 'DUE_DATE_READINESS', 'PAYMENT_CONFIRMATION',
            'RENEWAL_READINESS', 'TRACK'
        ))
);

CREATE INDEX idx_occurrence_decisions_current
    ON occurrence_decisions (
        owner_user_id, household_id, commitment_id, scheduled_date,
        sequence_number DESC, id
    );

CREATE TABLE cancellation_target_allowlist (
    target_key VARCHAR(100) PRIMARY KEY,
    action_type VARCHAR(24) NOT NULL,
    scheme VARCHAR(32) NOT NULL,
    host VARCHAR(253) NOT NULL,
    path_prefix VARCHAR(300) NOT NULL,
    enabled BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_cancellation_target_key
        CHECK (char_length(trim(target_key)) BETWEEN 1 AND 100),
    CONSTRAINT ck_cancellation_target_action
        CHECK (action_type IN ('SAFE_LINK', 'APP_DEEP_LINK')),
    CONSTRAINT ck_cancellation_target_scheme
        CHECK (
            (action_type = 'SAFE_LINK' AND scheme = 'https')
            OR
            (action_type = 'APP_DEEP_LINK' AND scheme = 'autopayguard-demo')
        ),
    CONSTRAINT ck_cancellation_target_host
        CHECK (
            host = lower(host)
            AND char_length(host) BETWEEN 1 AND 253
            AND position('://' IN host) = 0
            AND position('/' IN host) = 0
            AND position('@' IN host) = 0
            AND position(':' IN host) = 0
            AND position(' ' IN host) = 0
            AND regexp_like(
                host,
                '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
            )
            AND host NOT LIKE '%xn--%'
            AND (
                (action_type = 'SAFE_LINK'
                    AND host LIKE '%.example'
                    AND char_length(host) > char_length('.example'))
                OR
                (action_type = 'APP_DEEP_LINK' AND host = 'mandates')
            )
        ),
    CONSTRAINT ck_cancellation_target_path
        CHECK (
            char_length(path_prefix) BETWEEN 2 AND 300
            AND path_prefix LIKE '/%/'
            AND position('..' IN path_prefix) = 0
            AND position('//' IN path_prefix) = 0
            AND position('\' IN path_prefix) = 0
            AND position('?' IN path_prefix) = 0
            AND position('#' IN path_prefix) = 0
            AND position('%' IN path_prefix) = 0
        )
);

CREATE TABLE cancellation_guides (
    id UUID PRIMARY KEY,
    merchant_id UUID NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_cancellation_guides_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE RESTRICT
);

CREATE TABLE cancellation_guide_versions (
    guide_id UUID NOT NULL,
    version INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL,
    risk_notice VARCHAR(1000) NOT NULL,
    structural_reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    review_interval_days INTEGER NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (guide_id, version),
    CONSTRAINT fk_cancellation_guide_versions_guide
        FOREIGN KEY (guide_id) REFERENCES cancellation_guides (id) ON DELETE CASCADE,
    CONSTRAINT ck_cancellation_guide_versions_version
        CHECK (version >= 1),
    CONSTRAINT ck_cancellation_guide_versions_status
        CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    CONSTRAINT ck_cancellation_guide_versions_notice
        CHECK (char_length(trim(risk_notice)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_cancellation_guide_versions_review_interval
        CHECK (review_interval_days BETWEEN 30 AND 90),
    CONSTRAINT ck_cancellation_guide_versions_publication
        CHECK (
            (status = 'DRAFT' AND published_at IS NULL)
            OR
            (status IN ('PUBLISHED', 'RETIRED') AND published_at IS NOT NULL)
        )
);

CREATE INDEX idx_cancellation_guide_versions_latest
    ON cancellation_guide_versions (guide_id, status, version DESC);

CREATE TABLE cancellation_guide_steps (
    guide_id UUID NOT NULL,
    guide_version INTEGER NOT NULL,
    track VARCHAR(24) NOT NULL,
    sequence_number INTEGER NOT NULL,
    action_type VARCHAR(24) NOT NULL,
    title VARCHAR(160) NOT NULL,
    instruction VARCHAR(1000) NOT NULL,
    target_key VARCHAR(100) NULL,
    target_uri VARCHAR(1000) NULL,
    PRIMARY KEY (guide_id, guide_version, track, sequence_number),
    CONSTRAINT fk_cancellation_guide_steps_version
        FOREIGN KEY (guide_id, guide_version)
            REFERENCES cancellation_guide_versions (guide_id, version) ON DELETE CASCADE,
    CONSTRAINT fk_cancellation_guide_steps_target
        FOREIGN KEY (target_key) REFERENCES cancellation_target_allowlist (target_key)
            ON DELETE RESTRICT,
    CONSTRAINT ck_cancellation_guide_steps_track
        CHECK (track IN ('SERVICE', 'PAYMENT_MANDATE')),
    CONSTRAINT ck_cancellation_guide_steps_sequence
        CHECK (sequence_number BETWEEN 1 AND 2),
    CONSTRAINT ck_cancellation_guide_steps_action
        CHECK (action_type IN ('INFORMATION', 'SAFE_LINK', 'APP_DEEP_LINK')),
    CONSTRAINT ck_cancellation_guide_steps_title
        CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
    CONSTRAINT ck_cancellation_guide_steps_instruction
        CHECK (char_length(trim(instruction)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_cancellation_guide_steps_target_pair
        CHECK (
            (action_type = 'INFORMATION' AND target_key IS NULL AND target_uri IS NULL)
            OR
            (action_type IN ('SAFE_LINK', 'APP_DEEP_LINK')
                AND target_key IS NOT NULL
                AND target_uri IS NOT NULL
                AND char_length(target_uri) BETWEEN 1 AND 1000)
        )
);

CREATE TABLE cancellation_attempts (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    household_id UUID NOT NULL,
    commitment_id UUID NOT NULL,
    occurrence_id UUID NOT NULL,
    decision_id UUID NOT NULL,
    guide_id UUID NOT NULL,
    guide_version INTEGER NOT NULL,
    scheduled_date DATE NOT NULL,
    verification_due_date DATE NOT NULL,
    household_timezone VARCHAR(64) NOT NULL,
    commitment_version BIGINT NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    category VARCHAR(40) NOT NULL,
    payment_rail VARCHAR(40) NOT NULL,
    expected_amount_minor BIGINT NULL,
    amount_kind VARCHAR(24) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    frequency VARCHAR(24) NOT NULL,
    interval_count INTEGER NOT NULL,
    custom_interval_unit VARCHAR(16) NULL,
    anchor_date DATE NOT NULL,
    month_day_policy VARCHAR(16) NOT NULL,
    variable_amount BOOLEAN NOT NULL,
    amount_minor BIGINT NULL,
    estimated_amount_minor BIGINT NULL,
    service_status VARCHAR(24) NOT NULL,
    payment_mandate_required BOOLEAN NOT NULL,
    payment_mandate_status VARCHAR(24) NOT NULL,
    verification_status VARCHAR(24) NOT NULL,
    savings_period_start DATE NOT NULL,
    savings_period_end DATE NOT NULL,
    projected_savings_minor BIGINT NULL,
    savings_estimated BOOLEAN NOT NULL,
    note VARCHAR(500) NULL,
    completed_at TIMESTAMP WITH TIME ZONE NULL,
    abandoned_at TIMESTAMP WITH TIME ZONE NULL,
    unresolved_key VARCHAR(64) NULL UNIQUE,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_cancellation_attempts_owner_household
        FOREIGN KEY (household_id, owner_user_id)
            REFERENCES households (id, owner_user_id) ON DELETE CASCADE,
    CONSTRAINT fk_cancellation_attempts_commitment
        FOREIGN KEY (household_id, commitment_id)
            REFERENCES recurring_commitments (household_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_cancellation_attempts_decision
        FOREIGN KEY (decision_id) REFERENCES occurrence_decisions (id) ON DELETE RESTRICT,
    CONSTRAINT fk_cancellation_attempts_guide
        FOREIGN KEY (guide_id, guide_version)
            REFERENCES cancellation_guide_versions (guide_id, version) ON DELETE RESTRICT,
    CONSTRAINT ck_cancellation_attempts_dates
        CHECK (
            verification_due_date = scheduled_date + 1
            AND savings_period_start = scheduled_date
            AND savings_period_end + 1 = scheduled_date + INTERVAL '1' YEAR
        ),
    CONSTRAINT ck_cancellation_attempts_timezone
        CHECK (char_length(trim(household_timezone)) BETWEEN 1 AND 64),
    CONSTRAINT ck_cancellation_attempts_version_snapshot
        CHECK (commitment_version >= 0),
    CONSTRAINT ck_cancellation_attempts_display_name
        CHECK (char_length(trim(display_name)) BETWEEN 1 AND 160),
    CONSTRAINT ck_cancellation_attempts_category
        CHECK (category IN (
            'SUBSCRIPTION', 'UTILITY', 'MEMBERSHIP', 'SOFTWARE', 'EMI_LOAN',
            'INSURANCE', 'INVESTMENT_COMMITMENT', 'EDUCATION', 'OTHER'
        )),
    CONSTRAINT ck_cancellation_attempts_payment_rail
        CHECK (payment_rail IN (
            'UPI_AUTOPAY', 'CARD_RECURRING', 'NACH_ENACH', 'APP_STORE',
            'MERCHANT_DIRECT', 'CASH_OR_MANUAL', 'UNKNOWN'
        )),
    CONSTRAINT ck_cancellation_attempts_amount_kind
        CHECK (
            (amount_kind = 'UNKNOWN_VARIABLE' AND expected_amount_minor IS NULL)
            OR
            (amount_kind IN ('FIXED', 'ESTIMATED') AND expected_amount_minor IS NOT NULL)
        ),
    CONSTRAINT ck_cancellation_attempts_currency
        CHECK (currency = upper(currency) AND char_length(currency) = 3),
    CONSTRAINT ck_cancellation_attempts_frequency
        CHECK (frequency IN (
            'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'
        )),
    CONSTRAINT ck_cancellation_attempts_interval
        CHECK (interval_count BETWEEN 1 AND 3650),
    CONSTRAINT ck_cancellation_attempts_custom_unit
        CHECK (
            (frequency = 'CUSTOM'
                AND custom_interval_unit IN ('DAYS', 'WEEKS', 'MONTHS', 'YEARS'))
            OR
            (frequency <> 'CUSTOM' AND custom_interval_unit IS NULL)
        ),
    CONSTRAINT ck_cancellation_attempts_month_policy
        CHECK (month_day_policy IN ('ANCHOR_DAY', 'LAST_DAY')),
    CONSTRAINT ck_cancellation_attempts_money
        CHECK (
            (
                variable_amount = FALSE
                AND amount_minor BETWEEN 1 AND 999999999999
                AND estimated_amount_minor IS NULL
            )
            OR
            (
                variable_amount = TRUE
                AND amount_minor IS NULL
                AND (
                    estimated_amount_minor IS NULL
                    OR estimated_amount_minor BETWEEN 1 AND 999999999999
                )
            )
        ),
    CONSTRAINT ck_cancellation_attempts_track_status
        CHECK (
            service_status IN ('NOT_STARTED', 'REQUESTED', 'CONFIRMED', 'FAILED')
            AND payment_mandate_status IN (
                'NOT_REQUIRED', 'NOT_STARTED', 'REQUESTED', 'CONFIRMED', 'FAILED'
            )
        ),
    CONSTRAINT ck_cancellation_attempts_mandate_requirement
        CHECK (
            (
                payment_mandate_required = TRUE
                AND payment_rail IN (
                    'UPI_AUTOPAY', 'CARD_RECURRING', 'NACH_ENACH',
                    'APP_STORE', 'MERCHANT_DIRECT'
                )
                AND payment_mandate_status <> 'NOT_REQUIRED'
            )
            OR
            (
                payment_mandate_required = FALSE
                AND payment_rail IN ('CASH_OR_MANUAL', 'UNKNOWN')
                AND payment_mandate_status = 'NOT_REQUIRED'
            )
        ),
    CONSTRAINT ck_cancellation_attempts_verification
        CHECK (verification_status IN ('PENDING', 'SELF_REPORTED', 'VERIFIED', 'DISPUTED')),
    CONSTRAINT ck_cancellation_attempts_savings
        CHECK (
            (
                amount_kind = 'FIXED'
                AND projected_savings_minor BETWEEN 1 AND 9007199254740991
                AND savings_estimated = FALSE
            )
            OR
            (
                amount_kind = 'ESTIMATED'
                AND projected_savings_minor BETWEEN 1 AND 9007199254740991
                AND savings_estimated = TRUE
            )
            OR
            (
                amount_kind = 'UNKNOWN_VARIABLE'
                AND projected_savings_minor IS NULL
                AND savings_estimated = FALSE
            )
        ),
    CONSTRAINT ck_cancellation_attempts_note
        CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
    CONSTRAINT ck_cancellation_attempts_completion
        CHECK (
            (
                service_status = 'CONFIRMED'
                AND payment_mandate_status IN ('CONFIRMED', 'NOT_REQUIRED')
                AND completed_at IS NOT NULL
            )
            OR
            (
                NOT (
                    service_status = 'CONFIRMED'
                    AND payment_mandate_status IN ('CONFIRMED', 'NOT_REQUIRED')
                )
                AND completed_at IS NULL
            )
        ),
    CONSTRAINT ck_cancellation_attempts_verified_completion
        CHECK (
            verification_status NOT IN ('SELF_REPORTED', 'VERIFIED')
            OR completed_at IS NOT NULL
        ),
    CONSTRAINT ck_cancellation_attempts_unresolved
        CHECK (
            (
                abandoned_at IS NULL
                AND verification_status IN ('PENDING', 'SELF_REPORTED')
                AND unresolved_key IS NOT NULL
            )
            OR
            (
                (
                    abandoned_at IS NOT NULL
                    OR verification_status IN ('VERIFIED', 'DISPUTED')
                )
                AND unresolved_key IS NULL
            )
        ),
    CONSTRAINT ck_cancellation_attempts_abandoned_state
        CHECK (
            abandoned_at IS NULL
            OR verification_status IN ('PENDING', 'SELF_REPORTED')
        ),
    CONSTRAINT ck_cancellation_attempts_unresolved_key
        CHECK (unresolved_key IS NULL OR char_length(unresolved_key) = 64),
    CONSTRAINT ck_cancellation_attempts_version
        CHECK (optimistic_version >= 0)
);

CREATE INDEX idx_cancellation_attempts_owned
    ON cancellation_attempts (
        owner_user_id, household_id, commitment_id, created_at DESC, id
    );

CREATE TABLE cancellation_attempt_verifications (
    id UUID PRIMARY KEY,
    attempt_id UUID NOT NULL,
    from_status VARCHAR(24) NOT NULL,
    to_status VARCHAR(24) NOT NULL,
    verification_basis VARCHAR(24) NOT NULL,
    attempt_version BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_cancellation_attempt_verifications_attempt
        FOREIGN KEY (attempt_id) REFERENCES cancellation_attempts (id) ON DELETE CASCADE,
    CONSTRAINT uq_cancellation_attempt_verification_status
        UNIQUE (attempt_id, to_status),
    CONSTRAINT ck_cancellation_attempt_verification_from
        CHECK (from_status IN ('PENDING', 'SELF_REPORTED', 'VERIFIED')),
    CONSTRAINT ck_cancellation_attempt_verification_to
        CHECK (to_status IN ('SELF_REPORTED', 'VERIFIED', 'DISPUTED')),
    CONSTRAINT ck_cancellation_attempt_verification_basis
        CHECK (verification_basis = 'USER_ATTESTED'),
    CONSTRAINT ck_cancellation_attempt_verification_version
        CHECK (attempt_version >= 0)
);

CREATE INDEX idx_cancellation_attempt_verifications_attempt
    ON cancellation_attempt_verifications (attempt_id, created_at, id);

CREATE TABLE savings_events (
    id UUID PRIMARY KEY,
    attempt_id UUID NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    reversal_reason VARCHAR(24) NULL,
    amount_minor BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    estimated BOOLEAN NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    method VARCHAR(24) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_savings_events_attempt
        FOREIGN KEY (attempt_id) REFERENCES cancellation_attempts (id) ON DELETE CASCADE,
    CONSTRAINT uq_savings_events_attempt_type
        UNIQUE (attempt_id, event_type),
    CONSTRAINT ck_savings_events_type
        CHECK (event_type IN ('POTENTIAL', 'SELF_REPORTED', 'VERIFIED', 'REVERSED')),
    CONSTRAINT ck_savings_events_reversal
        CHECK (
            (event_type = 'REVERSED'
                AND reversal_reason IN ('DEBIT_OCCURRED', 'ABANDONED'))
            OR
            (event_type <> 'REVERSED' AND reversal_reason IS NULL)
        ),
    CONSTRAINT ck_savings_events_amount
        CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
    CONSTRAINT ck_savings_events_currency
        CHECK (currency = upper(currency) AND char_length(currency) = 3),
    CONSTRAINT ck_savings_events_period
        CHECK (period_end >= period_start),
    CONSTRAINT ck_savings_events_method
        CHECK (method = 'CANCEL')
);

CREATE INDEX idx_savings_events_attempt
    ON savings_events (attempt_id, created_at, id);

CREATE TABLE cancellation_guide_feedback (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    household_id UUID NOT NULL,
    commitment_id UUID NOT NULL,
    guide_id UUID NOT NULL,
    guide_version INTEGER NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    note VARCHAR(500) NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_cancellation_guide_feedback_owner_household
        FOREIGN KEY (household_id, owner_user_id)
            REFERENCES households (id, owner_user_id) ON DELETE CASCADE,
    CONSTRAINT fk_cancellation_guide_feedback_commitment
        FOREIGN KEY (household_id, commitment_id)
            REFERENCES recurring_commitments (household_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_cancellation_guide_feedback_guide
        FOREIGN KEY (guide_id, guide_version)
            REFERENCES cancellation_guide_versions (guide_id, version) ON DELETE RESTRICT,
    CONSTRAINT ck_cancellation_guide_feedback_outcome
        CHECK (outcome IN ('WORKED', 'OUTDATED', 'MERCHANT_CHANGED_FLOW', 'UNSAFE_LINK')),
    CONSTRAINT ck_cancellation_guide_feedback_note
        CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500)
);

CREATE INDEX idx_cancellation_guide_feedback_unsafe
    ON cancellation_guide_feedback (
        owner_user_id, guide_id, guide_version, outcome, created_at, id
    );

INSERT INTO merchants (
    id, canonical_name, normalized_name, category, country_code, website_host, created_at
) VALUES
    ('10000000-0000-4000-8000-000000000004', 'Demo Service 04', 'demo service 04', 'SUBSCRIPTION', 'IN', 'service04.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000005', 'Demo Service 05', 'demo service 05', 'MEMBERSHIP', 'IN', 'service05.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000006', 'Demo Service 06', 'demo service 06', 'SOFTWARE', 'IN', 'service06.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000007', 'Demo Service 07', 'demo service 07', 'SUBSCRIPTION', 'IN', 'service07.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000008', 'Demo Service 08', 'demo service 08', 'MEMBERSHIP', 'IN', 'service08.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000009', 'Demo Service 09', 'demo service 09', 'SOFTWARE', 'IN', 'service09.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000010', 'Demo Service 10', 'demo service 10', 'SUBSCRIPTION', 'IN', 'service10.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000011', 'Demo Service 11', 'demo service 11', 'MEMBERSHIP', 'IN', 'service11.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000012', 'Demo Service 12', 'demo service 12', 'SOFTWARE', 'IN', 'service12.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000013', 'Demo Service 13', 'demo service 13', 'SUBSCRIPTION', 'IN', 'service13.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000014', 'Demo Service 14', 'demo service 14', 'MEMBERSHIP', 'IN', 'service14.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000015', 'Demo Service 15', 'demo service 15', 'SOFTWARE', 'IN', 'service15.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000016', 'Demo Service 16', 'demo service 16', 'SUBSCRIPTION', 'IN', 'service16.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000017', 'Demo Service 17', 'demo service 17', 'MEMBERSHIP', 'IN', 'service17.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000018', 'Demo Service 18', 'demo service 18', 'SOFTWARE', 'IN', 'service18.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000019', 'Demo Service 19', 'demo service 19', 'SUBSCRIPTION', 'IN', 'service19.example', CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000020', 'Demo Service 20', 'demo service 20', 'MEMBERSHIP', 'IN', 'service20.example', CURRENT_TIMESTAMP);

INSERT INTO cancellation_guides (id, merchant_id, created_at) VALUES
    ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000009', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000010', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000011', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000012', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000013', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000014', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000015', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000016', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000017', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000018', '10000000-0000-4000-8000-000000000018', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000019', '10000000-0000-4000-8000-000000000019', CURRENT_TIMESTAMP),
    ('40000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000020', CURRENT_TIMESTAMP);

INSERT INTO cancellation_guide_versions (
    guide_id, version, status, risk_notice, structural_reviewed_at,
    review_interval_days, published_at, created_at
)
SELECT
    id,
    1,
    'PUBLISHED',
    'Fictional local guidance only. Complete every final action in the demo provider or payment application and never enter a PIN, OTP, password, or payment credential in AutoPay Guard.',
    TIMESTAMP WITH TIME ZONE '2026-07-27 00:00:00+00:00',
    60,
    TIMESTAMP WITH TIME ZONE '2026-07-27 00:00:00+00:00',
    CURRENT_TIMESTAMP
FROM cancellation_guides;

INSERT INTO cancellation_target_allowlist (
    target_key, action_type, scheme, host, path_prefix, enabled, created_at
)
SELECT
    'https-' || replace(m.website_host, '.', '-'),
    'SAFE_LINK',
    'https',
    m.website_host,
    '/manage/',
    TRUE,
    CURRENT_TIMESTAMP
FROM cancellation_guides g
JOIN merchants m ON m.id = g.merchant_id;

INSERT INTO cancellation_target_allowlist (
    target_key, action_type, scheme, host, path_prefix, enabled, created_at
) VALUES (
    'demo-mandates',
    'APP_DEEP_LINK',
    'autopayguard-demo',
    'mandates',
    '/service/',
    TRUE,
    CURRENT_TIMESTAMP
);

INSERT INTO cancellation_guide_steps (
    guide_id, guide_version, track, sequence_number, action_type,
    title, instruction, target_key, target_uri
)
SELECT
    g.id,
    1,
    'SERVICE',
    1,
    'INFORMATION',
    'Review the service separately',
    'Review the fictional service terms and confirm what access or benefits would end. Do not enter credentials in AutoPay Guard.',
    NULL,
    NULL
FROM cancellation_guides g;

-- The published catalog is append-only. These lock rows deliberately have no
-- application repository or API. Their full-row foreign keys make an in-place
-- UPDATE or DELETE of any seeded guide, published version, step, or target fail
-- at the database boundary on both PostgreSQL and H2. A future publication
-- workflow must insert a new version and its matching lock rows.
ALTER TABLE cancellation_guides
    ADD CONSTRAINT uq_cancellation_guides_lockable
        UNIQUE (id, merchant_id, created_at);

CREATE TABLE cancellation_guide_locks (
    guide_id UUID PRIMARY KEY,
    merchant_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_cancellation_guide_locks_snapshot
        FOREIGN KEY (guide_id, merchant_id, created_at)
            REFERENCES cancellation_guides (id, merchant_id, created_at)
);

INSERT INTO cancellation_guide_locks (guide_id, merchant_id, created_at)
SELECT id, merchant_id, created_at
FROM cancellation_guides;

ALTER TABLE cancellation_guide_versions
    ADD CONSTRAINT uq_guide_versions_lockable
        UNIQUE (
            guide_id, version, status, risk_notice, structural_reviewed_at,
            review_interval_days, published_at, created_at
        );

CREATE TABLE cancellation_published_version_locks (
    guide_id UUID NOT NULL,
    version INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL,
    risk_notice VARCHAR(1000) NOT NULL,
    structural_reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    review_interval_days INTEGER NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (guide_id, version),
    CONSTRAINT fk_published_version_locks_snapshot
        FOREIGN KEY (
            guide_id, version, status, risk_notice, structural_reviewed_at,
            review_interval_days, published_at, created_at
        ) REFERENCES cancellation_guide_versions (
            guide_id, version, status, risk_notice, structural_reviewed_at,
            review_interval_days, published_at, created_at
        ),
    CONSTRAINT ck_published_version_locks_status
        CHECK (status = 'PUBLISHED')
);

INSERT INTO cancellation_published_version_locks (
    guide_id, version, status, risk_notice, structural_reviewed_at,
    review_interval_days, published_at, created_at
)
SELECT
    guide_id, version, status, risk_notice, structural_reviewed_at,
    review_interval_days, published_at, created_at
FROM cancellation_guide_versions
WHERE status = 'PUBLISHED';

ALTER TABLE cancellation_guide_steps
    ADD CONSTRAINT uq_guide_steps_lockable
        UNIQUE (
            guide_id, guide_version, track, sequence_number,
            action_type, title, instruction
        );

ALTER TABLE cancellation_guide_steps
    ADD CONSTRAINT uq_guide_step_targets_lockable
        UNIQUE (
            guide_id, guide_version, track, sequence_number,
            action_type, title, instruction, target_key, target_uri
        );

CREATE TABLE cancellation_published_step_locks (
    guide_id UUID NOT NULL,
    guide_version INTEGER NOT NULL,
    track VARCHAR(24) NOT NULL,
    sequence_number INTEGER NOT NULL,
    action_type VARCHAR(24) NOT NULL,
    title VARCHAR(160) NOT NULL,
    instruction VARCHAR(1000) NOT NULL,
    PRIMARY KEY (guide_id, guide_version, track, sequence_number),
    CONSTRAINT fk_published_step_locks_snapshot
        FOREIGN KEY (
            guide_id, guide_version, track, sequence_number,
            action_type, title, instruction
        ) REFERENCES cancellation_guide_steps (
            guide_id, guide_version, track, sequence_number,
            action_type, title, instruction
        )
);

INSERT INTO cancellation_published_step_locks (
    guide_id, guide_version, track, sequence_number,
    action_type, title, instruction
)
SELECT
    s.guide_id, s.guide_version, s.track, s.sequence_number,
    s.action_type, s.title, s.instruction
FROM cancellation_guide_steps s
JOIN cancellation_guide_versions v
  ON v.guide_id = s.guide_id
 AND v.version = s.guide_version
WHERE v.status = 'PUBLISHED';

CREATE TABLE cancellation_published_target_locks (
    guide_id UUID NOT NULL,
    guide_version INTEGER NOT NULL,
    track VARCHAR(24) NOT NULL,
    sequence_number INTEGER NOT NULL,
    action_type VARCHAR(24) NOT NULL,
    title VARCHAR(160) NOT NULL,
    instruction VARCHAR(1000) NOT NULL,
    target_key VARCHAR(100) NOT NULL,
    target_uri VARCHAR(1000) NOT NULL,
    PRIMARY KEY (guide_id, guide_version, track, sequence_number),
    CONSTRAINT fk_published_target_locks_snapshot
        FOREIGN KEY (
            guide_id, guide_version, track, sequence_number,
            action_type, title, instruction, target_key, target_uri
        ) REFERENCES cancellation_guide_steps (
            guide_id, guide_version, track, sequence_number,
            action_type, title, instruction, target_key, target_uri
        )
);

INSERT INTO cancellation_published_target_locks (
    guide_id, guide_version, track, sequence_number,
    action_type, title, instruction, target_key, target_uri
)
SELECT
    s.guide_id, s.guide_version, s.track, s.sequence_number,
    s.action_type, s.title, s.instruction, s.target_key, s.target_uri
FROM cancellation_guide_steps s
JOIN cancellation_guide_versions v
  ON v.guide_id = s.guide_id
 AND v.version = s.guide_version
WHERE v.status = 'PUBLISHED'
  AND s.target_key IS NOT NULL;

ALTER TABLE cancellation_target_allowlist
    ADD CONSTRAINT uq_cancellation_targets_lockable
        UNIQUE (
            target_key, action_type, scheme, host, path_prefix, enabled, created_at
        );

CREATE TABLE cancellation_target_locks (
    target_key VARCHAR(100) PRIMARY KEY,
    action_type VARCHAR(24) NOT NULL,
    scheme VARCHAR(32) NOT NULL,
    host VARCHAR(253) NOT NULL,
    path_prefix VARCHAR(300) NOT NULL,
    enabled BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_cancellation_target_locks_snapshot
        FOREIGN KEY (
            target_key, action_type, scheme, host, path_prefix, enabled, created_at
        ) REFERENCES cancellation_target_allowlist (
            target_key, action_type, scheme, host, path_prefix, enabled, created_at
        )
);

INSERT INTO cancellation_target_locks (
    target_key, action_type, scheme, host, path_prefix, enabled, created_at
)
SELECT
    target_key, action_type, scheme, host, path_prefix, enabled, created_at
FROM cancellation_target_allowlist;

INSERT INTO cancellation_guide_steps (
    guide_id, guide_version, track, sequence_number, action_type,
    title, instruction, target_key, target_uri
)
SELECT
    g.id,
    1,
    'SERVICE',
    2,
    'SAFE_LINK',
    'Open the fictional service page',
    'After an explicit user gesture, open the reserved .example page and complete the final service action there.',
    'https-' || replace(m.website_host, '.', '-'),
    'https://' || m.website_host || '/manage/subscription'
FROM cancellation_guides g
JOIN merchants m ON m.id = g.merchant_id;

INSERT INTO cancellation_guide_steps (
    guide_id, guide_version, track, sequence_number, action_type,
    title, instruction, target_key, target_uri
)
SELECT
    g.id,
    1,
    'PAYMENT_MANDATE',
    1,
    'INFORMATION',
    'Review the payment instruction separately',
    'Service cancellation and payment-mandate action are separate. Confirm the payment instruction in the relevant external demo application.',
    NULL,
    NULL
FROM cancellation_guides g;

INSERT INTO cancellation_guide_steps (
    guide_id, guide_version, track, sequence_number, action_type,
    title, instruction, target_key, target_uri
)
SELECT
    g.id,
    1,
    'PAYMENT_MANDATE',
    2,
    'APP_DEEP_LINK',
    'Open the fictional mandate screen',
    'After an explicit user gesture, open the non-production demo mandate screen and complete any final action there.',
    'demo-mandates',
    'autopayguard-demo://mandates/service/manage'
FROM cancellation_guides g;

INSERT INTO cancellation_published_step_locks (
    guide_id, guide_version, track, sequence_number,
    action_type, title, instruction
)
SELECT
    s.guide_id, s.guide_version, s.track, s.sequence_number,
    s.action_type, s.title, s.instruction
FROM cancellation_guide_steps s
JOIN cancellation_guide_versions v
  ON v.guide_id = s.guide_id
 AND v.version = s.guide_version
WHERE v.status = 'PUBLISHED'
  AND NOT EXISTS (
      SELECT 1
      FROM cancellation_published_step_locks l
      WHERE l.guide_id = s.guide_id
        AND l.guide_version = s.guide_version
        AND l.track = s.track
        AND l.sequence_number = s.sequence_number
  );

INSERT INTO cancellation_published_target_locks (
    guide_id, guide_version, track, sequence_number,
    action_type, title, instruction, target_key, target_uri
)
SELECT
    s.guide_id, s.guide_version, s.track, s.sequence_number,
    s.action_type, s.title, s.instruction, s.target_key, s.target_uri
FROM cancellation_guide_steps s
JOIN cancellation_guide_versions v
  ON v.guide_id = s.guide_id
 AND v.version = s.guide_version
WHERE v.status = 'PUBLISHED'
  AND s.target_key IS NOT NULL;
