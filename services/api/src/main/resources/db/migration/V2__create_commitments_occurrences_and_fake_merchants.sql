CREATE TABLE merchants (
    id UUID PRIMARY KEY,
    canonical_name VARCHAR(160) NOT NULL,
    normalized_name VARCHAR(160) NOT NULL UNIQUE,
    category VARCHAR(40) NOT NULL,
    country_code VARCHAR(2) NOT NULL,
    website_host VARCHAR(253) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_merchants_canonical_name
        CHECK (char_length(trim(canonical_name)) BETWEEN 1 AND 160),
    CONSTRAINT ck_merchants_normalized_name
        CHECK (char_length(trim(normalized_name)) BETWEEN 1 AND 160),
    CONSTRAINT ck_merchants_category
        CHECK (category IN (
            'SUBSCRIPTION', 'UTILITY', 'MEMBERSHIP', 'SOFTWARE', 'EMI_LOAN',
            'INSURANCE', 'INVESTMENT_COMMITMENT', 'EDUCATION', 'OTHER'
        )),
    CONSTRAINT ck_merchants_country_code
        CHECK (country_code = upper(country_code) AND char_length(country_code) = 2),
    CONSTRAINT ck_merchants_example_host
        CHECK (
            website_host = lower(website_host)
            AND lower(website_host) LIKE '%.example'
            AND char_length(website_host) BETWEEN 9 AND 253
            AND position('://' IN website_host) = 0
            AND position('/' IN website_host) = 0
            AND position('@' IN website_host) = 0
            AND position(':' IN website_host) = 0
            AND position(' ' IN website_host) = 0
            AND website_host NOT LIKE '.%'
            AND website_host NOT LIKE '%.'
        )
);

CREATE TABLE merchant_aliases (
    id UUID PRIMARY KEY,
    merchant_id UUID NOT NULL,
    alias VARCHAR(160) NOT NULL,
    normalized_alias VARCHAR(160) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_merchant_aliases_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE CASCADE,
    CONSTRAINT uq_merchant_aliases_normalized
        UNIQUE (merchant_id, normalized_alias),
    CONSTRAINT ck_merchant_aliases_alias
        CHECK (char_length(trim(alias)) BETWEEN 1 AND 160),
    CONSTRAINT ck_merchant_aliases_normalized
        CHECK (char_length(trim(normalized_alias)) BETWEEN 1 AND 160)
);

CREATE INDEX idx_merchant_aliases_search
    ON merchant_aliases (normalized_alias, merchant_id);

CREATE TABLE recurring_commitments (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL,
    merchant_id UUID NULL,
    display_name VARCHAR(160) NOT NULL,
    category VARCHAR(40) NOT NULL,
    payment_rail VARCHAR(40) NOT NULL,
    amount_minor BIGINT NULL,
    estimated_amount_minor BIGINT NULL,
    currency VARCHAR(3) NOT NULL,
    frequency VARCHAR(24) NOT NULL,
    interval_count INTEGER NOT NULL,
    custom_interval_unit VARCHAR(16) NULL,
    anchor_date DATE NOT NULL,
    month_day_policy VARCHAR(16) NOT NULL,
    next_due_date DATE NULL,
    variable_amount BOOLEAN NOT NULL,
    masked_payment_label VARCHAR(64) NULL,
    source VARCHAR(16) NOT NULL,
    source_confidence INTEGER NULL,
    visibility VARCHAR(24) NOT NULL,
    status VARCHAR(16) NOT NULL,
    optimistic_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_recurring_commitments_household
        FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
    CONSTRAINT fk_recurring_commitments_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE SET NULL,
    CONSTRAINT ck_recurring_commitments_display_name
        CHECK (char_length(trim(display_name)) BETWEEN 1 AND 160),
    CONSTRAINT ck_recurring_commitments_category
        CHECK (category IN (
            'SUBSCRIPTION', 'UTILITY', 'MEMBERSHIP', 'SOFTWARE', 'EMI_LOAN',
            'INSURANCE', 'INVESTMENT_COMMITMENT', 'EDUCATION', 'OTHER'
        )),
    CONSTRAINT ck_recurring_commitments_payment_rail
        CHECK (payment_rail IN (
            'UPI_AUTOPAY', 'CARD_RECURRING', 'NACH_ENACH', 'APP_STORE',
            'MERCHANT_DIRECT', 'CASH_OR_MANUAL', 'UNKNOWN'
        )),
    CONSTRAINT ck_recurring_commitments_money
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
    CONSTRAINT ck_recurring_commitments_currency
        CHECK (currency = upper(currency) AND char_length(currency) = 3),
    CONSTRAINT ck_recurring_commitments_frequency
        CHECK (frequency IN (
            'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'
        )),
    CONSTRAINT ck_recurring_commitments_interval
        CHECK (interval_count BETWEEN 1 AND 3650),
    CONSTRAINT ck_recurring_commitments_custom_unit
        CHECK (
            (
                frequency = 'CUSTOM'
                AND custom_interval_unit IN ('DAYS', 'WEEKS', 'MONTHS', 'YEARS')
            )
            OR
            (frequency <> 'CUSTOM' AND custom_interval_unit IS NULL)
        ),
    CONSTRAINT ck_recurring_commitments_month_policy
        CHECK (
            month_day_policy IN ('ANCHOR_DAY', 'LAST_DAY')
            AND (
                month_day_policy = 'ANCHOR_DAY'
                OR frequency IN ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY')
                OR (
                    frequency = 'CUSTOM'
                    AND custom_interval_unit IN ('MONTHS', 'YEARS')
                )
            )
        ),
    CONSTRAINT ck_recurring_commitments_source
        CHECK (
            source = 'MANUAL'
            AND source_confidence IS NULL
        ),
    CONSTRAINT ck_recurring_commitments_visibility
        CHECK (visibility = 'PRIVATE'),
    CONSTRAINT ck_recurring_commitments_status
        CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
    CONSTRAINT ck_recurring_commitments_version
        CHECK (optimistic_version >= 0)
);

