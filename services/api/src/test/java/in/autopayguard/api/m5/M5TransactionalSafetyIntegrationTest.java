package in.autopayguard.api.m5;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.autopayguard.api.common.rate.OperationRateLimiter;
import in.autopayguard.api.common.security.OpaqueCodes;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.Execution;
import org.junit.jupiter.api.parallel.ExecutionMode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Execution(ExecutionMode.SAME_THREAD)
class M5TransactionalSafetyIntegrationTest {

    private static final UUID SOURCE_GUIDE_ID =
            UUID.fromString("40000000-0000-4000-8000-000000000001");
    private static final String TOMBSTONE_DOMAIN =
            "autopay-guard/deletion-tombstone/v1:";
    private static final String INVITATION_IDEMPOTENCY_CONSTRAINT =
            "ck_test_m5_invitation_idempotency";
    private static final String SUPPORT_AUDIT_CONSTRAINT =
            "ck_test_m5_support_audit";
    private static final String CORRECTION_IDEMPOTENCY_CONSTRAINT =
            "ck_test_m5_correction_idempotency";
    private static final String DELETION_AUDIT_CONSTRAINT =
            "ck_test_m5_deletion_audit";
    private static final String GUIDE_IDEMPOTENCY_CONSTRAINT =
            "ck_test_m5_guide_idempotency";

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;

    private final Set<String> subjects = new HashSet<>();
    private final Set<UUID> householdIds = new HashSet<>();
    private final Set<GuideFixture> guideFixtures = new HashSet<>();

    @BeforeEach
    void removeOrphanedFaultInjectionConstraints() {
        dropFaultInjectionConstraints();
    }

    @AfterEach
    void cleanIsolatedFixtures() {
        dropFaultInjectionConstraints();

        for (String subject : subjects) {
            jdbcTemplate.update(
                    "DELETE FROM operation_rate_events WHERE actor_key = ?",
                    OperationRateLimiter.actorKeyForSubject(subject));
            jdbcTemplate.update(
                    "DELETE FROM deletion_tombstones WHERE subject_hash = ?",
                    OpaqueCodes.sha256(TOMBSTONE_DOMAIN + subject));
        }

        List<UUID> userIds = new ArrayList<>();
        for (String subject : subjects) {
            userIds.addAll(
                    jdbcTemplate.query(
                            "SELECT id FROM users WHERE oidc_subject = ?",
                            (row, rowNumber) -> row.getObject("id", UUID.class),
                            subject));
        }
        for (UUID userId : userIds) {
            jdbcTemplate.update(
                    "DELETE FROM audit_event_locks WHERE actor_user_id = ?",
                    userId);
            jdbcTemplate.update(
                    "DELETE FROM audit_events WHERE actor_user_id = ?", userId);
            jdbcTemplate.update(
                    "DELETE FROM m5_idempotency_records WHERE actor_user_id = ?",
                    userId);
            jdbcTemplate.update(
                    "DELETE FROM guide_lifecycle_event_locks WHERE actor_user_id = ?",
                    userId);
            jdbcTemplate.update(
                    "DELETE FROM guide_lifecycle_events WHERE actor_user_id = ?",
                    userId);
            jdbcTemplate.update(
                    "DELETE FROM privacy_request_event_locks WHERE actor_user_id = ?",
                    userId);
            jdbcTemplate.update(
                    "DELETE FROM privacy_request_events WHERE actor_user_id = ?",
                    userId);
        }
        for (UUID userId : userIds) {
            List<UUID> requestIds =
                    jdbcTemplate.query(
                            "SELECT id FROM privacy_requests WHERE requester_user_id = ?",
                            (row, rowNumber) -> row.getObject("id", UUID.class),
                            userId);
            for (UUID requestId : requestIds) {
                jdbcTemplate.update(
                        "DELETE FROM privacy_export_artifacts WHERE request_id = ?",
                        requestId);
                jdbcTemplate.update(
                        "DELETE FROM privacy_request_event_locks WHERE request_id = ?",
                        requestId);
                jdbcTemplate.update(
                        "DELETE FROM privacy_request_events WHERE request_id = ?",
                        requestId);
            }
            jdbcTemplate.update(
                    "DELETE FROM privacy_requests WHERE requester_user_id = ?",
                    userId);
            jdbcTemplate.update(
                    "DELETE FROM consent_event_locks WHERE user_id = ?", userId);
            jdbcTemplate.update(
                    "DELETE FROM consent_events WHERE user_id = ?", userId);
            jdbcTemplate.update(
                    "DELETE FROM privacy_notice_acknowledgement_locks WHERE user_id = ?",
                    userId);
            jdbcTemplate.update(
                    "DELETE FROM privacy_notice_acknowledgements WHERE user_id = ?",
                    userId);
        }

        for (UUID householdId : householdIds) {
            jdbcTemplate.update(
                    "DELETE FROM support_diagnostic_grants WHERE household_id = ?",
                    householdId);
            jdbcTemplate.update(
                    "DELETE FROM household_invitations WHERE household_id = ?",
                    householdId);
            jdbcTemplate.update(
                    "DELETE FROM recurring_commitments WHERE household_id = ?",
                    householdId);
            jdbcTemplate.update(
                    "DELETE FROM household_members WHERE household_id = ?",
                    householdId);
            jdbcTemplate.update(
                    "DELETE FROM households WHERE id = ?", householdId);
        }

        for (GuideFixture fixture : guideFixtures) {
            jdbcTemplate.update(
                    "DELETE FROM audit_event_locks WHERE resource_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM audit_events WHERE resource_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM guide_lifecycle_event_locks WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM guide_lifecycle_events WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_published_target_locks WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_published_step_locks WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_published_version_locks WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_guide_draft_states WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_guide_catalog_state WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_guide_steps WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_guide_versions WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_guide_locks WHERE guide_id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM cancellation_guides WHERE id = ?",
                    fixture.guideId());
            jdbcTemplate.update(
                    "DELETE FROM merchants WHERE id = ?", fixture.merchantId());
        }

        for (UUID userId : userIds) {
            jdbcTemplate.update("DELETE FROM users WHERE id = ?", userId);
        }
        subjects.clear();
        householdIds.clear();
        guideFixtures.clear();
    }

