ALTER TABLE households
    ADD CONSTRAINT uq_households_id_owner
        UNIQUE (id, owner_user_id);

ALTER TABLE recurring_commitments
    ADD CONSTRAINT uq_recurring_commitments_household_id
        UNIQUE (household_id, id);

CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL,
    in_app_enabled BOOLEAN NOT NULL,
    email_enabled BOOLEAN NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    quiet_hours_enabled BOOLEAN NOT NULL,
    quiet_start TIME NULL,
    quiet_end TIME NULL,
    enabled_at TIMESTAMP WITH TIME ZONE NULL,
    in_app_enabled_at TIMESTAMP WITH TIME ZONE NULL,
    email_enabled_at TIMESTAMP WITH TIME ZONE NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_notification_preferences_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_notification_preferences_timezone
        CHECK (char_length(trim(timezone)) BETWEEN 1 AND 64),
    CONSTRAINT ck_notification_preferences_quiet_pair
        CHECK (
            (quiet_start IS NULL AND quiet_end IS NULL)
            OR
            (quiet_start IS NOT NULL
                AND quiet_end IS NOT NULL
                AND quiet_start <> quiet_end)
        ),
    CONSTRAINT ck_notification_preferences_quiet_enabled
        CHECK (
            quiet_hours_enabled = FALSE
            OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL)
        ),
    CONSTRAINT ck_notification_preferences_version
        CHECK (optimistic_version >= 1)
);

