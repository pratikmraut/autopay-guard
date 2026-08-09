package in.autopayguard.api.importing;

import static in.autopayguard.api.audit.AuditService.Action.IMPORT_CONFIRMED;
import static in.autopayguard.api.audit.AuditService.Action.IMPORT_DISCARDED;
import static in.autopayguard.api.audit.AuditService.Action.IMPORT_PREVIEW_CREATED;
import static in.autopayguard.api.audit.AuditService.Action.IMPORT_PREVIEW_EXPIRED;
import static in.autopayguard.api.audit.AuditService.ActorRole.USER;
import static in.autopayguard.api.audit.AuditService.ResourceType.IMPORT_JOB;
import static in.autopayguard.api.common.idempotency.M5IdempotencyService.Operation.IMPORT_CONFIRM;
import static in.autopayguard.api.common.idempotency.M5IdempotencyService.Operation.IMPORT_CREATE;
import static in.autopayguard.api.common.rate.OperationRateLimiter.Operation;
import static in.autopayguard.api.importing.CommitmentImportModels.ConfirmationOutcome;
import static in.autopayguard.api.importing.CommitmentImportModels.ConfirmationResponse;
import static in.autopayguard.api.importing.CommitmentImportModels.DuplicateKind;
import static in.autopayguard.api.importing.CommitmentImportModels.ErrorCode;
import static in.autopayguard.api.importing.CommitmentImportModels.ErrorResponse;
import static in.autopayguard.api.importing.CommitmentImportModels.ItemResponse;
import static in.autopayguard.api.importing.CommitmentImportModels.JobResponse;
import static in.autopayguard.api.importing.CommitmentImportModels.JobStatus;
import static in.autopayguard.api.importing.CommitmentImportModels.ParsedFile;
import static in.autopayguard.api.importing.CommitmentImportModels.ParsedRow;
import static in.autopayguard.api.importing.CommitmentImportModels.Preview;
import static in.autopayguard.api.importing.CommitmentImportModels.UploadOutcome;
import static in.autopayguard.api.importing.CommitmentImportModels.UploadResponse;

