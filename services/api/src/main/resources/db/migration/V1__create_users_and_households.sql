CREATE TABLE users (
    id UUID PRIMARY KEY,
    oidc_subject VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(320) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    locale VARCHAR(35) NOT NULL,
    age_confirmed_at TIMESTAMP WITH TIME ZONE NULL,
    privacy_notice_accepted_at TIMESTAMP WITH TIME ZONE NULL,
    privacy_notice_version VARCHAR(64) NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_users_oidc_subject_not_blank
        CHECK (char_length(trim(oidc_subject)) BETWEEN 1 AND 255),
    CONSTRAINT ck_users_email_not_blank
        CHECK (char_length(trim(email)) BETWEEN 3 AND 320),
    CONSTRAINT ck_users_display_name_not_blank
        CHECK (char_length(trim(display_name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_users_privacy_notice_pair
        CHECK (
            (privacy_notice_accepted_at IS NULL AND privacy_notice_version IS NULL)
            OR
            (privacy_notice_accepted_at IS NOT NULL
                AND privacy_notice_version IS NOT NULL
                AND char_length(trim(privacy_notice_version)) BETWEEN 1 AND 64)
        )
);

CREATE TABLE households (
    id UUID PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    owner_user_id UUID NOT NULL,
    default_currency VARCHAR(3) NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_households_owner
        FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_households_name_not_blank
        CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
    CONSTRAINT ck_households_currency_length
        CHECK (char_length(default_currency) = 3)
);

CREATE INDEX idx_households_owner_created
    ON households (owner_user_id, created_at, id);