    @Test
    void concurrentInvitationCreationHasExactlyOneWinnerAndOneAudit()
            throws Exception {
        TestIdentity owner = user("invite-create-owner");
        TestIdentity invitee = user("invite-create-member");
        UUID householdId = createHousehold(owner, "Concurrent invite household");
        provision(invitee);
        grantSharing(owner);
        grantSharing(invitee);

        List<MvcResult> results =
                concurrently(
                        () -> createInvitation(owner, householdId, invitee.email()),
                        () -> createInvitation(owner, householdId, invitee.email()));

        assertStatuses(results, 201, 409);
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM household_invitations
                                WHERE household_id = ? AND invitee_email = ?
                                  AND status = 'PENDING'
                                """,
                                householdId,
                                invitee.email()))
                .isOne();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM audit_events
                                WHERE actor_user_id = ?
                                  AND action = 'HOUSEHOLD_INVITATION_CREATED'
                                """,
                                userId(owner)))
                .isOne();
    }

    @Test
    void concurrentInvitationAcceptanceHasOneTerminalWinner()
            throws Exception {
        TestIdentity owner = user("invite-accept-owner");
        TestIdentity invitee = user("invite-accept-member");
        UUID householdId = createHousehold(owner, "Concurrent accept household");
        provision(invitee);
        grantSharing(owner);
        grantSharing(invitee);
        MvcResult invitation = createInvitation(owner, householdId, invitee.email());
        String code = read(invitation, "$.invitationCode");
        UUID invitationId =
                UUID.fromString(read(invitation, "$.invitation.id"));

        List<MvcResult> results =
                concurrently(
                        () ->
                                acceptInvitation(
                                        invitee,
                                        code,
                                        "m5-accept-concurrent-key-01"),
                        () ->
                                acceptInvitation(
                                        invitee,
                                        code,
                                        "m5-accept-concurrent-key-02"));

        assertStatuses(results, 200, 404);
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM household_members
                                WHERE household_id = ? AND user_id = ?
                                  AND role = 'MEMBER' AND status = 'ACTIVE'
                                """,
                                householdId,
                                userId(invitee)))
                .isOne();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM household_invitations
                                WHERE id = ? AND status = 'ACCEPTED'
                                """,
                                invitationId))
                .isOne();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'HOUSEHOLD_INVITATION_ACCEPTED'
                                """,
                                invitationId))
                .isOne();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM m5_idempotency_records
                                WHERE actor_user_id = ?
                                  AND operation = 'INVITATION_ACCEPT'
                                """,
                                userId(invitee)))
                .isOne();
    }

    @Test
    void concurrentSupportCodeCreationLeavesOneActiveGrant()
            throws Exception {
        TestIdentity owner = user("support-create-owner");
        UUID householdId = createHousehold(owner, "Concurrent support household");

        List<MvcResult> results =
                concurrently(
                        () -> createSupportCode(owner, householdId),
                        () -> createSupportCode(owner, householdId));

        assertStatuses(results, 201, 409);
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM support_diagnostic_grants
                                WHERE household_id = ? AND status = 'ACTIVE'
                                """,
                                householdId))
                .isOne();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM audit_events
                                WHERE actor_user_id = ?
                                  AND action = 'SUPPORT_GRANT_CREATED'
                                """,
                                userId(owner)))
                .isOne();
    }

    @Test
    void sharingAndMemberRemovalNeverLeaveResponsibilityOnRemovedMember()
            throws Exception {
        TestIdentity owner = user("sharing-race-owner");
        TestIdentity member = user("sharing-race-member");
        UUID householdId = createHousehold(owner, "Sharing race household");
        provision(member);
        grantSharing(owner);
        grantSharing(member);
        MvcResult invitation = createInvitation(owner, householdId, member.email());
        acceptInvitation(
                member,
                read(invitation, "$.invitationCode"),
                "m5-sharing-race-accept");
        UUID memberId =
                jdbcTemplate.queryForObject(
                        """
                        SELECT id FROM household_members
                        WHERE household_id = ? AND user_id = ?
                        """,
                        UUID.class,
                        householdId,
                        userId(member));
        UUID commitmentId =
                insertCommitment(householdId, userId(owner), null);

        List<MvcResult> results =
                concurrently(
                        () ->
                                mockMvc.perform(
                                                patch(
                                                                "/v1/commitments/{id}/sharing",
                                                                commitmentId)
                                                        .with(owner.auth())
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"0\"")
                                                        .contentType(
                                                                MediaType
                                                                        .APPLICATION_JSON)
                                                        .content(
                                                                """
                                                                {
                                                                  "visibility": "HOUSEHOLD",
                                                                  "responsibleMemberId": "%s"
                                                                }
                                                                """
                                                                        .formatted(
                                                                                memberId)))
                                        .andReturn(),
                        () ->
                                mockMvc.perform(
                                                delete(
                                                                "/v1/households/{householdId}/members/{memberId}",
                                                                householdId,
                                                                memberId)
                                                        .with(owner.auth())
                                                        .header(
                                                                HttpHeaders.IF_MATCH,
                                                                "\"0\""))
                                        .andReturn());

        assertThat(results.get(0).getResponse().getStatus()).isIn(200, 404);
        assertThat(results.get(1).getResponse().getStatus()).isEqualTo(204);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT status FROM household_members WHERE id = ?",
                                String.class,
                                memberId))
                .isEqualTo("REMOVED");
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT responsible_member_id
                                FROM recurring_commitments
                                WHERE id = ?
                                """,
                                UUID.class,
                                commitmentId))
                .isNull();
    }

    @Test
    void privacyCancellationAndProcessingHaveOneStateTransitionWinner()
            throws Exception {
        TestIdentity requester = user("privacy-cancel-race");
        TestIdentity administrator = privacyAdmin("privacy-cancel-admin");
        provision(requester);
        provision(administrator);
        UUID requestId =
                createPrivacyRequest(
                        requester,
                        "m5-cancel-race-create",
                        "CORRECTION",
                        "Europe/Paris");

        List<MvcResult> results =
                concurrently(
                        () ->
                                cancelPrivacyRequest(
                                        requester,
                                        requestId,
                                        "m5-cancel-race-transition"),
                        () ->
                                executePrivacyRequest(
                                        administrator,
                                        requestId,
                                        "m5-cancel-race-execute"));

        assertStatuses(results, 200, 412);
        String finalStatus =
                jdbcTemplate.queryForObject(
                        "SELECT status FROM privacy_requests WHERE id = ?",
                        String.class,
                        requestId);
        assertThat(finalStatus).isIn("CANCELLED", "EXECUTED");
        String timezone =
                jdbcTemplate.queryForObject(
                        "SELECT timezone FROM users WHERE id = ?",
                        String.class,
                        userId(requester));
        if ("EXECUTED".equals(finalStatus)) {
            assertThat(timezone).isEqualTo("Europe/Paris");
        } else {
            assertThat(timezone).isEqualTo("Asia/Kolkata");
        }
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM audit_events
                                WHERE resource_id = ?
                                  AND action IN (
                                      'PRIVACY_REQUEST_CANCELLED',
                                      'PRIVACY_CORRECTION_EXECUTED'
                                  )
                                """,
                                requestId))
                .isOne();
    }

    @Test
    void concurrentCorrectionExecutionChangesTimezoneExactlyOnce()
            throws Exception {
        TestIdentity requester = user("privacy-execute-race");
        TestIdentity administrator = privacyAdmin("privacy-execute-admin");
        provision(requester);
        provision(administrator);
        UUID requestId =
                createPrivacyRequest(
                        requester,
                        "m5-execute-race-create",
                        "CORRECTION",
                        "Europe/Paris");

        List<MvcResult> results =
                concurrently(
                        () ->
                                executePrivacyRequest(
                                        administrator,
                                        requestId,
                                        "m5-execute-race-key-01"),
                        () ->
                                executePrivacyRequest(
                                        administrator,
                                        requestId,
                                        "m5-execute-race-key-02"));

        assertStatuses(results, 200, 412);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT status FROM privacy_requests WHERE id = ?",
                                String.class,
                                requestId))
                .isEqualTo("EXECUTED");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT timezone FROM users WHERE id = ?",
                                String.class,
                                userId(requester)))
                .isEqualTo("Europe/Paris");
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'PRIVACY_CORRECTION_EXECUTED'
                                """,
                                requestId))
                .isOne();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM m5_idempotency_records
                                WHERE actor_user_id = ?
                                  AND operation = 'PRIVACY_TRANSITION'
                                """,
                                userId(administrator)))
                .isOne();
    }

    @RepeatedTest(10)
    void deletionAndInvitationAcceptanceResolveToOneSafeHouseholdState()
            throws Exception {
        TestIdentity owner = user("deletion-race-owner");
        TestIdentity invitee = user("deletion-race-member");
        TestIdentity administrator = privacyAdmin("deletion-race-admin");
        UUID householdId = createHousehold(owner, "Deletion race household");
        provision(invitee);
        provision(administrator);
        grantSharing(owner);
        grantSharing(invitee);
        MvcResult invitation = createInvitation(owner, householdId, invitee.email());
        UUID requestId =
                createPrivacyRequest(
                        owner,
                        "m5-deletion-race-create",
                        "DELETION",
                        null);

        List<MvcResult> results =
                concurrently(
                        () ->
                                acceptInvitation(
                                        invitee,
                                        read(invitation, "$.invitationCode"),
                                        "m5-deletion-race-accept"),
                        () ->
                                executePrivacyRequest(
                                        administrator,
                                        requestId,
                                        "m5-deletion-race-execute"));

        assertThat(results.get(0).getResponse().getStatus())
                .withFailMessage(
                        "Invitation response: %s; resolved exception: %s",
                        results.get(0).getResponse().getContentAsString(),
                        results.get(0).getResolvedException())
                .isIn(200, 404);
        assertThat(results.get(1).getResponse().getStatus())
                .withFailMessage(
                        "Deletion response: %s; resolved exception: %s",
                        results.get(1).getResponse().getContentAsString(),
                        results.get(1).getResolvedException())
                .isEqualTo(200);
        boolean tombstoned =
                count(
                                """
                                SELECT COUNT(*)
                                FROM deletion_tombstones
                                WHERE subject_hash = ?
                                """,
                                OpaqueCodes.sha256(
                                        TOMBSTONE_DOMAIN + owner.subject()))
                        == 1;
        if (tombstoned) {
            assertThat(
                            count(
                                    "SELECT COUNT(*) FROM users WHERE oidc_subject = ?",
                                    owner.subject()))
                    .isZero();
            assertThat(
                            count(
                                    "SELECT COUNT(*) FROM households WHERE id = ?",
                                    householdId))
                    .isZero();
            assertThat(results.get(0).getResponse().getStatus()).isEqualTo(404);
        } else {
            assertThat(
                            jdbcTemplate.queryForObject(
                                    "SELECT status FROM privacy_requests WHERE id = ?",
                                    String.class,
                                    requestId))
                    .isEqualTo("BLOCKED");
            assertThat(
                            count(
                                    """
                                    SELECT COUNT(*) FROM household_members
                                    WHERE household_id = ? AND status = 'ACTIVE'
                                    """,
                                    householdId))
                    .isEqualTo(2);
            assertThat(results.get(0).getResponse().getStatus()).isEqualTo(200);
        }
    }

    @Test
    void concurrentGuidePublicationHasOneHeadWinner()
            throws Exception {
        TestIdentity administrator = guideAdmin("guide-publish-race");
        provision(administrator);
        GuideFixture fixture = insertGuideFixture();
        UUID draftId =
                createGuideDraft(
                        administrator,
                        fixture.guideId(),
                        "m5-guide-draft-race-create");

        List<MvcResult> results =
                concurrently(
                        () ->
                                publishGuide(
                                        administrator,
                                        draftId,
                                        "m5-guide-publish-race-01"),
                        () ->
                                publishGuide(
                                        administrator,
                                        draftId,
                                        "m5-guide-publish-race-02"));

        assertStatuses(results, 200, 412);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT current_published_version
                                FROM cancellation_guide_catalog_state
                                WHERE guide_id = ?
                                """,
                                Integer.class,
                                fixture.guideId()))
                .isEqualTo(2);
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM guide_lifecycle_events
                                WHERE guide_id = ? AND guide_version = 2
                                  AND action = 'PUBLISHED'
                                """,
                                fixture.guideId()))
                .isOne();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*)
                                FROM m5_idempotency_records
                                WHERE actor_user_id = ?
                                  AND operation = 'GUIDE_PUBLISH'
                                """,
                                userId(administrator)))
                .isOne();
    }

    @Test
    void publicationAndRetirementNeverLoseTheNewPublishedHead()
            throws Exception {
        TestIdentity administrator = guideAdmin("guide-publish-retire-race");
        provision(administrator);
        GuideFixture fixture = insertGuideFixture();
        UUID draftId =
                createGuideDraft(
                        administrator,
                        fixture.guideId(),
                        "m5-guide-publish-retire-draft");

        List<MvcResult> results =
                concurrently(
                        () ->
                                publishGuide(
                                        administrator,
                                        draftId,
                                        "m5-guide-publish-retire-publish"),
                        () ->
                                retireGuide(
                                        administrator,
                                        fixture.guideId(),
                                        "m5-guide-publish-retire-retire"));

        int publishStatus = results.get(0).getResponse().getStatus();
        int retireStatus = results.get(1).getResponse().getStatus();
        assertThat(publishStatus).isEqualTo(200);
        assertThat(retireStatus).isIn(200, 412);
        assertThat(
                        jdbcTemplate.queryForMap(
                                """
                                SELECT state, current_published_version
                                FROM cancellation_guide_catalog_state
                                WHERE guide_id = ?
                                """,
                                fixture.guideId()))
                .containsEntry("state", "ACTIVE")
                .containsEntry("current_published_version", 2);
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM guide_lifecycle_events
                                WHERE guide_id = ? AND action = 'PUBLISHED'
                                """,
                                fixture.guideId()))
                .isOne();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM guide_lifecycle_events
                                WHERE guide_id = ? AND action = 'RETIRED'
                                """,
                                fixture.guideId()))
                .isEqualTo(retireStatus == 200 ? 1 : 0);
    }

    @Test
    void ownerGuideResolutionRacingRetirementIsNeverPartiallyVisible()
            throws Exception {
        TestIdentity owner = user("guide-owner-race");
        TestIdentity administrator = guideAdmin("guide-retire-admin");
        UUID householdId = createHousehold(owner, "Guide owner race household");
        provision(administrator);
        GuideFixture fixture = insertGuideFixture();
        UUID commitmentId =
                insertCommitment(
                        householdId,
                        userId(owner),
                        fixture.merchantId());

        List<MvcResult> results =
                concurrently(
                        () ->
                                mockMvc.perform(
                                                get(
                                                                "/v1/commitments/{id}/cancellation-guide",
                                                                commitmentId)
                                                        .with(owner.auth()))
                                        .andReturn(),
                        () ->
                                retireGuide(
                                        administrator,
                                        fixture.guideId(),
                                        "m5-guide-owner-retire-race"));

        assertThat(results.get(0).getResponse().getStatus()).isIn(200, 404);
        if (results.get(0).getResponse().getStatus() == 200) {
            assertThat(read(results.get(0), "$.id"))
                    .isEqualTo(fixture.guideId().toString());
            assertThat((Integer) JsonPath.read(
                            results.get(0).getResponse().getContentAsString(),
                            "$.version"))
                    .isEqualTo(1);
        }
        assertThat(results.get(1).getResponse().getStatus()).isEqualTo(200);
        assertThat(
                        jdbcTemplate.queryForMap(
                                """
                                SELECT state, current_published_version
                                FROM cancellation_guide_catalog_state
                                WHERE guide_id = ?
                                """,
                                fixture.guideId()))
                .containsEntry("state", "RETIRED")
                .containsEntry("current_published_version", null);
    }

    @Test
    void invitationAcceptanceRollsBackMemberAuditAndIdempotencyTogether()
            throws Exception {
        TestIdentity owner = user("invite-rollback-owner");
        TestIdentity invitee = user("invite-rollback-member");
        UUID householdId = createHousehold(owner, "Invitation rollback household");
        provision(invitee);
        grantSharing(owner);
        grantSharing(invitee);
        MvcResult invitation = createInvitation(owner, householdId, invitee.email());
        UUID invitationId =
                UUID.fromString(read(invitation, "$.invitation.id"));
        UUID inviteeId = userId(invitee);
        jdbcTemplate.execute(
                """
                ALTER TABLE m5_idempotency_records
                ADD CONSTRAINT %s
                CHECK (
                    operation <> 'INVITATION_ACCEPT'
                    OR actor_user_id <> CAST('%s' AS UUID)
                )
                """
                        .formatted(
                                INVITATION_IDEMPOTENCY_CONSTRAINT,
                                inviteeId));
        try {
            mockMvc.perform(
                            post("/v1/household-invitations/accept")
                                    .with(invitee.auth())
                                    .header(
                                            "Idempotency-Key",
                                            "m5-invitation-rollback-key")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {"invitationCode":"%s"}
                                            """
                                                    .formatted(
                                                            read(
                                                                    invitation,
                                                                    "$.invitationCode"))))
                    .andExpect(status().isConflict());
        } finally {
            dropConstraint(
                    "m5_idempotency_records",
                    INVITATION_IDEMPOTENCY_CONSTRAINT);
        }

        assertThat(
                        jdbcTemplate.queryForMap(
                                """
                                SELECT status, pending_key, accepted_by_user_id
                                FROM household_invitations WHERE id = ?
                                """,
                                invitationId))
                .containsEntry("status", "PENDING")
                .containsEntry("accepted_by_user_id", null);
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM household_members
                                WHERE household_id = ? AND user_id = ?
                                """,
                                householdId,
                                inviteeId))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'HOUSEHOLD_INVITATION_ACCEPTED'
                                """,
                                invitationId))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM m5_idempotency_records
                                WHERE actor_user_id = ?
                                  AND operation = 'INVITATION_ACCEPT'
                                """,
                                inviteeId))
                .isZero();
    }

    @Test
    void supportGrantRollsBackWhenItsAuditSnapshotCannotBeWritten()
            throws Exception {
        TestIdentity owner = user("support-rollback-owner");
        UUID householdId = createHousehold(owner, "Support rollback household");
        UUID ownerId = userId(owner);
        jdbcTemplate.execute(
                """
                ALTER TABLE audit_event_locks
                ADD CONSTRAINT %s
                CHECK (
                    actor_user_id <> CAST('%s' AS UUID)
                    OR action <> 'SUPPORT_GRANT_CREATED'
                )
                """
                        .formatted(SUPPORT_AUDIT_CONSTRAINT, ownerId));
        try {
            mockMvc.perform(
                            post(
                                            "/v1/households/{householdId}/support-codes",
                                            householdId)
                                    .with(owner.auth())
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {"acknowledgeReadOnlyDiagnostics":true}
                                            """))
                    .andExpect(status().isConflict());
        } finally {
            dropConstraint("audit_event_locks", SUPPORT_AUDIT_CONSTRAINT);
        }

        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM support_diagnostic_grants
                                WHERE household_id = ?
                                """,
                                householdId))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM audit_events
                                WHERE actor_user_id = ?
                                  AND action = 'SUPPORT_GRANT_CREATED'
                                """,
                                ownerId))
                .isZero();
    }

    @Test
    void correctionRollsBackStateEventsUserAuditAndIdempotencyTogether()
            throws Exception {
        TestIdentity requester = user("correction-rollback-owner");
        TestIdentity administrator = privacyAdmin("correction-rollback-admin");
        provision(requester);
        provision(administrator);
        UUID requestId =
                createPrivacyRequest(
                        requester,
                        "m5-correction-rollback-create",
                        "CORRECTION",
                        "Europe/Paris");
        UUID administratorId = userId(administrator);
        jdbcTemplate.execute(
                """
                ALTER TABLE m5_idempotency_records
                ADD CONSTRAINT %s
                CHECK (
                    operation <> 'PRIVACY_TRANSITION'
                    OR actor_user_id <> CAST('%s' AS UUID)
                )
                """
                        .formatted(
                                CORRECTION_IDEMPOTENCY_CONSTRAINT,
                                administratorId));
        try {
            MvcResult result =
                    executePrivacyRequest(
                            administrator,
                            requestId,
                            "m5-correction-rollback-execute");
            assertThat(result.getResponse().getStatus()).isEqualTo(409);
        } finally {
            dropConstraint(
                    "m5_idempotency_records",
                    CORRECTION_IDEMPOTENCY_CONSTRAINT);
        }

        assertThat(
                        jdbcTemplate.queryForMap(
                                """
                                SELECT status, optimistic_version
                                FROM privacy_requests WHERE id = ?
                                """,
                                requestId))
                .containsEntry("status", "REQUESTED")
                .containsEntry("optimistic_version", 0L);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT timezone FROM users WHERE id = ?",
                                String.class,
                                userId(requester)))
                .isEqualTo("Asia/Kolkata");
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM privacy_request_events
                                WHERE request_id = ?
                                  AND from_status <> 'NONE'
                                """,
                                requestId))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'PRIVACY_CORRECTION_EXECUTED'
                                """,
                                requestId))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM m5_idempotency_records
                                WHERE actor_user_id = ?
                                  AND operation = 'PRIVACY_TRANSITION'
                                """,
                                administratorId))
                .isZero();
    }

    @Test
    void deletionRollsBackErasureTombstoneEventsAndAuditTogether()
            throws Exception {
        TestIdentity requester = user("deletion-rollback-owner");
        TestIdentity administrator = privacyAdmin("deletion-rollback-admin");
        UUID householdId = createHousehold(requester, "Deletion rollback household");
        provision(administrator);
        UUID requestId =
                createPrivacyRequest(
                        requester,
                        "m5-deletion-rollback-create",
                        "DELETION",
                        null);
        UUID administratorId = userId(administrator);
        jdbcTemplate.execute(
                """
                ALTER TABLE audit_event_locks
                ADD CONSTRAINT %s
                CHECK (
                    actor_user_id <> CAST('%s' AS UUID)
                    OR action <> 'PRIVACY_DELETION_EXECUTED'
                )
                """
                        .formatted(DELETION_AUDIT_CONSTRAINT, administratorId));
        try {
            MvcResult result =
                    executePrivacyRequest(
                            administrator,
                            requestId,
                            "m5-deletion-rollback-execute");
            assertThat(result.getResponse().getStatus()).isEqualTo(409);
        } finally {
            dropConstraint("audit_event_locks", DELETION_AUDIT_CONSTRAINT);
        }

        assertThat(
                        count(
                                "SELECT COUNT(*) FROM users WHERE oidc_subject = ?",
                                requester.subject()))
                .isOne();
        assertThat(
                        count(
                                "SELECT COUNT(*) FROM households WHERE id = ?",
                                householdId))
                .isOne();
        assertThat(
                        jdbcTemplate.queryForMap(
                                """
                                SELECT status, optimistic_version
                                FROM privacy_requests WHERE id = ?
                                """,
                                requestId))
                .containsEntry("status", "REQUESTED")
                .containsEntry("optimistic_version", 0L);
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM deletion_tombstones
                                WHERE subject_hash = ?
                                """,
                                OpaqueCodes.sha256(
                                        TOMBSTONE_DOMAIN
                                                + requester.subject())))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'PRIVACY_DELETION_EXECUTED'
                                """,
                                requestId))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM privacy_request_events
                                WHERE request_id = ?
                                  AND from_status <> 'NONE'
                                """,
                                requestId))
                .isZero();
    }

    @Test
    void guidePublicationRollsBackHeadLocksLifecycleAuditAndIdempotency()
            throws Exception {
        TestIdentity administrator = guideAdmin("guide-rollback-admin");
        provision(administrator);
        GuideFixture fixture = insertGuideFixture();
        UUID draftId =
                createGuideDraft(
                        administrator,
                        fixture.guideId(),
                        "m5-guide-rollback-draft");
        UUID administratorId = userId(administrator);
        jdbcTemplate.execute(
                """
                ALTER TABLE m5_idempotency_records
                ADD CONSTRAINT %s
                CHECK (
                    operation <> 'GUIDE_PUBLISH'
                    OR actor_user_id <> CAST('%s' AS UUID)
                )
                """
                        .formatted(
                                GUIDE_IDEMPOTENCY_CONSTRAINT,
                                administratorId));
        try {
            MvcResult result =
                    publishGuide(
                            administrator,
                            draftId,
                            "m5-guide-rollback-publish");
            assertThat(result.getResponse().getStatus()).isEqualTo(409);
        } finally {
            dropConstraint(
                    "m5_idempotency_records",
                    GUIDE_IDEMPOTENCY_CONSTRAINT);
        }

        assertThat(
                        jdbcTemplate.queryForMap(
                                """
                                SELECT state, current_published_version,
                                       optimistic_version
                                FROM cancellation_guide_catalog_state
                                WHERE guide_id = ?
                                """,
                                fixture.guideId()))
                .containsEntry("state", "ACTIVE")
                .containsEntry("current_published_version", 1)
                .containsEntry("optimistic_version", 0L);
        assertThat(
                        jdbcTemplate.queryForMap(
                                """
                                SELECT v.status, d.optimistic_version
                                FROM cancellation_guide_draft_states d
                                JOIN cancellation_guide_versions v
                                  ON v.guide_id = d.guide_id
                                 AND v.version = d.guide_version
                                WHERE d.draft_id = ?
                                """,
                                draftId))
                .containsEntry("status", "DRAFT")
                .containsEntry("optimistic_version", 0L);
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM cancellation_published_version_locks
                                WHERE guide_id = ? AND version = 2
                                """,
                                fixture.guideId()))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM guide_lifecycle_events
                                WHERE guide_id = ? AND action = 'PUBLISHED'
                                """,
                                fixture.guideId()))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM audit_events
                                WHERE resource_id = ?
                                  AND action = 'GUIDE_PUBLISHED'
                                """,
                                fixture.guideId()))
                .isZero();
        assertThat(
                        count(
                                """
                                SELECT COUNT(*) FROM m5_idempotency_records
                                WHERE actor_user_id = ?
                                  AND operation = 'GUIDE_PUBLISH'
                                """,
                                administratorId))
                .isZero();
    }

    private MvcResult createInvitation(
            TestIdentity owner, UUID householdId, String inviteeEmail)
            throws Exception {
        return mockMvc.perform(
                        post(
                                        "/v1/households/{householdId}/invitations",
                                        householdId)
                                .with(owner.auth())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"inviteeEmail":"%s"}
                                        """
                                                .formatted(inviteeEmail)))
                .andReturn();
    }

    private MvcResult acceptInvitation(
            TestIdentity invitee, String code, String idempotencyKey)
            throws Exception {
        return mockMvc.perform(
                        post("/v1/household-invitations/accept")
                                .with(invitee.auth())
                                .header("Idempotency-Key", idempotencyKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"invitationCode":"%s"}
                                        """
                                                .formatted(code)))
                .andReturn();
    }

    private MvcResult createSupportCode(
            TestIdentity owner, UUID householdId) throws Exception {
        return mockMvc.perform(
                        post(
                                        "/v1/households/{householdId}/support-codes",
                                        householdId)
                                .with(owner.auth())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"acknowledgeReadOnlyDiagnostics":true}
                                        """))
                .andReturn();
    }

    private MvcResult cancelPrivacyRequest(
            TestIdentity requester, UUID requestId, String idempotencyKey)
            throws Exception {
        return mockMvc.perform(
                        post(
                                        "/v1/privacy/requests/{requestId}/cancel",
                                        requestId)
                                .with(requester.auth())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header("Idempotency-Key", idempotencyKey))
                .andReturn();
    }

    private MvcResult executePrivacyRequest(
            TestIdentity administrator,
            UUID requestId,
            String idempotencyKey)
            throws Exception {
        return mockMvc.perform(
                        post(
                                        "/v1/admin/privacy/requests/{requestId}/execute",
                                        requestId)
                                .with(administrator.auth())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header("Idempotency-Key", idempotencyKey))
                .andReturn();
    }

    private MvcResult publishGuide(
            TestIdentity administrator, UUID draftId, String idempotencyKey)
            throws Exception {
        return mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guide-drafts/{draftId}/publish",
                                        draftId)
                                .with(administrator.auth())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header("Idempotency-Key", idempotencyKey))
                .andReturn();
    }

    private MvcResult retireGuide(
            TestIdentity administrator, UUID guideId, String idempotencyKey)
            throws Exception {
        return mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guides/{guideId}/retire",
                                        guideId)
                                .with(administrator.auth())
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header("Idempotency-Key", idempotencyKey))
                .andReturn();
    }

    private UUID createHousehold(TestIdentity owner, String name)
            throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(owner.auth())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "name": "%s",
                                                  "defaultCurrency": "INR",
                                                  "timezone": "Asia/Kolkata",
                                                  "ageConfirmed": true,
                                                  "privacyNoticeAccepted": true,
                                                  "privacyNoticeVersion": "foundation-v1"
                                                }
                                                """
                                                        .formatted(name)))
                        .andExpect(status().isCreated())
                        .andReturn();
        UUID householdId = UUID.fromString(read(result, "$.id"));
        householdIds.add(householdId);
        return householdId;
    }

    private void provision(TestIdentity identity) throws Exception {
        mockMvc.perform(get("/v1/me").with(identity.auth()))
                .andExpect(status().isOk());
    }

    private void grantSharing(TestIdentity identity) throws Exception {
        mockMvc.perform(
                        post("/v1/privacy/notice-acknowledgements")
                                .with(identity.auth())
                                .header(
                                        "Idempotency-Key",
                                        "m5-notice-"
                                                + UUID.randomUUID())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"noticeVersion":"foundation-v1"}
                                        """))
                .andExpect(status().isCreated());
        mockMvc.perform(
                        post("/v1/privacy/consents")
                                .with(identity.auth())
                                .header(
                                        "Idempotency-Key",
                                        "m5-sharing-"
                                                + UUID.randomUUID())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "purpose": "HOUSEHOLD_SHARING",
                                          "purposeVersion": "foundation-v1",
                                          "action": "GRANTED"
                                        }
                                        """))
                .andExpect(status().isCreated());
    }

    private UUID createPrivacyRequest(
            TestIdentity requester,
            String idempotencyKey,
            String requestType,
            String correctionValue)
            throws Exception {
        String body =
                correctionValue == null
                        ? """
                          {"requestType":"%s"}
                          """
                                .formatted(requestType)
                        : """
                          {
                            "requestType":"%s",
                            "correctionValue":"%s"
                          }
                          """
                                .formatted(requestType, correctionValue);
        MvcResult result =
                mockMvc.perform(
                                post("/v1/privacy/requests")
                                        .with(requester.auth())
                                        .header(
                                                "Idempotency-Key",
                                                idempotencyKey)
                                        .contentType(
                                                MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andReturn();
        return UUID.fromString(read(result, "$.id"));
    }

    private UUID createGuideDraft(
            TestIdentity administrator, UUID guideId, String idempotencyKey)
            throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post(
                                                "/v1/admin/cancellation-guides/{guideId}/drafts",
                                                guideId)
                                        .with(administrator.auth())
                                        .header(
                                                "Idempotency-Key",
                                                idempotencyKey))
                        .andExpect(status().isCreated())
                        .andReturn();
        return UUID.fromString(read(result, "$.draftId"));
    }

    private UUID insertCommitment(
            UUID householdId, UUID ownerId, UUID merchantId) {
        UUID commitmentId = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO recurring_commitments (
                    id, household_id, data_owner_user_id,
                    responsible_member_id, merchant_id, display_name,
                    category, payment_rail, amount_minor,
                    estimated_amount_minor, currency, frequency,
                    interval_count, custom_interval_unit, anchor_date,
                    month_day_policy, next_due_date, variable_amount,
                    masked_payment_label, source, source_confidence,
                    visibility, status, optimistic_version,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, ?, NULL, ?, 'M5 transaction safety commitment',
                    'SUBSCRIPTION', 'UNKNOWN', 500, NULL, 'INR',
                    'MONTHLY', 1, NULL, ?, 'ANCHOR_DAY', ?, FALSE,
                    NULL, 'MANUAL', NULL, 'PRIVATE', 'ACTIVE', 0,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                commitmentId,
                householdId,
                ownerId,
                merchantId,
                LocalDate.of(2026, 8, 5),
                LocalDate.of(2026, 8, 5));
        return commitmentId;
    }

    private GuideFixture insertGuideFixture() {
        UUID merchantId = UUID.randomUUID();
        UUID guideId = UUID.randomUUID();
        String suffix = guideId.toString().replace("-", "");
        Instant now = Instant.now();
        jdbcTemplate.update(
                """
                INSERT INTO merchants (
                    id, canonical_name, normalized_name, category,
                    country_code, website_host, created_at
                ) VALUES (?, ?, ?, 'SUBSCRIPTION', 'IN', ?, ?)
                """,
                merchantId,
                "M5 Safety Merchant " + suffix,
                "m5 safety merchant " + suffix,
                "m5-" + suffix + ".example",
                now);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guides (id, merchant_id, created_at)
                VALUES (?, ?, ?)
                """,
                guideId,
                merchantId,
                now);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_locks (
                    guide_id, merchant_id, created_at
                ) VALUES (?, ?, ?)
                """,
                guideId,
                merchantId,
                now);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_versions (
                    guide_id, version, status, risk_notice,
                    structural_reviewed_at, review_interval_days,
                    published_at, created_at
                ) VALUES (?, 1, 'PUBLISHED',
                          'Fictional transaction-safety fixture only.',
                          ?, 60, ?, ?)
                """,
                guideId,
                now,
                now,
                now);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_steps (
                    guide_id, guide_version, track, sequence_number,
                    action_type, title, instruction, target_key, target_uri
                )
                SELECT ?, 1, track, sequence_number, action_type,
                       title, instruction, target_key, target_uri
                FROM cancellation_guide_steps
                WHERE guide_id = ? AND guide_version = 1
                """,
                guideId,
                SOURCE_GUIDE_ID);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_published_version_locks (
                    guide_id, version, status, risk_notice,
                    structural_reviewed_at, review_interval_days,
                    published_at, created_at
                )
                SELECT guide_id, version, status, risk_notice,
                       structural_reviewed_at, review_interval_days,
                       published_at, created_at
                FROM cancellation_guide_versions
                WHERE guide_id = ? AND version = 1
                """,
                guideId);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_published_step_locks (
                    guide_id, guide_version, track, sequence_number,
                    action_type, title, instruction
                )
                SELECT guide_id, guide_version, track, sequence_number,
                       action_type, title, instruction
                FROM cancellation_guide_steps
                WHERE guide_id = ? AND guide_version = 1
                """,
                guideId);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_published_target_locks (
                    guide_id, guide_version, track, sequence_number,
                    action_type, title, instruction, target_key, target_uri
                )
                SELECT guide_id, guide_version, track, sequence_number,
                       action_type, title, instruction, target_key, target_uri
                FROM cancellation_guide_steps
                WHERE guide_id = ? AND guide_version = 1
                  AND target_key IS NOT NULL
                """,
                guideId);
        jdbcTemplate.update(
                """
                INSERT INTO cancellation_guide_catalog_state (
                    guide_id, current_published_version, state,
                    optimistic_version, updated_at
                ) VALUES (?, 1, 'ACTIVE', 0, ?)
                """,
                guideId,
                now);
        GuideFixture fixture = new GuideFixture(guideId, merchantId);
        guideFixtures.add(fixture);
        return fixture;
    }

    @SafeVarargs
    private final List<MvcResult> concurrently(Callable<MvcResult>... requests)
            throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(requests.length)) {
            List<Future<MvcResult>> futures = new ArrayList<>();
            for (Callable<MvcResult> request : requests) {
                futures.add(
                        executor.submit(
                                () -> {
                                    if (!start.await(5, TimeUnit.SECONDS)) {
                                        throw new IllegalStateException(
                                                "Concurrent test start timed out.");
                                    }
                                    return request.call();
                                }));
            }
            start.countDown();
            List<MvcResult> results = new ArrayList<>();
            for (Future<MvcResult> future : futures) {
                results.add(future.get(15, TimeUnit.SECONDS));
            }
            return results;
        }
    }

    private static void assertStatuses(
            List<MvcResult> results, int... expectedStatuses) {
        List<Integer> actual =
                results.stream()
                        .map(result -> result.getResponse().getStatus())
                        .sorted()
                        .toList();
        List<Integer> expected =
                java.util.Arrays.stream(expectedStatuses)
                        .boxed()
                        .sorted()
                        .toList();
        List<String> diagnostics =
                results.stream()
                        .map(
                                result -> {
                                    Exception exception = result.getResolvedException();
                                    return "status="
                                            + result.getResponse().getStatus()
                                            + ", exception="
                                            + (exception == null
                                                    ? "none"
                                                    : exception.getClass().getName()
                                                            + ": "
                                                            + exception.getMessage());
                                })
                        .toList();
        assertThat(actual)
                .as("concurrent responses: %s", diagnostics)
                .containsExactlyElementsOf(expected);
    }

    private int count(String sql, Object... arguments) {
        Integer value =
                jdbcTemplate.queryForObject(sql, Integer.class, arguments);
        return value == null ? 0 : value;
    }

    private UUID userId(TestIdentity identity) {
        return jdbcTemplate.queryForObject(
                "SELECT id FROM users WHERE oidc_subject = ?",
                UUID.class,
                identity.subject());
    }

    private TestIdentity user(String prefix) {
        return identity(prefix, "ROLE_USER");
    }

    private TestIdentity privacyAdmin(String prefix) {
        return identity(prefix, "ROLE_PRIVACY_ADMIN");
    }

    private TestIdentity guideAdmin(String prefix) {
        return identity(prefix, "ROLE_GUIDE_ADMIN");
    }

    private TestIdentity identity(String prefix, String authority) {
        String suffix = UUID.randomUUID().toString();
        String subject = prefix + "-" + suffix;
        subjects.add(subject);
        return new TestIdentity(
                subject,
                subject + "@m5.example.test",
                "M5 Transaction Safety",
                authority);
    }

    private static String read(MvcResult result, String path) {
        return JsonPath.read(
                new String(
                        result.getResponse().getContentAsByteArray(),
                        StandardCharsets.UTF_8),
                path);
    }

    private void dropFaultInjectionConstraints() {
        dropConstraint(
                "m5_idempotency_records",
                INVITATION_IDEMPOTENCY_CONSTRAINT);
        dropConstraint("audit_event_locks", SUPPORT_AUDIT_CONSTRAINT);
        dropConstraint(
                "m5_idempotency_records",
                CORRECTION_IDEMPOTENCY_CONSTRAINT);
        dropConstraint("audit_event_locks", DELETION_AUDIT_CONSTRAINT);
        dropConstraint(
                "m5_idempotency_records",
                GUIDE_IDEMPOTENCY_CONSTRAINT);
    }

    private void dropConstraint(String table, String constraint) {
        jdbcTemplate.execute(
                "ALTER TABLE "
                        + table
                        + " DROP CONSTRAINT IF EXISTS "
                        + constraint);
    }

    private record GuideFixture(UUID guideId, UUID merchantId) {}

    private record TestIdentity(
            String subject, String email, String name, String authority) {

        JwtRequestPostProcessor auth() {
            return jwt()
                    .jwt(
                            token ->
                                    token.subject(subject)
                                            .claim("email", email)
                                            .claim("name", name))
                    .authorities(new SimpleGrantedAuthority(authority));
        }
    }
}