CREATE INDEX idx_recurring_commitments_household_status_created
    ON recurring_commitments (household_id, status, created_at, id);

CREATE INDEX idx_recurring_commitments_due
    ON recurring_commitments (status, next_due_date, id);

CREATE TABLE commitment_occurrences (
    id UUID PRIMARY KEY,
    commitment_id UUID NOT NULL,
    scheduled_date DATE NOT NULL,
    expected_amount_minor BIGINT NULL,
    currency VARCHAR(3) NOT NULL,
    amount_kind VARCHAR(24) NOT NULL,
    state VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_commitment_occurrences_commitment
        FOREIGN KEY (commitment_id) REFERENCES recurring_commitments (id) ON DELETE CASCADE,
    CONSTRAINT uq_commitment_occurrences_schedule
        UNIQUE (commitment_id, scheduled_date),
    CONSTRAINT ck_commitment_occurrences_money
        CHECK (
            expected_amount_minor IS NULL
            OR expected_amount_minor BETWEEN 1 AND 999999999999
        ),
    CONSTRAINT ck_commitment_occurrences_currency
        CHECK (currency = upper(currency) AND char_length(currency) = 3),
    CONSTRAINT ck_commitment_occurrences_amount_kind
        CHECK (amount_kind IN ('FIXED', 'ESTIMATED', 'UNKNOWN_VARIABLE')),
    CONSTRAINT ck_commitment_occurrences_state
        CHECK (state = 'UPCOMING')
);

CREATE INDEX idx_commitment_occurrences_commitment_date
    ON commitment_occurrences (commitment_id, scheduled_date, id);

CREATE INDEX idx_commitment_occurrences_date
    ON commitment_occurrences (scheduled_date, commitment_id);

INSERT INTO merchants (
    id, canonical_name, normalized_name, category, country_code, website_host, created_at
) VALUES
    (
        '10000000-0000-4000-8000-000000000001',
        'StreamBox Demo',
        'streambox demo',
        'SUBSCRIPTION',
        'IN',
        'streambox.example',
        CURRENT_TIMESTAMP
    ),
    (
        '10000000-0000-4000-8000-000000000002',
        'CloudNest Demo',
        'cloudnest demo',
        'SOFTWARE',
        'IN',
        'cloudnest.example',
        CURRENT_TIMESTAMP
    ),
    (
        '10000000-0000-4000-8000-000000000003',
        'FitClub Demo',
        'fitclub demo',
        'MEMBERSHIP',
        'IN',
        'fitclub.example',
        CURRENT_TIMESTAMP
    );

INSERT INTO merchant_aliases (
    id, merchant_id, alias, normalized_alias, created_at
) VALUES
    (
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'stream box',
        'stream box',
        CURRENT_TIMESTAMP
    ),
    (
        '20000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000001',
        'streambox',
        'streambox',
        CURRENT_TIMESTAMP
    ),
    (
        '20000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000002',
        'cloud nest',
        'cloud nest',
        CURRENT_TIMESTAMP
    ),
    (
        '20000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000002',
        'cloudnest',
        'cloudnest',
        CURRENT_TIMESTAMP
    ),
    (
        '20000000-0000-4000-8000-000000000005',
        '10000000-0000-4000-8000-000000000003',
        'fit club',
        'fit club',
        CURRENT_TIMESTAMP
    ),
    (
        '20000000-0000-4000-8000-000000000006',
        '10000000-0000-4000-8000-000000000003',
        'fitclub',
        'fitclub',
        CURRENT_TIMESTAMP
    );
