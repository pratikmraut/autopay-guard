ALTER TABLE users
    ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE NULL;

ALTER TABLE users
    ADD COLUMN deletion_protected BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET deletion_protected = TRUE
WHERE lower(email) = 'demo@autopayguard.local';

CREATE TABLE household_members (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL,
    removed_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_household_members_household
        FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
    CONSTRAINT fk_household_members_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_household_members_household_user
        UNIQUE (household_id, user_id),
    CONSTRAINT uq_household_members_household_id
        UNIQUE (household_id, id),
    CONSTRAINT ck_household_members_role
        CHECK (role IN ('OWNER', 'MEMBER')),
    CONSTRAINT ck_household_members_status
        CHECK (status IN ('ACTIVE', 'REMOVED')),
    CONSTRAINT ck_household_members_removed
        CHECK (
            (status = 'ACTIVE' AND removed_at IS NULL)
            OR (status = 'REMOVED' AND removed_at IS NOT NULL)
        ),
    CONSTRAINT ck_household_members_version
        CHECK (optimistic_version >= 0)
);

CREATE INDEX idx_household_members_user_status
    ON household_members (user_id, status, household_id, id);

INSERT INTO household_members (
    id, household_id, user_id, role, status, optimistic_version,
    joined_at, removed_at, created_at, updated_at
)
SELECT
    id,
    id,
    owner_user_id,
    'OWNER',
    'ACTIVE',
    0,
    created_at,
    NULL,
    created_at,
    updated_at
FROM households;

