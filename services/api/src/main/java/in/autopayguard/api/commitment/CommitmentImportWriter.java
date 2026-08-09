package in.autopayguard.api.commitment;

import jakarta.validation.ValidationException;
import java.time.Clock;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class CommitmentImportWriter {

    private final CommitmentRepository commitmentRepository;
    private final OccurrenceReconciliationService reconciliationService;
    private final Clock clock;

    CommitmentImportWriter(
            CommitmentRepository commitmentRepository,
            OccurrenceReconciliationService reconciliationService,
            Clock clock) {
        this.commitmentRepository = commitmentRepository;
        this.reconciliationService = reconciliationService;
        this.clock = clock;
    }

    public UUID create(ImportedCommitmentCommand command, String householdTimezone) {
        Objects.requireNonNull(command);
        if (command.importFingerprint() == null
                || !command.importFingerprint().matches("^[0-9a-f]{64}$")) {
            throw new ValidationException("The import fingerprint is invalid.");
        }
        CommitmentRules.ValidatedCommitment input =
                CommitmentRules.validate(
                        new CreateCommitmentRequest(
                                command.householdId(),
                                command.merchantId(),
                                command.displayName(),
                                command.category(),
                                command.paymentRail(),
                                command.amountMinor(),
                                null,
                                command.currency(),
                                command.frequency(),
                                1,
                                null,
                                command.anchorDate(),
                                command.monthDayPolicy(),
                                false,
                                command.maskedPaymentLabel()));
        CommitmentEntity commitment =
                CommitmentEntity.createImported(
                        command.householdId(),
                        command.ownerUserId(),
                        input.merchantId(),
                        input.displayName(),
                        input.category(),
                        input.paymentRail(),
                        input.amountMinor(),
                        input.currency(),
                        input.frequency(),
                        input.anchorDate(),
                        input.monthDayPolicy(),
                        input.maskedPaymentLabel(),
                        command.importJobId(),
                        command.importItemId(),
                        command.importFingerprint(),
                        clock.instant());
        commitmentRepository.save(commitment);
        reconciliationService.replaceFutureAndReconcile(
                commitment, householdTimezone, false);
        commitmentRepository.saveAndFlush(commitment);
        return commitment.id();
    }
}