CREATE TABLE reminder_rule_sets (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL,
    commitment_id UUID NULL,
    scope_type VARCHAR(16) NOT NULL,
    scope_reference_id UUID NOT NULL,
    mode VARCHAR(16) NOT NULL,
    activated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_reminder_rule_sets_household
        FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
    CONSTRAINT fk_reminder_rule_sets_commitment
        FOREIGN KEY (household_id, commitment_id)
            REFERENCES recurring_commitments (household_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_reminder_rule_sets_scope
        UNIQUE (household_id, scope_type, scope_reference_id),
    CONSTRAINT ck_reminder_rule_sets_scope
        CHECK (
            (
                scope_type = 'HOUSEHOLD'
                AND commitment_id IS NULL
                AND scope_reference_id = household_id
            )
            OR
            (
                scope_type = 'COMMITMENT'
                AND commitment_id IS NOT NULL
                AND scope_reference_id = commitment_id
            )
        ),
    CONSTRAINT ck_reminder_rule_sets_mode
        CHECK (
            (scope_type = 'HOUSEHOLD' AND mode IN ('CUSTOM', 'DISABLED'))
            OR
            (scope_type = 'COMMITMENT' AND mode IN ('INHERIT', 'CUSTOM', 'DISABLED'))
        ),
    CONSTRAINT ck_reminder_rule_sets_version
        CHECK (optimistic_version >= 1)
);

CREATE INDEX idx_reminder_rule_sets_household
    ON reminder_rule_sets (household_id, scope_type, scope_reference_id);

CREATE TABLE reminder_rules (
    id UUID PRIMARY KEY,
    rule_set_id UUID NOT NULL,
    channel VARCHAR(16) NOT NULL,
    offset_days INTEGER NOT NULL,
    local_send_time TIME NOT NULL,
    enabled BOOLEAN NOT NULL,
    activated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_reminder_rules_rule_set
        FOREIGN KEY (rule_set_id) REFERENCES reminder_rule_sets (id) ON DELETE CASCADE,
    CONSTRAINT uq_reminder_rules_channel_offset
        UNIQUE (rule_set_id, channel, offset_days),
    CONSTRAINT ck_reminder_rules_channel
        CHECK (channel IN ('IN_APP', 'EMAIL')),
    CONSTRAINT ck_reminder_rules_offset
        CHECK (offset_days BETWEEN 0 AND 90)
);

CREATE INDEX idx_reminder_rules_rule_set
    ON reminder_rules (rule_set_id, channel, offset_days);

CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    recipient_user_id UUID NOT NULL,
    household_id UUID NOT NULL,
    commitment_id UUID NOT NULL,
    occurrence_id UUID NULL,
    reminder_rule_id UUID NULL,
    scheduled_date DATE NOT NULL,
    channel VARCHAR(16) NOT NULL,
    offset_days INTEGER NOT NULL,
    planned_for TIMESTAMP WITH TIME ZONE NOT NULL,
    semantic_key VARCHAR(64) NOT NULL UNIQUE,
    read_at TIMESTAMP WITH TIME ZONE NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_notifications_owner_household
        FOREIGN KEY (household_id, recipient_user_id)
            REFERENCES households (id, owner_user_id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_commitment
        FOREIGN KEY (household_id, commitment_id)
            REFERENCES recurring_commitments (household_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_occurrence
        FOREIGN KEY (occurrence_id) REFERENCES commitment_occurrences (id) ON DELETE SET NULL,
    CONSTRAINT fk_notifications_rule
        FOREIGN KEY (reminder_rule_id) REFERENCES reminder_rules (id) ON DELETE SET NULL,
    CONSTRAINT uq_notifications_semantic
        UNIQUE (
            recipient_user_id,
            household_id,
            commitment_id,
            scheduled_date,
            channel,
            offset_days
        ),
    CONSTRAINT ck_notifications_channel
        CHECK (channel IN ('IN_APP', 'EMAIL')),
    CONSTRAINT ck_notifications_offset
        CHECK (offset_days BETWEEN 0 AND 90),
    CONSTRAINT ck_notifications_semantic_key
        CHECK (char_length(semantic_key) = 64),
    CONSTRAINT ck_notifications_version
        CHECK (optimistic_version >= 0)
);

CREATE INDEX idx_notifications_owner_created
    ON notifications (recipient_user_id, created_at, id);

CREATE INDEX idx_notifications_owner_unread
    ON notifications (recipient_user_id, read_at, created_at, id);

CREATE INDEX idx_notifications_planned
    ON notifications (planned_for, id);

CREATE TABLE notification_deliveries (
    id UUID PRIMARY KEY,
    notification_id UUID NOT NULL UNIQUE,
    status VARCHAR(24) NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP WITH TIME ZONE NOT NULL,
    lease_token UUID NULL,
    lease_until TIMESTAMP WITH TIME ZONE NULL,
    provider_message_id VARCHAR(200) NULL,
    failure_category VARCHAR(32) NULL,
    delivered_at TIMESTAMP WITH TIME ZONE NULL,
    suppressed_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_notification_deliveries_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE,
    CONSTRAINT ck_notification_deliveries_status
        CHECK (status IN (
            'PENDING', 'PROCESSING', 'DELIVERED', 'RETRY_SCHEDULED', 'DEAD', 'SUPPRESSED'
        )),
    CONSTRAINT ck_notification_deliveries_attempts
        CHECK (attempt_count >= 0),
    CONSTRAINT ck_notification_deliveries_lease_pair
        CHECK (
            (lease_token IS NULL AND lease_until IS NULL)
            OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)
        ),
    CONSTRAINT ck_notification_deliveries_failure
        CHECK (
            failure_category IS NULL
            OR failure_category IN (
                'PROVIDER_TRANSIENT', 'PROVIDER_PERMANENT', 'PROVIDER_TIMEOUT',
                'RECIPIENT_NOT_FAKE', 'DELIVERY_INVALIDATED', 'QUIET_HOURS_EXPIRED',
                'INTERNAL_PAYLOAD'
            )
        ),
    CONSTRAINT ck_notification_deliveries_terminal_time
        CHECK (
            (status = 'DELIVERED' AND delivered_at IS NOT NULL AND suppressed_at IS NULL)
            OR (status = 'SUPPRESSED' AND delivered_at IS NULL AND suppressed_at IS NOT NULL)
            OR (status NOT IN ('DELIVERED', 'SUPPRESSED')
                AND delivered_at IS NULL
                AND suppressed_at IS NULL)
        )
);

CREATE INDEX idx_notification_deliveries_claim
    ON notification_deliveries (status, available_at, lease_until, id);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    delivery_id UUID NOT NULL UNIQUE,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    event_type VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    available_at TIMESTAMP WITH TIME ZONE NOT NULL,
    lease_token UUID NULL,
    lease_until TIMESTAMP WITH TIME ZONE NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_failure_category VARCHAR(32) NULL,
    processed_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_outbox_events_delivery
        FOREIGN KEY (delivery_id) REFERENCES notification_deliveries (id) ON DELETE CASCADE,
    CONSTRAINT ck_outbox_events_idempotency_key
        CHECK (char_length(idempotency_key) = 64),
    CONSTRAINT ck_outbox_events_type
        CHECK (event_type = 'DELIVERY_REQUESTED'),
    CONSTRAINT ck_outbox_events_status
        CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD')),
    CONSTRAINT ck_outbox_events_attempts
        CHECK (attempt_count >= 0),
    CONSTRAINT ck_outbox_events_lease_pair
        CHECK (
            (lease_token IS NULL AND lease_until IS NULL)
            OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)
        ),
    CONSTRAINT ck_outbox_events_failure
        CHECK (
            last_failure_category IS NULL
            OR last_failure_category IN (
                'PROVIDER_TRANSIENT', 'PROVIDER_PERMANENT', 'PROVIDER_TIMEOUT',
                'RECIPIENT_NOT_FAKE', 'DELIVERY_INVALIDATED', 'QUIET_HOURS_EXPIRED',
                'INTERNAL_PAYLOAD'
            )
        ),
    CONSTRAINT ck_outbox_events_processed
        CHECK (
            (status = 'PROCESSED' AND processed_at IS NOT NULL)
            OR (status <> 'PROCESSED' AND processed_at IS NULL)
        )
);

CREATE INDEX idx_outbox_events_claim
    ON outbox_events (status, available_at, lease_until, id);