CREATE TABLE household_invitations (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL,
    invitee_email VARCHAR(320) NOT NULL,
    role VARCHAR(16) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    pending_key VARCHAR(700) NULL UNIQUE,
    status VARCHAR(16) NOT NULL,
    accepted_by_user_id UUID NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE NULL,
    revoked_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_household_invitations_household
        FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
    CONSTRAINT fk_household_invitations_acceptor
        FOREIGN KEY (accepted_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_household_invitations_email
        CHECK (
            invitee_email = lower(invitee_email)
            AND char_length(trim(invitee_email)) BETWEEN 3 AND 320
        ),
    CONSTRAINT ck_household_invitations_role
        CHECK (role = 'MEMBER'),
    CONSTRAINT ck_household_invitations_token_hash
        CHECK (char_length(token_hash) = 64),
    CONSTRAINT ck_household_invitations_status
        CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
    CONSTRAINT ck_household_invitations_pending_key
        CHECK (
            (status = 'PENDING' AND pending_key IS NOT NULL)
            OR (status <> 'PENDING' AND pending_key IS NULL)
        ),
    CONSTRAINT ck_household_invitations_terminal_state
        CHECK (
            (
                status = 'PENDING'
                AND accepted_by_user_id IS NULL
                AND accepted_at IS NULL
                AND revoked_at IS NULL
            )
            OR
            (
                status = 'ACCEPTED'
                AND accepted_by_user_id IS NOT NULL
                AND accepted_at IS NOT NULL
                AND revoked_at IS NULL
            )
            OR
            (
                status = 'REVOKED'
                AND accepted_by_user_id IS NULL
                AND accepted_at IS NULL
                AND revoked_at IS NOT NULL
            )
            OR
            (
                status = 'EXPIRED'
                AND accepted_by_user_id IS NULL
                AND accepted_at IS NULL
                AND revoked_at IS NULL
            )
        ),
    CONSTRAINT ck_household_invitations_expiry
        CHECK (
            expires_at = created_at + INTERVAL '1' DAY
        ),
    CONSTRAINT ck_household_invitations_version
        CHECK (optimistic_version >= 0)
);

CREATE INDEX idx_household_invitations_household_status
    ON household_invitations (household_id, status, created_at, id);

CREATE INDEX idx_household_invitations_email_status
    ON household_invitations (invitee_email, status, expires_at, id);

ALTER TABLE recurring_commitments
    ADD COLUMN data_owner_user_id UUID NULL;

ALTER TABLE recurring_commitments
    ADD COLUMN responsible_member_id UUID NULL;

UPDATE recurring_commitments c
SET data_owner_user_id = (
    SELECT h.owner_user_id
    FROM households h
    WHERE h.id = c.household_id
);

ALTER TABLE recurring_commitments
    ALTER COLUMN data_owner_user_id SET NOT NULL;

ALTER TABLE recurring_commitments
    ADD CONSTRAINT fk_recurring_commitments_data_owner
        FOREIGN KEY (household_id, data_owner_user_id)
            REFERENCES household_members (household_id, user_id) ON DELETE RESTRICT;

ALTER TABLE recurring_commitments
    ADD CONSTRAINT fk_recurring_commitments_responsible_member
        FOREIGN KEY (household_id, responsible_member_id)
            REFERENCES household_members (household_id, id) ON DELETE RESTRICT;

ALTER TABLE recurring_commitments
    DROP CONSTRAINT ck_recurring_commitments_visibility;

ALTER TABLE recurring_commitments
    ADD CONSTRAINT ck_recurring_commitments_visibility
        CHECK (visibility IN ('PRIVATE', 'HOUSEHOLD'));

CREATE INDEX idx_recurring_commitments_visible
    ON recurring_commitments (
        household_id, visibility, status, next_due_date, created_at, id
    );

CREATE TABLE privacy_notice_acknowledgements (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    notice_version VARCHAR(64) NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_privacy_notice_acknowledgements_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_privacy_notice_acknowledgements_version
        UNIQUE (user_id, notice_version),
    CONSTRAINT uq_privacy_notice_acknowledgements_lockable
        UNIQUE (
            id, user_id, notice_version, content_digest,
            event_type, acknowledged_at, created_at
        ),
    CONSTRAINT ck_privacy_notice_acknowledgements_version
        CHECK (char_length(trim(notice_version)) BETWEEN 1 AND 64),
    CONSTRAINT ck_privacy_notice_acknowledgements_digest
        CHECK (char_length(content_digest) = 64),
    CONSTRAINT ck_privacy_notice_acknowledgements_type
        CHECK (event_type = 'ACKNOWLEDGED')
);

CREATE TABLE privacy_notice_acknowledgement_locks (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    notice_version VARCHAR(64) NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_privacy_notice_acknowledgement_locks_snapshot
        FOREIGN KEY (
            id, user_id, notice_version, content_digest,
            event_type, acknowledged_at, created_at
        ) REFERENCES privacy_notice_acknowledgements (
            id, user_id, notice_version, content_digest,
            event_type, acknowledged_at, created_at
        )
);

INSERT INTO privacy_notice_acknowledgements (
    id, user_id, notice_version, content_digest,
    event_type, acknowledged_at, created_at
)
SELECT
    id,
    id,
    privacy_notice_version,
    'f44a66e435a10f110c1b2eff19abcf60f4978053205c9068c08c6a8bae74b244',
    'ACKNOWLEDGED',
    privacy_notice_accepted_at,
    privacy_notice_accepted_at
FROM users
WHERE privacy_notice_accepted_at IS NOT NULL
  AND privacy_notice_version IS NOT NULL;

INSERT INTO privacy_notice_acknowledgement_locks (
    id, user_id, notice_version, content_digest,
    event_type, acknowledged_at, created_at
)
SELECT
    id, user_id, notice_version, content_digest,
    event_type, acknowledged_at, created_at
FROM privacy_notice_acknowledgements;

CREATE TABLE consent_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    purpose VARCHAR(40) NOT NULL,
    purpose_version VARCHAR(64) NOT NULL,
    action VARCHAR(16) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_consent_events_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_consent_events_lockable
        UNIQUE (
            id, user_id, purpose, purpose_version,
            action, occurred_at, created_at
        ),
    CONSTRAINT ck_consent_events_purpose
        CHECK (purpose = 'HOUSEHOLD_SHARING'),
    CONSTRAINT ck_consent_events_version
        CHECK (char_length(trim(purpose_version)) BETWEEN 1 AND 64),
    CONSTRAINT ck_consent_events_action
        CHECK (action IN ('GRANTED', 'WITHDRAWN'))
);

CREATE INDEX idx_consent_events_user_purpose
    ON consent_events (user_id, purpose, occurred_at DESC, id);

