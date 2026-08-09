package in.autopayguard.api.reminder;

import in.autopayguard.api.commitment.CommitmentResponse;
import in.autopayguard.api.commitment.CommitmentService;
import in.autopayguard.api.commitment.CommitmentStatus;
import in.autopayguard.api.common.error.PreconditionFailedException;
import in.autopayguard.api.common.error.ResourceNotFoundException;
import in.autopayguard.api.household.HouseholdAccessService;
import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import in.autopayguard.api.notification.NotificationChannel;
import jakarta.validation.ValidationException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ReminderRuleService {

    private static final DateTimeFormatter MINUTE_TIME = DateTimeFormatter.ofPattern("HH:mm");
    private static final Comparator<ReminderRuleEntity> RULE_ORDER =
            Comparator.comparing(ReminderRuleEntity::channel)
                    .thenComparing(
                            ReminderRuleEntity::offsetDays, Comparator.reverseOrder())
                    .thenComparing(ReminderRuleEntity::localSendTime);
    private static final List<ReminderRuleResponse> SUGGESTED_RULES = suggestedRules();

    private final ReminderRuleSetRepository ruleSetRepository;
    private final ReminderRuleRepository ruleRepository;
    private final CurrentUserService currentUserService;
    private final HouseholdAccessService householdAccessService;
    private final CommitmentService commitmentService;
    private final Clock clock;

    ReminderRuleService(
            ReminderRuleSetRepository ruleSetRepository,
            ReminderRuleRepository ruleRepository,
            CurrentUserService currentUserService,
            HouseholdAccessService householdAccessService,
            CommitmentService commitmentService,
            Clock clock) {
        this.ruleSetRepository = ruleSetRepository;
        this.ruleRepository = ruleRepository;
        this.currentUserService = currentUserService;
        this.householdAccessService = householdAccessService;
        this.commitmentService = commitmentService;
        this.clock = clock;
    }

    @Transactional
    public ReminderRuleSetResponse getHousehold(Jwt jwt, UUID householdId) {
        CurrentUser owner = currentUserService.resolve(jwt);
        householdAccessService.requireOwned(householdId, owner.id());
        return ruleSetRepository
                .findHousehold(householdId)
                .map(ruleSet -> toResponse(ruleSet, true))
                .orElseGet(() -> syntheticHousehold(householdId));
    }

    @Transactional
    public ReminderRuleSetResponse updateHousehold(
            Jwt jwt,
            UUID householdId,
            long expectedVersion,
            UpdateReminderRuleSetRequest request) {
        CurrentUser owner = currentUserService.resolve(jwt);
        householdAccessService.requireOwned(householdId, owner.id());
        List<ValidatedRule> rules = validate(request, false);
        ruleSetRepository.lockHousehold(householdId);
        ReminderRuleSetEntity ruleSet =
                ruleSetRepository.findHouseholdForUpdate(householdId).orElse(null);
        Instant now = clock.instant();
        if (ruleSet == null) {
            if (expectedVersion != 0) {
                throw new PreconditionFailedException();
            }
            ruleSet =
                    ruleSetRepository.saveAndFlush(
                            ReminderRuleSetEntity.forHousehold(
                                    householdId, request.mode(), now));
        } else {
            verifyVersion(ruleSet, expectedVersion);
            ruleRepository.deleteForRuleSet(ruleSet.id());
            ruleSet.update(request.mode(), now);
            ruleSet = ruleSetRepository.saveAndFlush(ruleSet);
        }
        saveRules(ruleSet.id(), rules, now);
        return toResponse(ruleSet, true);
    }

    @Transactional
    public ReminderRuleSetResponse getCommitment(Jwt jwt, UUID commitmentId) {
        CommitmentResponse commitment = requireMutableCommitment(jwt, commitmentId);
        return ruleSetRepository
                .findCommitment(commitmentId)
                .map(ruleSet -> toResponse(ruleSet, false))
                .orElseGet(
                        () ->
                                syntheticCommitment(
                                        commitment.householdId(), commitmentId));
    }

    @Transactional
    public ReminderRuleSetResponse updateCommitment(
            Jwt jwt,
            UUID commitmentId,
            long expectedVersion,
            UpdateReminderRuleSetRequest request) {
        CommitmentResponse commitment = requireMutableCommitment(jwt, commitmentId);
        List<ValidatedRule> rules = validate(request, true);
        ruleSetRepository
                .lockMutableCommitment(commitment.householdId(), commitmentId)
                .orElseThrow(ResourceNotFoundException::new);
        ReminderRuleSetEntity ruleSet =
                ruleSetRepository.findCommitmentForUpdate(commitmentId).orElse(null);
        Instant now = clock.instant();
        if (ruleSet == null) {
            if (expectedVersion != 0) {
                throw new PreconditionFailedException();
            }
            ruleSet =
                    ruleSetRepository.saveAndFlush(
                            ReminderRuleSetEntity.forCommitment(
                                    commitment.householdId(),
                                    commitmentId,
                                    request.mode(),
                                    now));
        } else {
            verifyVersion(ruleSet, expectedVersion);
            ruleRepository.deleteForRuleSet(ruleSet.id());
            ruleSet.update(request.mode(), now);
            ruleSet = ruleSetRepository.saveAndFlush(ruleSet);
        }
        saveRules(ruleSet.id(), rules, now);
        return toResponse(ruleSet, false);
    }

    @Transactional(readOnly = true)
    public Optional<ReminderRuleSetSnapshot> findHouseholdForScheduling(UUID householdId) {
        return ruleSetRepository
                .findHousehold(householdId)
                .map(this::toSnapshot);
    }

    @Transactional(readOnly = true)
    public Optional<ReminderRuleSetSnapshot> findCommitmentForScheduling(UUID commitmentId) {
        return ruleSetRepository
                .findCommitment(commitmentId)
                .map(this::toSnapshot);
    }

    @Transactional(readOnly = true)
    public EffectiveReminderRules resolveEffectiveForScheduling(
            UUID householdId, UUID commitmentId) {
        Optional<ReminderRuleSetEntity> commitmentRuleSet =
                ruleSetRepository.findCommitment(commitmentId);
        if (commitmentRuleSet.isPresent()) {
            ReminderRuleSetEntity override = commitmentRuleSet.orElseThrow();
            if (!override.householdId().equals(householdId)) {
                return EffectiveReminderRules.disabled();
            }
            if (override.mode() == ReminderRuleMode.DISABLED) {
                return EffectiveReminderRules.disabled();
            }
            if (override.mode() == ReminderRuleMode.CUSTOM) {
                return effective(override, override.activatedAt());
            }
        }

        Optional<ReminderRuleSetEntity> householdRuleSet =
                ruleSetRepository.findHousehold(householdId);
        if (householdRuleSet.isEmpty()
                || householdRuleSet.orElseThrow().mode() != ReminderRuleMode.CUSTOM) {
            return EffectiveReminderRules.disabled();
        }
        ReminderRuleSetEntity inherited = householdRuleSet.orElseThrow();
        Instant activatedAt = inherited.activatedAt();
        if (commitmentRuleSet.isPresent()) {
            Instant overrideActivation = commitmentRuleSet.orElseThrow().activatedAt();
            if (overrideActivation.isAfter(activatedAt)) {
                activatedAt = overrideActivation;
            }
        }
        return effective(inherited, activatedAt);
    }

    private EffectiveReminderRules effective(
            ReminderRuleSetEntity ruleSet, Instant activatedAt) {
        List<ReminderRuleSnapshot> rules =
                orderedRules(ruleSet.id()).stream()
                        .filter(ReminderRuleEntity::enabled)
                        .map(ReminderRuleEntity::toSnapshot)
                        .toList();
        return rules.isEmpty()
                ? EffectiveReminderRules.disabled()
                : new EffectiveReminderRules(true, activatedAt, rules);
    }

    private ReminderRuleSetSnapshot toSnapshot(ReminderRuleSetEntity ruleSet) {
        return new ReminderRuleSetSnapshot(
                ruleSet.id(),
                ruleSet.householdId(),
                ruleSet.commitmentId(),
                ruleSet.mode(),
                ruleSet.activatedAt(),
                orderedRules(ruleSet.id()).stream()
                        .map(ReminderRuleEntity::toSnapshot)
                        .toList(),
                ruleSet.version());
    }

    private CommitmentResponse requireMutableCommitment(Jwt jwt, UUID commitmentId) {
        CommitmentResponse commitment = commitmentService.get(jwt, commitmentId);
        if (commitment.status() == CommitmentStatus.ARCHIVED) {
            throw new ResourceNotFoundException();
        }
        return commitment;
    }

    private void saveRules(UUID ruleSetId, List<ValidatedRule> rules, Instant now) {
        if (rules.isEmpty()) {
            return;
        }
        ruleRepository.saveAll(
                rules.stream()
                        .map(
                                rule ->
                                        ReminderRuleEntity.create(
                                                ruleSetId,
                                                rule.channel(),
                                                rule.offsetDays(),
                                                rule.localSendTime(),
                                                rule.enabled(),
                                                now))
                        .toList());
        ruleRepository.flush();
    }

    private ReminderRuleSetResponse toResponse(
            ReminderRuleSetEntity ruleSet, boolean includeSuggestions) {
        List<ReminderRuleResponse> rules =
                orderedRules(ruleSet.id()).stream()
                        .map(ReminderRuleService::toResponse)
                        .toList();
        return new ReminderRuleSetResponse(
                ruleSet.id(),
                ruleSet.householdId(),
                ruleSet.commitmentId(),
                ruleSet.mode(),
                rules,
                includeSuggestions ? SUGGESTED_RULES : List.of(),
                ruleSet.version(),
                ruleSet.updatedAt());
    }

    private List<ReminderRuleEntity> orderedRules(UUID ruleSetId) {
        return ruleRepository.findByRuleSetId(ruleSetId).stream()
                .sorted(RULE_ORDER)
                .toList();
    }

    private static ReminderRuleSetResponse syntheticHousehold(UUID householdId) {
        return new ReminderRuleSetResponse(
                null,
                householdId,
                null,
                ReminderRuleMode.DISABLED,
                List.of(),
                SUGGESTED_RULES,
                0,
                null);
    }

    private static ReminderRuleSetResponse syntheticCommitment(
            UUID householdId, UUID commitmentId) {
        return new ReminderRuleSetResponse(
                null,
                householdId,
                commitmentId,
                ReminderRuleMode.INHERIT,
                List.of(),
                List.of(),
                0,
                null);
    }

    private static ReminderRuleResponse toResponse(ReminderRuleEntity rule) {
        return new ReminderRuleResponse(
                rule.channel(),
                rule.offsetDays(),
                MINUTE_TIME.format(rule.localSendTime()),
                rule.enabled());
    }

    private static List<ValidatedRule> validate(
            UpdateReminderRuleSetRequest request, boolean commitmentScope) {
        if (!commitmentScope && request.mode() == ReminderRuleMode.INHERIT) {
            throw new ValidationException("Household reminder rules cannot use INHERIT.");
        }
        if (request.mode() == ReminderRuleMode.CUSTOM && request.rules().isEmpty()) {
            throw new ValidationException("CUSTOM reminder rules require at least one rule.");
        }
        if (request.mode() != ReminderRuleMode.CUSTOM && !request.rules().isEmpty()) {
            throw new ValidationException("Only CUSTOM reminder rules may contain rules.");
        }

        Set<RuleIdentity> identities = new HashSet<>();
        List<ValidatedRule> validated = new ArrayList<>(request.rules().size());
        for (ReminderRuleInput input : request.rules()) {
            RuleIdentity identity = new RuleIdentity(input.channel(), input.offsetDays());
            if (!identities.add(identity)) {
                throw new ValidationException(
                        "Each channel and offsetDays combination must be unique.");
            }
            try {
                validated.add(
                        new ValidatedRule(
                                input.channel(),
                                input.offsetDays(),
                                LocalTime.parse(input.localSendTime(), MINUTE_TIME),
                                input.enabled()));
            } catch (DateTimeParseException exception) {
                throw new ValidationException("localSendTime must use HH:mm minute precision.");
            }
        }
        return List.copyOf(validated);
    }

    private static void verifyVersion(
            ReminderRuleSetEntity ruleSet, long expectedVersion) {
        if (ruleSet.version() != expectedVersion) {
            throw new PreconditionFailedException();
        }
    }

    private static List<ReminderRuleResponse> suggestedRules() {
        List<ReminderRuleResponse> rules = new ArrayList<>();
        for (NotificationChannel channel : NotificationChannel.values()) {
            for (int offset : List.of(7, 3, 1)) {
                rules.add(new ReminderRuleResponse(channel, offset, "09:00", true));
            }
        }
        return List.copyOf(rules);
    }

    private record RuleIdentity(NotificationChannel channel, int offsetDays) {}

    private record ValidatedRule(
            NotificationChannel channel,
            int offsetDays,
            LocalTime localSendTime,
            boolean enabled) {}
}
