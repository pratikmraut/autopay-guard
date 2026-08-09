package in.autopayguard.api.common.idempotency;

import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.security.OpaqueCodes;
import jakarta.validation.ValidationException;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class M5IdempotencyService {

    private static final Pattern SAFE_KEY =
            Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._~-]{15,99}$");

    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;
    private final ObjectMapper objectMapper;

    M5IdempotencyService(
            JdbcTemplate jdbcTemplate, Clock clock, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    public Claim begin(
            UUID actorUserId,
            Operation operation,
            String rawKey,
            List<String> fingerprintParts) {
        Claim requested = requestedClaim(rawKey, fingerprintParts);
        jdbcTemplate.queryForObject(
                "SELECT id FROM users WHERE id = ? FOR UPDATE",
                UUID.class,
                actorUserId);
        return existingOrRequested(actorUserId, operation, requested);
    }

    public Claim inspect(
            UUID actorUserId,
            Operation operation,
            String rawKey,
            List<String> fingerprintParts) {
        return existingOrRequested(
                actorUserId,
                operation,
                requestedClaim(rawKey, fingerprintParts));
    }

    private Claim existingOrRequested(
            UUID actorUserId, Operation operation, Claim requested) {
        List<Map<String, Object>> rows =
                jdbcTemplate.queryForList(
                        """
                        SELECT request_hash, resource_id, response_status,
                               response_body, response_version
                        FROM m5_idempotency_records
                        WHERE actor_user_id = ? AND operation = ? AND key_hash = ?
                        """,
                        actorUserId,
                        operation.name(),
                        requested.keyHash());
        if (rows.isEmpty()) {
            return requested;
        }
        Map<String, Object> row = rows.getFirst();
        if (!requested.requestHash().equals(row.get("request_hash"))) {
            throw new RequestConflictException(
                    "The Idempotency-Key was already used for a different request.");
        }
        return new Claim(
                requested.keyHash(),
                requested.requestHash(),
                (UUID) row.get("resource_id"),
                ((Number) row.get("response_status")).intValue(),
                (String) row.get("response_body"),
                row.get("response_version") == null
                        ? null
                        : ((Number) row.get("response_version")).longValue());
    }

    private static Claim requestedClaim(
            String rawKey, List<String> fingerprintParts) {
        if (rawKey == null || !SAFE_KEY.matcher(rawKey).matches()) {
            throw new ValidationException(
                    "Idempotency-Key must contain 16 through 100 safe ASCII characters.");
        }
        return new Claim(
                OpaqueCodes.sha256(rawKey),
                canonicalHash(fingerprintParts),
                null,
                0,
                null,
                null);
    }

    public void complete(
            UUID actorUserId,
            Operation operation,
            Claim claim,
            UUID resourceId,
            int responseStatus,
            Object response,
            Long responseVersion) {
        jdbcTemplate.update(
                """
                INSERT INTO m5_idempotency_records (
                    actor_user_id, operation, key_hash, request_hash,
                    resource_id, response_status, response_body,
                    response_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                actorUserId,
                operation.name(),
                claim.keyHash(),
                claim.requestHash(),
                resourceId,
                responseStatus,
                response == null ? null : serialize(response),
                responseVersion,
                clock.instant());
    }

    public <T> T replay(Claim claim, Class<T> responseType) {
        if (!claim.replay() || claim.responseBody() == null) {
            throw new IllegalStateException(
                    "The idempotency record has no response snapshot.");
        }
        try {
            return objectMapper.readValue(claim.responseBody(), responseType);
        } catch (Exception exception) {
            throw new IllegalStateException(
                    "The idempotency response snapshot is unreadable.", exception);
        }
    }

    public static String canonicalHash(List<String> values) {
        StringBuilder canonical = new StringBuilder();
        for (String value : values) {
            String safe = value == null ? "\u0000" : value;
            canonical.append(safe.length()).append(':').append(safe).append(';');
        }
        return OpaqueCodes.sha256(canonical.toString());
    }

    private String serialize(Object response) {
        try {
            return objectMapper.writeValueAsString(response);
        } catch (Exception exception) {
            throw new IllegalStateException(
                    "The idempotency response snapshot cannot be serialized.", exception);
        }
    }

    public enum Operation {
        NOTICE_ACKNOWLEDGEMENT,
        INVITATION_ACCEPT,
        CONSENT_EVENT,
        PRIVACY_REQUEST,
        PRIVACY_TRANSITION,
        GUIDE_DRAFT_CREATE,
        GUIDE_PUBLISH,
        GUIDE_RETIRE,
        FEEDBACK_REVIEW,
        IMPORT_CREATE,
        IMPORT_CONFIRM
    }

    public record Claim(
            String keyHash,
            String requestHash,
            UUID replayResourceId,
            int responseStatus,
            String responseBody,
            Long responseVersion) {

        public boolean replay() {
            return replayResourceId != null;
        }
    }
}