CREATE TABLE consent_event_locks (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    purpose VARCHAR(40) NOT NULL,
    purpose_version VARCHAR(64) NOT NULL,
    action VARCHAR(16) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_consent_event_locks_snapshot
        FOREIGN KEY (
            id, user_id, purpose, purpose_version,
            action, occurred_at, created_at
        ) REFERENCES consent_events (
            id, user_id, purpose, purpose_version,
            action, occurred_at, created_at
        )
);

CREATE TABLE privacy_requests (
    id UUID PRIMARY KEY,
    requester_user_id UUID NOT NULL,
    request_type VARCHAR(16) NOT NULL,
    status VARCHAR(24) NOT NULL,
    correction_field VARCHAR(32) NULL,
    correction_value VARCHAR(64) NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT fk_privacy_requests_requester
        FOREIGN KEY (requester_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_privacy_requests_type
        CHECK (request_type IN ('EXPORT', 'CORRECTION', 'DELETION')),
    CONSTRAINT ck_privacy_requests_status
        CHECK (
            status IN (
                'REQUESTED', 'PROCESSING', 'READY', 'EXECUTED',
                'BLOCKED', 'EXPIRED', 'FAILED', 'CANCELLED'
            )
        ),
    CONSTRAINT ck_privacy_requests_correction
        CHECK (
            (
                request_type = 'CORRECTION'
                AND correction_field = 'TIMEZONE'
                AND char_length(trim(correction_value)) BETWEEN 1 AND 64
            )
            OR
            (
                request_type <> 'CORRECTION'
                AND correction_field IS NULL
                AND correction_value IS NULL
            )
        ),
    CONSTRAINT ck_privacy_requests_completion
        CHECK (
            (status IN ('READY', 'EXECUTED') AND completed_at IS NOT NULL)
            OR (status NOT IN ('READY', 'EXECUTED') AND completed_at IS NULL)
        ),
    CONSTRAINT ck_privacy_requests_version
        CHECK (optimistic_version >= 0)
);

CREATE INDEX idx_privacy_requests_requester_created
    ON privacy_requests (requester_user_id, created_at DESC, id);

CREATE INDEX idx_privacy_requests_admin_queue
    ON privacy_requests (request_type, status, created_at, id);

CREATE TABLE privacy_request_events (
    id UUID PRIMARY KEY,
    request_id UUID NOT NULL,
    actor_user_id UUID NOT NULL,
    from_status VARCHAR(24) NOT NULL,
    to_status VARCHAR(24) NOT NULL,
    reason_code VARCHAR(32) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_privacy_request_events_request
        FOREIGN KEY (request_id) REFERENCES privacy_requests (id) ON DELETE RESTRICT,
    CONSTRAINT fk_privacy_request_events_actor
        FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_privacy_request_events_lockable
        UNIQUE (
            id, request_id, actor_user_id, from_status,
            to_status, reason_code, occurred_at, created_at
        ),
    CONSTRAINT ck_privacy_request_events_from
        CHECK (
            from_status IN (
                'NONE',
                'REQUESTED', 'PROCESSING', 'READY', 'EXECUTED',
                'BLOCKED', 'EXPIRED', 'FAILED', 'CANCELLED'
            )
        ),
    CONSTRAINT ck_privacy_request_events_to
        CHECK (
            to_status IN (
                'REQUESTED', 'PROCESSING', 'READY', 'EXECUTED',
                'BLOCKED', 'EXPIRED', 'FAILED', 'CANCELLED'
            )
        ),
    CONSTRAINT ck_privacy_request_events_reason
        CHECK (
            reason_code IN (
                'NONE',
                'HOUSEHOLD_HAS_OTHER_MEMBERS', 'INVALID_TIMEZONE',
                'REQUESTER_CANCELLED', 'LOCAL_POLICY'
            )
        )
);

CREATE INDEX idx_privacy_request_events_request
    ON privacy_request_events (request_id, occurred_at, id);

CREATE TABLE privacy_request_event_locks (
    id UUID PRIMARY KEY,
    request_id UUID NOT NULL,
    actor_user_id UUID NOT NULL,
    from_status VARCHAR(24) NOT NULL,
    to_status VARCHAR(24) NOT NULL,
    reason_code VARCHAR(32) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_privacy_request_event_locks_snapshot
        FOREIGN KEY (
            id, request_id, actor_user_id, from_status,
            to_status, reason_code, occurred_at, created_at
        ) REFERENCES privacy_request_events (
            id, request_id, actor_user_id, from_status,
            to_status, reason_code, occurred_at, created_at
        )
);

CREATE TABLE privacy_export_artifacts (
    request_id UUID PRIMARY KEY,
    requester_user_id UUID NOT NULL,
    schema_version VARCHAR(32) NOT NULL,
    payload TEXT NULL,
    payload_sha256 VARCHAR(64) NOT NULL,
    byte_count BIGINT NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    purged_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT fk_privacy_export_artifacts_request
        FOREIGN KEY (request_id) REFERENCES privacy_requests (id) ON DELETE RESTRICT,
    CONSTRAINT fk_privacy_export_artifacts_requester
        FOREIGN KEY (requester_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_privacy_export_artifacts_schema
        CHECK (schema_version = 'autopay-guard-export-v1'),
    CONSTRAINT ck_privacy_export_artifacts_digest
        CHECK (char_length(payload_sha256) = 64),
    CONSTRAINT ck_privacy_export_artifacts_size
        CHECK (byte_count BETWEEN 2 AND 5242880),
    CONSTRAINT ck_privacy_export_artifacts_retention
        CHECK (
            expires_at > generated_at
            AND expires_at <= generated_at + INTERVAL '1' DAY
            AND (
                (purged_at IS NULL AND payload IS NOT NULL)
                OR (purged_at IS NOT NULL AND payload IS NULL)
            )
        )
);

CREATE INDEX idx_privacy_export_artifacts_expiry
    ON privacy_export_artifacts (expires_at, purged_at, request_id);

CREATE TABLE deletion_tombstones (
    subject_hash VARCHAR(64) PRIMARY KEY,
    execution_id UUID NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_deletion_tombstones_subject_hash
        CHECK (char_length(subject_hash) = 64)
);

CREATE TABLE cancellation_guide_catalog_state (
    guide_id UUID PRIMARY KEY,
    current_published_version INTEGER NULL,
    state VARCHAR(16) NOT NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_cancellation_guide_catalog_state_guide
        FOREIGN KEY (guide_id) REFERENCES cancellation_guides (id) ON DELETE RESTRICT,
    CONSTRAINT fk_cancellation_guide_catalog_state_version
        FOREIGN KEY (guide_id, current_published_version)
            REFERENCES cancellation_guide_versions (guide_id, version) ON DELETE RESTRICT,
    CONSTRAINT ck_cancellation_guide_catalog_state_state
        CHECK (state IN ('ACTIVE', 'RETIRED')),
    CONSTRAINT ck_cancellation_guide_catalog_state_current
        CHECK (
            (state = 'ACTIVE' AND current_published_version IS NOT NULL)
            OR (state = 'RETIRED' AND current_published_version IS NULL)
        ),
    CONSTRAINT ck_cancellation_guide_catalog_state_version
        CHECK (optimistic_version >= 0)
);

INSERT INTO cancellation_guide_catalog_state (
    guide_id, current_published_version, state, optimistic_version, updated_at
)
SELECT
    guide_id,
    MAX(version),
    'ACTIVE',
    0,
    CURRENT_TIMESTAMP
FROM cancellation_guide_versions
WHERE status = 'PUBLISHED'
GROUP BY guide_id;

CREATE TABLE cancellation_guide_draft_states (
    draft_id UUID NOT NULL UNIQUE,
    guide_id UUID NOT NULL,
    guide_version INTEGER NOT NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (guide_id, guide_version),
    CONSTRAINT fk_cancellation_guide_draft_states_version
        FOREIGN KEY (guide_id, guide_version)
            REFERENCES cancellation_guide_versions (guide_id, version) ON DELETE CASCADE,
    CONSTRAINT fk_cancellation_guide_draft_states_creator
        FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_cancellation_guide_draft_states_version
        CHECK (optimistic_version >= 0)
);

CREATE TABLE guide_lifecycle_events (
    id UUID PRIMARY KEY,
    guide_id UUID NOT NULL,
    guide_version INTEGER NOT NULL,
    actor_user_id UUID NOT NULL,
    action VARCHAR(24) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_guide_lifecycle_events_guide
        FOREIGN KEY (guide_id) REFERENCES cancellation_guides (id) ON DELETE RESTRICT,
    CONSTRAINT fk_guide_lifecycle_events_version
        FOREIGN KEY (guide_id, guide_version)
            REFERENCES cancellation_guide_versions (guide_id, version) ON DELETE RESTRICT,
    CONSTRAINT fk_guide_lifecycle_events_actor
        FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_guide_lifecycle_events_lockable
        UNIQUE (
            id, guide_id, guide_version, actor_user_id,
            action, occurred_at, created_at
        ),
    CONSTRAINT ck_guide_lifecycle_events_action
        CHECK (action IN ('DRAFT_CREATED', 'DRAFT_SAVED', 'PUBLISHED', 'RETIRED')),
    CONSTRAINT ck_guide_lifecycle_events_version
        CHECK (guide_version > 0)
);

CREATE TABLE guide_lifecycle_event_locks (
    id UUID PRIMARY KEY,
    guide_id UUID NOT NULL,
    guide_version INTEGER NOT NULL,
    actor_user_id UUID NOT NULL,
    action VARCHAR(24) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_guide_lifecycle_event_locks_snapshot
        FOREIGN KEY (
            id, guide_id, guide_version, actor_user_id,
            action, occurred_at, created_at
        ) REFERENCES guide_lifecycle_events (
            id, guide_id, guide_version, actor_user_id,
            action, occurred_at, created_at
        )
);

CREATE TABLE guide_feedback_reviews (
    feedback_id UUID PRIMARY KEY,
    disposition VARCHAR(24) NOT NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    reviewed_by_user_id UUID NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_guide_feedback_reviews_feedback
        FOREIGN KEY (feedback_id) REFERENCES cancellation_guide_feedback (id) ON DELETE RESTRICT,
    CONSTRAINT fk_guide_feedback_reviews_reviewer
        FOREIGN KEY (reviewed_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_guide_feedback_reviews_disposition
        CHECK (disposition IN ('PENDING', 'RESOLVED', 'DISMISSED')),
    CONSTRAINT ck_guide_feedback_reviews_reviewer
        CHECK (
            (disposition = 'PENDING' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
            OR
            (
                disposition IN ('RESOLVED', 'DISMISSED')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
        ),
    CONSTRAINT ck_guide_feedback_reviews_version
        CHECK (optimistic_version >= 0)
);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    actor_role VARCHAR(24) NOT NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(40) NOT NULL,
    resource_id UUID NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_audit_events_actor
        FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_audit_events_lockable
        UNIQUE (
            id, actor_user_id, actor_role, action, resource_type,
            resource_id, outcome, correlation_id, occurred_at, created_at
        ),
    CONSTRAINT ck_audit_events_actor_role
        CHECK (
            actor_role IN (
                'USER', 'GUIDE_ADMIN', 'PRIVACY_ADMIN',
                'AUDIT_READ', 'SUPPORT_READ'
            )
        ),
    CONSTRAINT ck_audit_events_action
        CHECK (char_length(trim(action)) BETWEEN 3 AND 64),
    CONSTRAINT ck_audit_events_resource_type
        CHECK (char_length(trim(resource_type)) BETWEEN 3 AND 40),
    CONSTRAINT ck_audit_events_outcome
        CHECK (outcome IN ('SUCCEEDED', 'DENIED')),
    CONSTRAINT ck_audit_events_correlation
        CHECK (
            char_length(correlation_id) BETWEEN 1 AND 64
            AND correlation_id NOT LIKE '% %'
        )
);

CREATE INDEX idx_audit_events_occurred
    ON audit_events (occurred_at DESC, id);

CREATE INDEX idx_audit_events_resource
    ON audit_events (resource_type, resource_id, occurred_at DESC, id);

CREATE TABLE audit_event_locks (
    id UUID PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    actor_role VARCHAR(24) NOT NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(40) NOT NULL,
    resource_id UUID NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_audit_event_locks_snapshot
        FOREIGN KEY (
            id, actor_user_id, actor_role, action, resource_type,
            resource_id, outcome, correlation_id, occurred_at, created_at
        ) REFERENCES audit_events (
            id, actor_user_id, actor_role, action, resource_type,
            resource_id, outcome, correlation_id, occurred_at, created_at
        )
);

CREATE TABLE support_diagnostic_grants (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    household_id UUID NOT NULL,
    code_hash VARCHAR(64) NOT NULL UNIQUE,
    active_key VARCHAR(36) NULL UNIQUE,
    status VARCHAR(16) NOT NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_support_diagnostic_grants_owner_household
        FOREIGN KEY (household_id, owner_user_id)
            REFERENCES households (id, owner_user_id) ON DELETE CASCADE,
    CONSTRAINT ck_support_diagnostic_grants_code_hash
        CHECK (char_length(code_hash) = 64),
    CONSTRAINT ck_support_diagnostic_grants_status
        CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
    CONSTRAINT ck_support_diagnostic_grants_active_key
        CHECK (
            (status = 'ACTIVE' AND active_key IS NOT NULL)
            OR (status <> 'ACTIVE' AND active_key IS NULL)
        ),
    CONSTRAINT ck_support_diagnostic_grants_state
        CHECK (
            (status = 'ACTIVE' AND revoked_at IS NULL)
            OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
            OR (status = 'EXPIRED' AND revoked_at IS NULL)
        ),
    CONSTRAINT ck_support_diagnostic_grants_expiry
        CHECK (
            expires_at > created_at
            AND expires_at <= created_at + INTERVAL '15' MINUTE
        ),
    CONSTRAINT ck_support_diagnostic_grants_version
        CHECK (optimistic_version >= 0)
);

CREATE INDEX idx_support_diagnostic_grants_owner
    ON support_diagnostic_grants (owner_user_id, status, expires_at, id);

CREATE TABLE m5_idempotency_records (
    actor_user_id UUID NOT NULL,
    operation VARCHAR(40) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    resource_id UUID NOT NULL,
    response_status INTEGER NOT NULL,
    response_body VARCHAR(20000) NULL,
    response_version BIGINT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (actor_user_id, operation, key_hash),
    CONSTRAINT fk_m5_idempotency_records_actor
        FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_m5_idempotency_records_operation
        CHECK (
            operation IN (
                'NOTICE_ACKNOWLEDGEMENT', 'INVITATION_ACCEPT',
                'CONSENT_EVENT', 'PRIVACY_REQUEST', 'PRIVACY_TRANSITION',
                'GUIDE_DRAFT_CREATE',
                'GUIDE_PUBLISH', 'GUIDE_RETIRE', 'FEEDBACK_REVIEW'
            )
        ),
    CONSTRAINT ck_m5_idempotency_records_key_hash
        CHECK (char_length(key_hash) = 64),
    CONSTRAINT ck_m5_idempotency_records_request_hash
        CHECK (char_length(request_hash) = 64),
    CONSTRAINT ck_m5_idempotency_records_status
        CHECK (response_status BETWEEN 200 AND 299),
    CONSTRAINT ck_m5_idempotency_records_version
        CHECK (response_version IS NULL OR response_version >= 0)
);

CREATE TABLE operation_rate_events (
    id UUID PRIMARY KEY,
    actor_key VARCHAR(64) NOT NULL,
    operation VARCHAR(40) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_operation_rate_events_actor_key
        CHECK (char_length(actor_key) = 64),
    CONSTRAINT ck_operation_rate_events_operation
        CHECK (
            operation IN (
                'INVITATION_CREATE', 'INVITATION_ACCEPT', 'PRIVACY_REQUEST',
                'GUIDE_PUBLISH', 'SUPPORT_GRANT', 'SUPPORT_DIAGNOSTIC'
            )
        )
);

CREATE INDEX idx_operation_rate_events_window
    ON operation_rate_events (actor_key, operation, occurred_at);