import in.autopayguard.api.audit.AuditService;
import in.autopayguard.api.commitment.CommitmentCategory;
import in.autopayguard.api.commitment.CommitmentImportWriter;
import in.autopayguard.api.commitment.ImportedCommitmentCommand;
import in.autopayguard.api.commitment.MonthDayPolicy;
import in.autopayguard.api.commitment.PaymentRail;
import in.autopayguard.api.commitment.RecurrenceFrequency;
import in.autopayguard.api.common.concurrency.UserMutationFenceService;
import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.RequestConflictException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.common.idempotency.M5IdempotencyService;
import in.autopayguard.api.common.idempotency.M5IdempotencyService.Claim;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import in.autopayguard.api.household.HouseholdAccessService;
import in.autopayguard.api.household.HouseholdMembershipService;
import in.autopayguard.api.household.OwnedHousehold;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class CommitmentImportService {

    private static final Duration PREVIEW_RETENTION =
            Duration.ofHours(23).plusMinutes(55);
    private static final int EXPIRY_BATCH_SIZE = 500;
    private static final int OPERATION_LOCK_STRIPES = 256;
    private static final ReentrantLock[] OPERATION_LOCKS =
            operationLocks();

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final UserMutationFenceService userMutationFenceService;
    private final HouseholdAccessService householdAccessService;
    private final HouseholdMembershipService membershipService;
    private final CommitmentCsvParser csvParser;
    private final ImportContentFingerprint contentFingerprint;
    private final CommitmentImportWriter commitmentWriter;
    private final M5IdempotencyService idempotencyService;
    private final OperationRateLimiter rateLimiter;
    private final AuditService auditService;
    private final Clock clock;
    private final TransactionTemplate transactions;

    CommitmentImportService(
            JdbcTemplate jdbcTemplate,
            CurrentUserService currentUserService,
            UserMutationFenceService userMutationFenceService,
            HouseholdAccessService householdAccessService,
            HouseholdMembershipService membershipService,
            CommitmentCsvParser csvParser,
            ImportContentFingerprint contentFingerprint,
            CommitmentImportWriter commitmentWriter,
            M5IdempotencyService idempotencyService,
            OperationRateLimiter rateLimiter,
            AuditService auditService,
            Clock clock,
            PlatformTransactionManager transactionManager) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.userMutationFenceService = userMutationFenceService;
        this.householdAccessService = householdAccessService;
        this.membershipService = membershipService;
        this.csvParser = csvParser;
        this.contentFingerprint = contentFingerprint;
        this.commitmentWriter = commitmentWriter;
        this.idempotencyService = idempotencyService;
        this.rateLimiter = rateLimiter;
        this.auditService = auditService;
        this.clock = clock;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public UploadOutcome upload(
            Jwt jwt,
            UUID householdId,
            byte[] rawBytes,
            String idempotencyKey) {
        CurrentUser owner = currentUserService.resolve(jwt);
        String fingerprintValue =
                contentFingerprint.calculate(householdId, rawBytes);
        List<String> fingerprint =
                List.of(householdId.toString(), fingerprintValue);
        ReentrantLock operationLock =
                operationLock(
                        owner.id(), IMPORT_CREATE.name(), idempotencyKey);
        operationLock.lock();
        try {
            UploadOutcome replay =
                    requiredTransaction(
                            () -> {
                                userMutationFenceService.lockLiveUser(
                                        owner.id());
                                householdAccessService.requireOwned(
                                        householdId, owner.id());
                                Claim inspected =
                                        idempotencyService.inspect(
                                                owner.id(),
                                                IMPORT_CREATE,
                                                idempotencyKey,
                                                fingerprint);
                                return inspected.replay()
                                        ? new UploadOutcome(
                                                idempotencyService.replay(
                                                        inspected,
                                                        UploadResponse.class),
                                                true)
                                        : null;
                            });
            if (replay != null) {
                return replay;
            }
            rateLimiter.checkImport(
                    jwt, owner.id(), Operation.IMPORT_CREATE);
            return requiredTransaction(
                    () ->
                            uploadInTransaction(
                                    owner,
                                    householdId,
                                    rawBytes,
                                    fingerprintValue,
                                    idempotencyKey,
                                    fingerprint));
        } finally {
            operationLock.unlock();
        }
    }

    private UploadOutcome uploadInTransaction(
            CurrentUser owner,
            UUID householdId,
            byte[] rawBytes,
            String fingerprintValue,
            String idempotencyKey,
            List<String> fingerprint) {
        userMutationFenceService.lockLiveUser(owner.id());
        membershipService.lockOwnerMutationScope(householdId, owner.id());
        OwnedHousehold household =
                householdAccessService.requireOwned(householdId, owner.id());
        Claim claim =
                idempotencyService.begin(
                        owner.id(), IMPORT_CREATE, idempotencyKey, fingerprint);
        if (claim.replay()) {
            return new UploadOutcome(
                    idempotencyService.replay(claim, UploadResponse.class),
                    true);
        }
        ParsedFile parsed = csvParser.parse(rawBytes);

        Set<String> existingFingerprints =
                existingFingerprints(owner.id(), household.id());
        Set<String> seenInFile = new HashSet<>();
        List<ClassifiedRow> rows = new ArrayList<>(parsed.rows().size());
        int validCount = 0;
        int duplicateCount = 0;
        for (ParsedRow row : parsed.rows()) {
            DuplicateKind duplicateKind = null;
            if (row.valid()) {
                validCount++;
                boolean alreadySeen = !seenInFile.add(row.fingerprint());
                if (existingFingerprints.contains(row.fingerprint())) {
                    duplicateKind = DuplicateKind.EXISTING;
                } else if (alreadySeen) {
                    duplicateKind = DuplicateKind.IN_FILE;
                } else {
                    duplicateKind = DuplicateKind.NONE;
                }
                if (duplicateKind != DuplicateKind.NONE) {
                    duplicateCount++;
                }
            }
            rows.add(new ClassifiedRow(row, duplicateKind));
        }

        UUID importId = UUID.randomUUID();
        Instant now = clock.instant();
        Instant expiresAt = now.plus(PREVIEW_RETENTION);
        int invalidCount = rows.size() - validCount;
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_jobs (
                    id, household_id, owner_user_id, status, raw_payload,
                    raw_byte_count, content_fingerprint, preview_expires_at,
                    raw_processed_at,
                    total_item_count, valid_item_count, invalid_item_count,
                    duplicate_item_count, selected_item_count,
                    created_commitment_count, optimistic_version, confirmed_at,
                    discarded_at, expired_at, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 'PREVIEW_READY', NULL, ?, ?, ?, ?,
                    ?, ?, ?, ?, 0, 0, 0, NULL, NULL, NULL, ?, ?
                )
                """,
                importId,
                household.id(),
                owner.id(),
                rawBytes.length,
                fingerprintValue,
                expiresAt,
                now,
                rows.size(),
                validCount,
                invalidCount,
                duplicateCount,
                now,
                now);
        for (ClassifiedRow row : rows) {
            insertRow(importId, row, now);
        }
        auditService.record(
                owner.id(),
                USER,
                IMPORT_PREVIEW_CREATED,
                IMPORT_JOB,
                importId);
        UploadResponse response =
                new UploadResponse(
                        importId,
                        household.id(),
                        JobStatus.PREVIEW_READY,
                        rawBytes.length,
                        expiresAt,
                        rows.size(),
                        validCount,
                        invalidCount,
                        duplicateCount,
                        0,
                        now,
                        now);
        idempotencyService.complete(
                owner.id(),
                IMPORT_CREATE,
                claim,
                importId,
                201,
                response,
                0L);
        return new UploadOutcome(response, false);
    }

    public JobResponse get(Jwt jwt, UUID importId) {
        CurrentUser owner = currentUserService.resolve(jwt);
        return requiredTransaction(() -> getInTransaction(owner, importId));
    }

    private JobResponse getInTransaction(CurrentUser owner, UUID importId) {
        userMutationFenceService.lockLiveUser(owner.id());
        JobRow job = requireOwnedForUpdate(importId, owner.id());
        if (job.status() == JobStatus.PREVIEW_READY
                && !job.previewExpiresAt().isAfter(clock.instant())) {
            expire(job, clock.instant());
            job = requireOwnedForUpdate(importId, owner.id());
        }
        return toJobResponse(job);
    }

    public ConfirmationOutcome confirm(
            Jwt jwt,
            UUID importId,
            long expectedVersion,
            List<UUID> selectedItemIds,
            String idempotencyKey) {
        validateDistinctSelection(selectedItemIds);
        CurrentUser owner = currentUserService.resolve(jwt);
        List<String> canonicalItemIds =
                selectedItemIds.stream()
                        .map(UUID::toString)
                        .sorted()
                        .toList();
        List<String> fingerprint = new ArrayList<>(canonicalItemIds.size() + 2);
        fingerprint.add(importId.toString());
        fingerprint.add(Long.toString(expectedVersion));
        fingerprint.addAll(canonicalItemIds);
        ReentrantLock operationLock =
                operationLock(
                        owner.id(), IMPORT_CONFIRM.name(), idempotencyKey);
        operationLock.lock();
        try {
            ConfirmationTransactionResult preflight =
                    requiredTransaction(
                            () ->
                                    confirmPreflight(
                                            owner,
                                            importId,
                                            expectedVersion,
                                            idempotencyKey,
                                            fingerprint));
            if (preflight.expired()) {
                throw new ExpiredPreconditionFailedException();
            }
            if (preflight.outcome() != null) {
                return preflight.outcome();
            }
            rateLimiter.checkImport(
                    jwt, owner.id(), Operation.IMPORT_CONFIRM);
            ConfirmationTransactionResult result =
                    requiredTransaction(
                            () ->
                                    confirmInTransaction(
                                            owner,
                                            importId,
                                            expectedVersion,
                                            selectedItemIds,
                                            idempotencyKey,
                                            fingerprint));
            if (result.expired()) {
                throw new ExpiredPreconditionFailedException();
            }
            return Objects.requireNonNull(result.outcome());
        } finally {
            operationLock.unlock();
        }
    }

    private ConfirmationTransactionResult confirmPreflight(
            CurrentUser owner,
            UUID importId,
            long expectedVersion,
            String idempotencyKey,
            List<String> fingerprint) {
        userMutationFenceService.lockLiveUser(owner.id());
        Claim inspected =
                idempotencyService.inspect(
                        owner.id(), IMPORT_CONFIRM, idempotencyKey, fingerprint);
        if (inspected.replay()) {
            return ConfirmationTransactionResult.outcome(
                    new ConfirmationOutcome(
                            idempotencyService.replay(
                                    inspected, ConfirmationResponse.class),
                            true));
        }
        JobRow job = requireOwnedForUpdate(importId, owner.id());
        Instant now = clock.instant();
        if (job.status() == JobStatus.PREVIEW_READY
                && !job.previewExpiresAt().isAfter(now)) {
            expire(job, now);
            return ConfirmationTransactionResult.expiredResult();
        }
        verifyVersion(job, expectedVersion);
        if (job.status() != JobStatus.PREVIEW_READY) {
            throw new RequestConflictException(
                    "The import preview is no longer available for confirmation.");
        }
        return ConfirmationTransactionResult.proceed();
    }

    private ConfirmationTransactionResult confirmInTransaction(
            CurrentUser owner,
            UUID importId,
            long expectedVersion,
            List<UUID> selectedItemIds,
            String idempotencyKey,
            List<String> fingerprint) {
        userMutationFenceService.lockLiveUser(owner.id());
        Claim claim =
                idempotencyService.begin(
                        owner.id(), IMPORT_CONFIRM, idempotencyKey, fingerprint);
        if (claim.replay()) {
            return ConfirmationTransactionResult.outcome(
                    new ConfirmationOutcome(
                            idempotencyService.replay(
                                    claim, ConfirmationResponse.class),
                            true));
        }
        JobRow job = requireOwnedForUpdate(importId, owner.id());
        Instant now = clock.instant();
        if (job.status() == JobStatus.PREVIEW_READY
                && !job.previewExpiresAt().isAfter(now)) {
            expire(job, now);
            return ConfirmationTransactionResult.expiredResult();
        }
        verifyVersion(job, expectedVersion);
        if (job.status() != JobStatus.PREVIEW_READY) {
            throw new RequestConflictException(
                    "The import preview is no longer available for confirmation.");
        }
        membershipService.lockOwnerMutationScope(
                job.householdId(), owner.id());
        OwnedHousehold household =
                householdAccessService.requireOwned(
                        job.householdId(), owner.id());
        List<ItemRow> selectedRows =
                selectedRowsForUpdate(importId, selectedItemIds);
        if (selectedRows.size() != selectedItemIds.size()
                || selectedRows.stream().anyMatch(row -> !row.valid())) {
            throw new ValidationException(
                    "selectedItemIds must identify distinct valid rows in this import.");
        }

        jdbcTemplate.update(
                """
                UPDATE commitment_import_items
                SET selected = FALSE, created_commitment_id = NULL, updated_at = ?
                WHERE import_job_id = ? AND valid = TRUE
                """,
                now,
                importId);
        List<UUID> commitmentIds = new ArrayList<>(selectedRows.size());
        for (ItemRow item : selectedRows) {
            UUID commitmentId =
                    commitmentWriter.create(
                            new ImportedCommitmentCommand(
                                    job.householdId(),
                                    owner.id(),
                                    item.merchantId(),
                                    item.name(),
                                    item.category(),
                                    item.paymentRail(),
                                    item.amountMinor(),
                                    item.currency(),
                                    item.frequency(),
                                    item.nextDueDate(),
                                    item.monthDayPolicy(),
                                    item.maskedPaymentLabel(),
                                    importId,
                                    item.id(),
                                    item.fingerprint()),
                            household.timezone());
            commitmentIds.add(commitmentId);
            jdbcTemplate.update(
                    """
                    UPDATE commitment_import_items
                    SET selected = TRUE, created_commitment_id = ?, updated_at = ?
                    WHERE import_job_id = ? AND id = ? AND valid = TRUE
                    """,
                    commitmentId,
                    now,
                    importId,
                    item.id());
        }

        int updated =
                jdbcTemplate.update(
                        """
                        UPDATE commitment_import_jobs
                        SET status = 'CONFIRMED', raw_payload = NULL,
                            selected_item_count = ?,
                            created_commitment_count = ?, confirmed_at = ?,
                            optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE id = ? AND owner_user_id = ?
                          AND status = 'PREVIEW_READY'
                          AND optimistic_version = ?
                        """,
                        selectedRows.size(),
                        commitmentIds.size(),
                        now,
                        now,
                        importId,
                        owner.id(),
                        expectedVersion);
        if (updated != 1) {
            throw new PreconditionFailedException();
        }
        long newVersion = expectedVersion + 1;
        auditService.record(
                owner.id(), USER, IMPORT_CONFIRMED, IMPORT_JOB, importId);
        ConfirmationResponse response =
                new ConfirmationResponse(
                        importId,
                        JobStatus.CONFIRMED,
                        selectedRows.size(),
                        commitmentIds.size(),
                        List.copyOf(commitmentIds),
                        job.rawProcessedAt(),
                        newVersion);
        idempotencyService.complete(
                owner.id(),
                IMPORT_CONFIRM,
                claim,
                importId,
                200,
                response,
                newVersion);
        return ConfirmationTransactionResult.outcome(
                new ConfirmationOutcome(response, false));
    }

    public long discard(Jwt jwt, UUID importId, long expectedVersion) {
        CurrentUser owner = currentUserService.resolve(jwt);
        DiscardTransactionResult result =
                requiredTransaction(
                        () ->
                                discardInTransaction(
                                        owner, importId, expectedVersion));
        if (result.expired()) {
            throw new ExpiredPreconditionFailedException();
        }
        return result.version();
    }

    private DiscardTransactionResult discardInTransaction(
            CurrentUser owner, UUID importId, long expectedVersion) {
        userMutationFenceService.lockLiveUser(owner.id());
        JobRow job = requireOwnedForUpdate(importId, owner.id());
        Instant now = clock.instant();
        if (job.status() == JobStatus.PREVIEW_READY
                && !job.previewExpiresAt().isAfter(now)) {
            expire(job, now);
            return DiscardTransactionResult.expiredResult();
        }
        verifyVersion(job, expectedVersion);
        if (job.status() != JobStatus.PREVIEW_READY) {
            throw new RequestConflictException(
                    "The import preview is no longer available for discard.");
        }
        int updated =
                jdbcTemplate.update(
                        """
                        UPDATE commitment_import_jobs
                        SET status = 'DISCARDED', raw_payload = NULL,
                            discarded_at = ?,
                            optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE id = ? AND owner_user_id = ?
                          AND status = 'PREVIEW_READY'
                          AND optimistic_version = ?
                        """,
                        now,
                        now,
                        importId,
                        owner.id(),
                        expectedVersion);
        if (updated != 1) {
            throw new PreconditionFailedException();
        }
        auditService.record(
                owner.id(), USER, IMPORT_DISCARDED, IMPORT_JOB, importId);
        return DiscardTransactionResult.version(expectedVersion + 1);
    }

    @Scheduled(
            fixedDelayString = "${app.imports.expiry-delay-ms:60000}",
            initialDelayString = "${app.imports.expiry-delay-ms:60000}")
    public void expireDueImports() {
        Instant now = clock.instant();
        List<ExpiryCandidate> due =
                requiredTransaction(
                        () ->
                                jdbcTemplate.query(
                                        """
                                        SELECT id, owner_user_id
                                        FROM commitment_import_jobs
                                        WHERE status = 'PREVIEW_READY'
                                              AND preview_expires_at <= ?
                                            ORDER BY owner_user_id ASC,
                                                     preview_expires_at ASC,
                                                     id ASC
                                        LIMIT ?
                                        """,
                                        (row, rowNumber) ->
                                                new ExpiryCandidate(
                                                        row.getObject(
                                                                "id",
                                                                UUID.class),
                                                        row.getObject(
                                                                "owner_user_id",
                                                                UUID.class)),
                                        now,
                                        EXPIRY_BATCH_SIZE));
        for (ExpiryCandidate candidate : due) {
            try {
                requiredTransaction(
                        () -> {
                            userMutationFenceService.lockLiveUser(
                                    candidate.ownerUserId());
                            List<JobRow> rows =
                                    ownedForUpdate(
                                            candidate.id(),
                                            candidate.ownerUserId());
                            if (!rows.isEmpty()) {
                                JobRow job = rows.getFirst();
                                if (job.status()
                                                == JobStatus.PREVIEW_READY
                                    && !job.previewExpiresAt()
                                                .isAfter(clock.instant())) {
                                    expire(job, clock.instant());
                                }
                            }
                            return null;
                        });
            } catch (ResourceNotFoundException ignored) {
                // Subject deletion won the user fence and cascaded the job.
            }
        }
    }

    private void expire(JobRow job, Instant now) {
        int updated =
                jdbcTemplate.update(
                        """
                        UPDATE commitment_import_jobs
                        SET status = 'EXPIRED', raw_payload = NULL,
                            expired_at = ?,
                            optimistic_version = optimistic_version + 1,
                            updated_at = ?
                        WHERE id = ? AND owner_user_id = ?
                          AND status = 'PREVIEW_READY'
                          AND optimistic_version = ?
                        """,
                        now,
                        now,
                        job.id(),
                        job.ownerUserId(),
                        job.version());
        if (updated == 1) {
            auditService.record(
                    job.ownerUserId(),
                    USER,
                    IMPORT_PREVIEW_EXPIRED,
                    IMPORT_JOB,
                    job.id());
        }
    }

    private void insertRow(
            UUID importId, ClassifiedRow classified, Instant now) {
        ParsedRow row = classified.row();
        UUID itemId = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO commitment_import_items (
                    id, import_job_id, row_number, valid, duplicate_kind,
                    schedule_fingerprint, name, category, amount_minor,
                    currency, frequency, next_due_date, month_day_policy,
                    payment_rail, masked_payment_label, merchant_id, selected,
                    created_commitment_id, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    NULL, NULL, ?, ?
                )
                """,
                itemId,
                importId,
                row.rowNumber(),
                row.valid(),
                enumName(classified.duplicateKind()),
                row.fingerprint(),
                row.name(),
                enumName(row.category()),
                row.amountMinor(),
                row.currency(),
                enumName(row.frequency()),
                row.nextDueDate(),
                enumName(row.monthDayPolicy()),
                enumName(row.paymentRail()),
                row.maskedPaymentLabel(),
                row.merchantId(),
                now,
                now);
        for (int index = 0; index < row.errors().size(); index++) {
            jdbcTemplate.update(
                    """
                    INSERT INTO commitment_import_item_errors (
                        import_item_id, sequence_number, error_code
                    ) VALUES (?, ?, ?)
                    """,
                    itemId,
                    index + 1,
                    row.errors().get(index).name());
        }
    }

    private Set<String> existingFingerprints(
            UUID ownerId, UUID householdId) {
        return new HashSet<>(
                jdbcTemplate.query(
                        """
                        SELECT display_name, category, amount_minor, currency,
                               frequency, next_due_date, payment_rail
                        FROM recurring_commitments
                        WHERE household_id = ? AND data_owner_user_id = ?
                          AND status = 'ACTIVE' AND variable_amount = FALSE
                          AND amount_minor IS NOT NULL
                          AND next_due_date IS NOT NULL
                        ORDER BY id ASC
                        """,
                        (row, rowNumber) ->
                                CommitmentCsvParser.scheduleFingerprint(
                                        row.getString("display_name"),
                                        CommitmentCategory.valueOf(
                                                row.getString("category")),
                                        row.getLong("amount_minor"),
                                        row.getString("currency"),
                                        RecurrenceFrequency.valueOf(
                                                row.getString("frequency")),
                                        row.getObject(
                                                "next_due_date", LocalDate.class),
                                        PaymentRail.valueOf(
                                                row.getString("payment_rail"))),
                        householdId,
                        ownerId));
    }

    private JobRow requireOwnedForUpdate(UUID importId, UUID ownerId) {
        List<JobRow> rows = ownedForUpdate(importId, ownerId);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
        return rows.getFirst();
    }

    private List<JobRow> ownedForUpdate(UUID importId, UUID ownerId) {
        return jdbcTemplate.query(
                        """
                        SELECT *
                        FROM commitment_import_jobs
                        WHERE id = ? AND owner_user_id = ?
                        FOR UPDATE
                        """,
                        CommitmentImportService::mapJob,
                        importId,
                        ownerId);
    }

    private JobResponse toJobResponse(JobRow job) {
        Map<UUID, List<ErrorCode>> errors = errors(job.id());
        List<ItemResponse> items =
                jdbcTemplate.query(
                        """
                        SELECT *
                        FROM commitment_import_items
                        WHERE import_job_id = ?
                        ORDER BY row_number ASC, id ASC
                        """,
                        (row, rowNumber) -> {
                            UUID id = row.getObject("id", UUID.class);
                            boolean valid = row.getBoolean("valid");
                            List<ErrorResponse> itemErrors =
                                    errors.getOrDefault(id, List.of()).stream()
                                            .map(ErrorResponse::from)
                                            .toList();
                            Preview preview =
                                    valid
                                            ? new Preview(
                                                    row.getString("name"),
                                                    CommitmentCategory.valueOf(
                                                            row.getString(
                                                                    "category")),
                                                    row.getLong("amount_minor"),
                                                    row.getString("currency"),
                                                    RecurrenceFrequency.valueOf(
                                                            row.getString(
                                                                    "frequency")),
                                                    row.getObject(
                                                            "next_due_date",
                                                            LocalDate.class),
                                                    MonthDayPolicy.valueOf(
                                                            row.getString(
                                                                    "month_day_policy")),
                                                    PaymentRail.valueOf(
                                                            row.getString(
                                                                    "payment_rail")),
                                                    row.getString(
                                                            "masked_payment_label"),
                                                    row.getObject(
                                                            "merchant_id",
                                                            UUID.class))
                                            : null;
                            String duplicate = row.getString("duplicate_kind");
                            return new ItemResponse(
                                    id,
                                    row.getInt("row_number"),
                                    valid,
                                    duplicate == null
                                            ? null
                                            : DuplicateKind.valueOf(duplicate),
                                    row.getObject("selected", Boolean.class),
                                    row.getObject(
                                            "created_commitment_id", UUID.class),
                                    itemErrors,
                                    preview);
                        },
                        job.id());
        return new JobResponse(
                job.id(),
                job.householdId(),
                job.status(),
                job.rawByteCount(),
                job.previewExpiresAt(),
                job.rawProcessedAt(),
                job.totalItemCount(),
                job.validItemCount(),
                job.invalidItemCount(),
                job.duplicateItemCount(),
                job.selectedItemCount(),
                job.createdCommitmentCount(),
                List.copyOf(items),
                job.version(),
                job.createdAt(),
                job.updatedAt());
    }

    private Map<UUID, List<ErrorCode>> errors(UUID importId) {
        Map<UUID, List<ErrorCode>> result = new LinkedHashMap<>();
        jdbcTemplate.query(
                """
                SELECT e.import_item_id, e.error_code
                FROM commitment_import_item_errors e
                JOIN commitment_import_items i ON i.id = e.import_item_id
                WHERE i.import_job_id = ?
                ORDER BY i.row_number ASC, e.sequence_number ASC
                """,
                row -> {
                    UUID id = row.getObject("import_item_id", UUID.class);
                    result.computeIfAbsent(id, ignored -> new ArrayList<>())
                            .add(ErrorCode.valueOf(row.getString("error_code")));
                },
                importId);
        return result;
    }

    private List<ItemRow> selectedRowsForUpdate(
            UUID importId, List<UUID> itemIds) {
        String placeholders =
                String.join(",", Collections.nCopies(itemIds.size(), "?"));
        Object[] arguments = new Object[itemIds.size() + 1];
        arguments[0] = importId;
        for (int index = 0; index < itemIds.size(); index++) {
            arguments[index + 1] = itemIds.get(index);
        }
        return jdbcTemplate.query(
                """
                SELECT *
                FROM commitment_import_items
                WHERE import_job_id = ? AND id IN (%s)
                ORDER BY row_number ASC, id ASC
                FOR UPDATE
                """
                        .formatted(placeholders),
                (row, rowNumber) ->
                        new ItemRow(
                                row.getObject("id", UUID.class),
                                row.getBoolean("valid"),
                                row.getString("schedule_fingerprint"),
                                row.getString("name"),
                                enumValue(
                                        CommitmentCategory.class,
                                        row.getString("category")),
                                nullableLong(row, "amount_minor"),
                                row.getString("currency"),
                                enumValue(
                                        RecurrenceFrequency.class,
                                        row.getString("frequency")),
                                row.getObject("next_due_date", LocalDate.class),
                                enumValue(
                                        MonthDayPolicy.class,
                                        row.getString("month_day_policy")),
                                enumValue(
                                        PaymentRail.class,
                                        row.getString("payment_rail")),
                                row.getString("masked_payment_label"),
                                row.getObject("merchant_id", UUID.class)),
                arguments);
    }

    private static JobRow mapJob(
            java.sql.ResultSet row, int rowNumber) throws java.sql.SQLException {
        return new JobRow(
                row.getObject("id", UUID.class),
                row.getObject("household_id", UUID.class),
                row.getObject("owner_user_id", UUID.class),
                JobStatus.valueOf(row.getString("status")),
                row.getInt("raw_byte_count"),
                instant(row, "preview_expires_at"),
                instant(row, "raw_processed_at"),
                row.getInt("total_item_count"),
                row.getInt("valid_item_count"),
                row.getInt("invalid_item_count"),
                row.getInt("duplicate_item_count"),
                row.getInt("selected_item_count"),
                row.getInt("created_commitment_count"),
                row.getLong("optimistic_version"),
                instant(row, "created_at"),
                instant(row, "updated_at"));
    }

    private static Instant instant(
            java.sql.ResultSet row, String column) throws java.sql.SQLException {
        return row.getObject(column, OffsetDateTime.class).toInstant();
    }

    private static Long nullableLong(
            java.sql.ResultSet row, String column) throws java.sql.SQLException {
        long value = row.getLong(column);
        return row.wasNull() ? null : value;
    }

    private static <T extends Enum<T>> T enumValue(
            Class<T> type, String value) {
        return value == null ? null : Enum.valueOf(type, value);
    }

    private static String enumName(Enum<?> value) {
        return value == null ? null : value.name();
    }

    private static void validateDistinctSelection(List<UUID> itemIds) {
        if (itemIds == null || itemIds.isEmpty() || itemIds.size() > 100) {
            throw new ValidationException(
                    "selectedItemIds must contain 1 through 100 item IDs.");
        }
        if (itemIds.stream().anyMatch(java.util.Objects::isNull)
                || new HashSet<>(itemIds).size() != itemIds.size()) {
            throw new ValidationException(
                    "selectedItemIds must contain distinct non-null item IDs.");
        }
    }

    private static void verifyVersion(JobRow job, long expectedVersion) {
        if (job.version() != expectedVersion) {
            throw new PreconditionFailedException();
        }
    }

    private <T> T requiredTransaction(Supplier<T> action) {
        return transactions.execute(ignored -> action.get());
    }

    private static ReentrantLock[] operationLocks() {
        ReentrantLock[] locks = new ReentrantLock[OPERATION_LOCK_STRIPES];
        for (int index = 0; index < locks.length; index++) {
            locks[index] = new ReentrantLock(true);
        }
        return locks;
    }

    private static ReentrantLock operationLock(
            UUID ownerId, String operation, String idempotencyKey) {
        int hash = Objects.hash(ownerId, operation, idempotencyKey);
        return OPERATION_LOCKS[(hash & Integer.MAX_VALUE)
                % OPERATION_LOCKS.length];
    }

    private record ClassifiedRow(
            ParsedRow row, DuplicateKind duplicateKind) {}

    private record ExpiryCandidate(UUID id, UUID ownerUserId) {}

    private record ConfirmationTransactionResult(
            ConfirmationOutcome outcome, boolean expired) {

        private static ConfirmationTransactionResult proceed() {
            return new ConfirmationTransactionResult(null, false);
        }

        private static ConfirmationTransactionResult outcome(
                ConfirmationOutcome outcome) {
            return new ConfirmationTransactionResult(outcome, false);
        }

        private static ConfirmationTransactionResult expiredResult() {
            return new ConfirmationTransactionResult(null, true);
        }
    }

    private record DiscardTransactionResult(long version, boolean expired) {

        private static DiscardTransactionResult version(long version) {
            return new DiscardTransactionResult(version, false);
        }

        private static DiscardTransactionResult expiredResult() {
            return new DiscardTransactionResult(-1, true);
        }
    }

    private record JobRow(
            UUID id,
            UUID householdId,
            UUID ownerUserId,
            JobStatus status,
            int rawByteCount,
            Instant previewExpiresAt,
            Instant rawProcessedAt,
            int totalItemCount,
            int validItemCount,
            int invalidItemCount,
            int duplicateItemCount,
            int selectedItemCount,
            int createdCommitmentCount,
            long version,
            Instant createdAt,
            Instant updatedAt) {}

    private record ItemRow(
            UUID id,
            boolean valid,
            String fingerprint,
            String name,
            CommitmentCategory category,
            Long amountMinor,
            String currency,
            RecurrenceFrequency frequency,
            LocalDate nextDueDate,
            MonthDayPolicy monthDayPolicy,
            PaymentRail paymentRail,
            String maskedPaymentLabel,
            UUID merchantId) {}

    private static final class ExpiredPreconditionFailedException
            extends PreconditionFailedException {}

}
