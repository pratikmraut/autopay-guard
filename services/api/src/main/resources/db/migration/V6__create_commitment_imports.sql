CREATE TABLE commitment_import_jobs (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL,
    owner_user_id UUID NOT NULL,
    status VARCHAR(24) NOT NULL,
    raw_payload BYTEA NULL,
    raw_byte_count INTEGER NOT NULL,
    content_fingerprint VARCHAR(64) NOT NULL,
    preview_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    raw_processed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    total_item_count INTEGER NOT NULL,
    valid_item_count INTEGER NOT NULL,
    invalid_item_count INTEGER NOT NULL,
    duplicate_item_count INTEGER NOT NULL,
    selected_item_count INTEGER NOT NULL DEFAULT 0,
    created_commitment_count INTEGER NOT NULL DEFAULT 0,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    confirmed_at TIMESTAMP WITH TIME ZONE NULL,
    discarded_at TIMESTAMP WITH TIME ZONE NULL,
    expired_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_commitment_import_jobs_owner_household
        FOREIGN KEY (household_id, owner_user_id)
            REFERENCES households (id, owner_user_id) ON DELETE CASCADE,
    CONSTRAINT uq_commitment_import_jobs_owner_id
        UNIQUE (owner_user_id, id),
    CONSTRAINT ck_commitment_import_jobs_status
        CHECK (
            status IN ('PREVIEW_READY', 'CONFIRMED', 'DISCARDED', 'EXPIRED')
        ),
    CONSTRAINT ck_commitment_import_jobs_fingerprint
        CHECK (char_length(content_fingerprint) = 64),
    CONSTRAINT ck_commitment_import_jobs_raw_size
        CHECK (raw_byte_count BETWEEN 1 AND 262144),
    CONSTRAINT ck_commitment_import_jobs_counts
        CHECK (
            total_item_count BETWEEN 1 AND 100
            AND valid_item_count BETWEEN 0 AND total_item_count
            AND invalid_item_count BETWEEN 0 AND total_item_count
            AND valid_item_count + invalid_item_count = total_item_count
            AND duplicate_item_count BETWEEN 0 AND valid_item_count
            AND selected_item_count BETWEEN 0 AND valid_item_count
            AND created_commitment_count BETWEEN 0 AND selected_item_count
        ),
    CONSTRAINT ck_commitment_import_jobs_preview_lifecycle
        CHECK (
            preview_expires_at > created_at
            AND preview_expires_at <= created_at + INTERVAL '1' DAY
            AND (
                (
                    status = 'PREVIEW_READY'
                    AND raw_payload IS NULL
                    AND raw_processed_at IS NOT NULL
                    AND confirmed_at IS NULL
                    AND discarded_at IS NULL
                    AND expired_at IS NULL
                    AND selected_item_count = 0
                    AND created_commitment_count = 0
                )
                OR
                (
                    status = 'CONFIRMED'
                    AND raw_payload IS NULL
                    AND raw_processed_at IS NOT NULL
                    AND confirmed_at IS NOT NULL
                    AND discarded_at IS NULL
                    AND expired_at IS NULL
                    AND selected_item_count = created_commitment_count
                    AND selected_item_count > 0
                )
                OR
                (
                    status = 'DISCARDED'
                    AND raw_payload IS NULL
                    AND raw_processed_at IS NOT NULL
                    AND confirmed_at IS NULL
                    AND discarded_at IS NOT NULL
                    AND expired_at IS NULL
                    AND selected_item_count = 0
                    AND created_commitment_count = 0
                )
                OR
                (
                    status = 'EXPIRED'
                    AND raw_payload IS NULL
                    AND raw_processed_at IS NOT NULL
                    AND confirmed_at IS NULL
                    AND discarded_at IS NULL
                    AND expired_at IS NOT NULL
                    AND selected_item_count = 0
                    AND created_commitment_count = 0
                )
            )
        ),
    CONSTRAINT ck_commitment_import_jobs_version
        CHECK (optimistic_version >= 0)
);

CREATE INDEX idx_commitment_import_jobs_owner_created
    ON commitment_import_jobs (owner_user_id, created_at DESC, id);

CREATE INDEX idx_commitment_import_jobs_expiry
    ON commitment_import_jobs (status, preview_expires_at, id);

