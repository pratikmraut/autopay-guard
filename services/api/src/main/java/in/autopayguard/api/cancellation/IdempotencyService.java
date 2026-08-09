package in.autopayguard.api.cancellation;

import in.autopayguard.api.common.error.RequestConflictException;
import jakarta.validation.ValidationException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
class IdempotencyService {

    private static final Pattern SAFE_KEY = Pattern.compile("^[\\x21-\\x7e]{16,100}$");

    private final IdempotencyRecordRepository repository;
    private final Clock clock;
    private final ObjectMapper objectMapper;

    IdempotencyService(
            IdempotencyRecordRepository repository,
            Clock clock,
            ObjectMapper objectMapper) {
        this.repository = repository;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    Claim begin(
            UUID ownerUserId,
            IdempotencyOperation operation,
            String rawKey,
            List<String> fingerprintParts) {
        if (rawKey == null || !SAFE_KEY.matcher(rawKey).matches()) {
            throw new ValidationException(
                    "Idempotency-Key must contain 16 through 100 visible ASCII characters.");
        }
        String keyHash = sha256(rawKey);
        String requestHash = canonicalHash(fingerprintParts);
        repository.lockOwner(ownerUserId);
        Optional<IdempotencyRecordEntity> existing =
                repository.findById(new IdempotencyRecordId(ownerUserId, operation, keyHash));
        if (existing.isPresent()) {
            if (!existing.orElseThrow().requestHash().equals(requestHash)) {
                throw new RequestConflictException(
                        "The Idempotency-Key was already used for a different request.");
            }
            IdempotencyRecordEntity record = existing.orElseThrow();
            return new Claim(
                    keyHash,
                    requestHash,
                    record.resourceId(),
                    record.responseBody(),
                    record.responseVersion());
        }
        return new Claim(keyHash, requestHash, null, null, null);
    }

    void complete(
            UUID ownerUserId,
            IdempotencyOperation operation,
            Claim claim,
            UUID resourceId) {
        complete(ownerUserId, operation, claim, resourceId, null, null);
    }

    void complete(
            UUID ownerUserId,
            IdempotencyOperation operation,
            Claim claim,
            UUID resourceId,
            Object response,
            Long responseVersion) {
        String responseBody = response == null ? null : serialize(response);
        repository.saveAndFlush(
                IdempotencyRecordEntity.create(
                        ownerUserId,
                        operation,
                        claim.keyHash(),
                        claim.requestHash(),
                        resourceId,
                        responseBody,
                        responseVersion,
                        clock.instant()));
    }

    <T> T replay(Claim claim, Class<T> responseType) {
        if (!claim.replay() || claim.responseBody() == null) {
            throw new IllegalStateException(
                    "The idempotency record has no response snapshot.");
        }
        try {
            T response = objectMapper.readValue(claim.responseBody(), responseType);
            if (claim.responseVersion() != null
                    && (!(response instanceof CancellationAttemptResponse attempt)
                            || attempt.version() != claim.responseVersion())) {
                throw new IllegalStateException(
                        "The idempotency response version does not match its snapshot.");
            }
            return response;
        } catch (Exception exception) {
            if (exception instanceof IllegalStateException illegalState) {
                throw illegalState;
            }
            throw new IllegalStateException(
                    "The idempotency response snapshot is unreadable.", exception);
        }
    }

    private String serialize(Object response) {
        try {
            return objectMapper.writeValueAsString(response);
        } catch (Exception exception) {
            throw new IllegalStateException(
                    "The idempotency response snapshot cannot be serialized.", exception);
        }
    }

    static String canonicalHash(List<String> values) {
        StringBuilder canonical = new StringBuilder();
        for (String value : values) {
            String safe = value == null ? "\u0000" : value;
            canonical.append(safe.length()).append(':').append(safe).append(';');
        }
        return sha256(canonical.toString());
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable.", exception);
        }
    }

    record Claim(
            String keyHash,
            String requestHash,
            UUID replayResourceId,
            String responseBody,
            Long responseVersion) {

        boolean replay() {
            return replayResourceId != null;
        }
    }
}