CREATE TABLE commitment_import_items (
    id UUID PRIMARY KEY,
    import_job_id UUID NOT NULL,
    row_number INTEGER NOT NULL,
    valid BOOLEAN NOT NULL,
    duplicate_kind VARCHAR(16) NULL,
    schedule_fingerprint VARCHAR(64) NULL,
    name VARCHAR(160) NULL,
    category VARCHAR(40) NULL,
    amount_minor BIGINT NULL,
    currency VARCHAR(3) NULL,
    frequency VARCHAR(24) NULL,
    next_due_date DATE NULL,
    month_day_policy VARCHAR(16) NULL,
    payment_rail VARCHAR(40) NULL,
    masked_payment_label VARCHAR(64) NULL,
    merchant_id UUID NULL,
    selected BOOLEAN NULL,
    created_commitment_id UUID NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_commitment_import_items_job
        FOREIGN KEY (import_job_id)
            REFERENCES commitment_import_jobs (id) ON DELETE CASCADE,
    CONSTRAINT fk_commitment_import_items_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE SET NULL,
    CONSTRAINT uq_commitment_import_items_job_row
        UNIQUE (import_job_id, row_number),
    CONSTRAINT uq_commitment_import_items_job_id
        UNIQUE (import_job_id, id),
    CONSTRAINT uq_commitment_import_items_created_commitment
        UNIQUE (created_commitment_id),
    CONSTRAINT ck_commitment_import_items_row
        CHECK (row_number BETWEEN 2 AND 101),
    CONSTRAINT ck_commitment_import_items_valid_state
        CHECK (
            (
                valid = TRUE
                AND duplicate_kind IS NOT NULL
                AND duplicate_kind IN ('NONE', 'IN_FILE', 'EXISTING')
                AND schedule_fingerprint IS NOT NULL
                AND char_length(schedule_fingerprint) = 64
                AND name IS NOT NULL
                AND char_length(trim(name)) BETWEEN 1 AND 160
                AND category IS NOT NULL
                AND category IN (
                    'SUBSCRIPTION', 'UTILITY', 'MEMBERSHIP', 'SOFTWARE',
                    'EMI_LOAN', 'INSURANCE', 'INVESTMENT_COMMITMENT',
                    'EDUCATION', 'OTHER'
                )
                AND amount_minor IS NOT NULL
                AND amount_minor BETWEEN 1 AND 999999999999
                AND currency IS NOT NULL
                AND currency = upper(currency)
                AND char_length(currency) = 3
                AND frequency IS NOT NULL
                AND frequency IN (
                    'WEEKLY', 'MONTHLY', 'QUARTERLY',
                    'HALF_YEARLY', 'YEARLY'
                )
                AND next_due_date IS NOT NULL
                AND month_day_policy IS NOT NULL
                AND month_day_policy IN ('ANCHOR_DAY', 'LAST_DAY')
                AND payment_rail IS NOT NULL
                AND payment_rail IN (
                    'UPI_AUTOPAY', 'CARD_RECURRING', 'NACH_ENACH',
                    'APP_STORE', 'MERCHANT_DIRECT', 'CASH_OR_MANUAL',
                    'UNKNOWN'
                )
            )
            OR
            (
                valid = FALSE
                AND duplicate_kind IS NULL
                AND schedule_fingerprint IS NULL
                AND name IS NULL
                AND category IS NULL
                AND amount_minor IS NULL
                AND currency IS NULL
                AND frequency IS NULL
                AND next_due_date IS NULL
                AND month_day_policy IS NULL
                AND payment_rail IS NULL
                AND masked_payment_label IS NULL
                AND merchant_id IS NULL
                AND selected IS NULL
                AND created_commitment_id IS NULL
            )
        ),
    CONSTRAINT ck_commitment_import_items_result
        CHECK (
            (selected IS NULL AND created_commitment_id IS NULL)
            OR (selected = FALSE AND created_commitment_id IS NULL)
            OR (selected = TRUE AND created_commitment_id IS NOT NULL)
        )
);

CREATE INDEX idx_commitment_import_items_job_row
    ON commitment_import_items (import_job_id, row_number, id);

CREATE INDEX idx_commitment_import_items_fingerprint
    ON commitment_import_items (import_job_id, schedule_fingerprint);

CREATE TABLE commitment_import_item_errors (
    import_item_id UUID NOT NULL,
    sequence_number INTEGER NOT NULL,
    error_code VARCHAR(48) NOT NULL,
    PRIMARY KEY (import_item_id, sequence_number),
    CONSTRAINT fk_commitment_import_item_errors_item
        FOREIGN KEY (import_item_id)
            REFERENCES commitment_import_items (id) ON DELETE CASCADE,
    CONSTRAINT ck_commitment_import_item_errors_sequence
        CHECK (sequence_number BETWEEN 1 AND 16),
    CONSTRAINT ck_commitment_import_item_errors_code
        CHECK (
            error_code IN (
                'NAME_INVALID', 'NAME_SENSITIVE',
                'CATEGORY_INVALID', 'AMOUNT_INVALID',
                'CURRENCY_INVALID', 'FREQUENCY_INVALID',
                'NEXT_DUE_DATE_INVALID', 'PAYMENT_RAIL_INVALID',
                'MASKED_LABEL_INVALID', 'MASKED_LABEL_SENSITIVE'
            )
        )
);

ALTER TABLE recurring_commitments
    ADD COLUMN import_job_id UUID NULL;

ALTER TABLE recurring_commitments
    ADD COLUMN import_item_id UUID NULL;

ALTER TABLE recurring_commitments
    ADD COLUMN import_fingerprint VARCHAR(64) NULL;

ALTER TABLE recurring_commitments
    DROP CONSTRAINT ck_recurring_commitments_source;

ALTER TABLE recurring_commitments
    ADD CONSTRAINT ck_recurring_commitments_source
        CHECK (
            source_confidence IS NULL
            AND (
                (
                    source = 'MANUAL'
                    AND import_job_id IS NULL
                    AND import_item_id IS NULL
                    AND import_fingerprint IS NULL
                )
                OR
                (
                    source = 'CSV'
                    AND import_job_id IS NOT NULL
                    AND import_item_id IS NOT NULL
                    AND char_length(import_fingerprint) = 64
                )
            )
        );

ALTER TABLE recurring_commitments
    ADD CONSTRAINT fk_recurring_commitments_import_job
        FOREIGN KEY (import_job_id)
            REFERENCES commitment_import_jobs (id) ON DELETE RESTRICT;

ALTER TABLE recurring_commitments
    ADD CONSTRAINT fk_recurring_commitments_import_item
        FOREIGN KEY (import_job_id, import_item_id)
            REFERENCES commitment_import_items (import_job_id, id) ON DELETE RESTRICT;

ALTER TABLE recurring_commitments
    ADD CONSTRAINT uq_recurring_commitments_import_item
        UNIQUE (import_item_id);

ALTER TABLE commitment_import_items
    ADD CONSTRAINT fk_commitment_import_items_created_commitment
        FOREIGN KEY (created_commitment_id)
            REFERENCES recurring_commitments (id) ON DELETE SET NULL;

ALTER TABLE privacy_export_artifacts
    DROP CONSTRAINT ck_privacy_export_artifacts_schema;

ALTER TABLE privacy_export_artifacts
    ADD CONSTRAINT ck_privacy_export_artifacts_schema
        CHECK (
            schema_version IN (
                'autopay-guard-export-v1',
                'autopay-guard-export-v2'
            )
        );

ALTER TABLE m5_idempotency_records
    DROP CONSTRAINT ck_m5_idempotency_records_operation;

ALTER TABLE m5_idempotency_records
    ADD CONSTRAINT ck_m5_idempotency_records_operation
        CHECK (
            operation IN (
                'NOTICE_ACKNOWLEDGEMENT', 'INVITATION_ACCEPT',
                'CONSENT_EVENT', 'PRIVACY_REQUEST', 'PRIVACY_TRANSITION',
                'GUIDE_DRAFT_CREATE', 'GUIDE_PUBLISH', 'GUIDE_RETIRE',
                'FEEDBACK_REVIEW', 'IMPORT_CREATE', 'IMPORT_CONFIRM'
            )
        );

ALTER TABLE operation_rate_events
    DROP CONSTRAINT ck_operation_rate_events_operation;

ALTER TABLE operation_rate_events
    ADD CONSTRAINT ck_operation_rate_events_operation
        CHECK (
            operation IN (
                'INVITATION_CREATE', 'INVITATION_ACCEPT', 'PRIVACY_REQUEST',
                'GUIDE_PUBLISH', 'SUPPORT_GRANT', 'SUPPORT_DIAGNOSTIC',
                'IMPORT_CREATE', 'IMPORT_CONFIRM'
            )
        );

CREATE INDEX idx_operation_rate_events_cleanup
    ON operation_rate_events (occurred_at, id);

CREATE TABLE operation_rate_locks (
    actor_key VARCHAR(64) NOT NULL,
    operation VARCHAR(40) NOT NULL,
    touched_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (actor_key, operation),
    CONSTRAINT ck_operation_rate_locks_actor_key
        CHECK (char_length(actor_key) = 64),
    CONSTRAINT ck_operation_rate_locks_operation
        CHECK (
            operation IN (
                'INVITATION_CREATE', 'INVITATION_ACCEPT', 'PRIVACY_REQUEST',
                'GUIDE_PUBLISH', 'SUPPORT_GRANT', 'SUPPORT_DIAGNOSTIC',
                'IMPORT_CREATE', 'IMPORT_CONFIRM'
            )
        )
);

CREATE INDEX idx_operation_rate_locks_cleanup
    ON operation_rate_locks (touched_at, actor_key, operation);
