package in.autopayguard.api.m5;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class M5CursorPaginationIntegrationTest {

    private static final String FOUNDATION_NOTICE_VERSION = "foundation-v1";
    private static final String FOUNDATION_CONTENT_SHA256 =
            "f44a66e435a10f110c1b2eff19abcf60f4978053205c9068c08c6a8bae74b244";
    private static final UUID GUIDE_ONE =
            UUID.fromString("40000000-0000-4000-8000-000000000001");
    private static final UUID GUIDE_TWO =
            UUID.fromString("40000000-0000-4000-8000-000000000002");

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void noticeAcknowledgementsUseScopedUuidCursorAndEnforceLimitBounds()
            throws Exception {
        JwtRequestPostProcessor subject =
                identity(
                        "m5-page-notice-subject",
                        "m5-page-notice-subject@example.test",
                        "Notice Subject");
        UUID subjectId = provision(subject);
        Instant base = Instant.parse("2026-07-28T08:00:00Z");
        UUID oldest = insertNotice(subjectId, "pagination-v1", base);
        UUID middle =
                insertNotice(
                        subjectId,
                        "pagination-v2",
                        base.plus(Duration.ofMinutes(1)));
        UUID newest =
                insertNotice(
                        subjectId,
                        "pagination-v3",
                        base.plus(Duration.ofMinutes(2)));

        MvcResult first =
                mockMvc.perform(
                                get("/v1/privacy/notice-acknowledgements")
                                        .with(subject)
                                        .param("limit", "1"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].id").value(newest.toString()))
                        .andExpect(jsonPath("$.nextCursor").value(newest.toString()))
                        .andReturn();
        String firstCursor = read(first, "$.nextCursor");

        MvcResult second =
                mockMvc.perform(
                                get("/v1/privacy/notice-acknowledgements")
                                        .with(subject)
                                        .param("limit", "1")
                                        .param("cursor", firstCursor))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].id").value(middle.toString()))
                        .andExpect(jsonPath("$.nextCursor").value(middle.toString()))
                        .andReturn();
        assertThat(read(second, "$.items[0].id")).isNotEqualTo(newest.toString());

        mockMvc.perform(
                        get("/v1/privacy/notice-acknowledgements")
                                .with(subject)
                                .param("limit", "1")
                                .param("cursor", read(second, "$.nextCursor")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(oldest.toString()))
                .andExpect(jsonPath("$.nextCursor").value(Matchers.nullValue()));

        JwtRequestPostProcessor foreign =
                identity(
                        "m5-page-notice-foreign",
                        "m5-page-notice-foreign@example.test",
                        "Notice Foreign");
        UUID foreignId = provision(foreign);
        UUID foreignCursor =
                insertNotice(foreignId, "pagination-foreign", base);
        mockMvc.perform(
                        get("/v1/privacy/notice-acknowledgements")
                                .with(subject)
                                .param("cursor", foreignCursor.toString()))
                .andExpect(status().isNotFound());

        assertLimitBounds(
                "/v1/privacy/notice-acknowledgements", subject);
    }

    @Test
    void consentHistoryKeepsGlobalCurrentActionOnOlderPages()
            throws Exception {
        JwtRequestPostProcessor subject =
                identity(
                        "m5-page-consent-subject",
                        "m5-page-consent-subject@example.test",
                        "Consent Subject");
        UUID subjectId = provision(subject);
        Instant base = Instant.parse("2026-07-28T09:00:00Z");
        UUID oldest =
                insertConsent(
                        subjectId,
                        "GRANTED",
                        base);
        UUID middle =
                insertConsent(
                        subjectId,
                        "WITHDRAWN",
                        base.plus(Duration.ofMinutes(1)));
        UUID newest =
                insertConsent(
                        subjectId,
                        "GRANTED",
                        base.plus(Duration.ofMinutes(2)));

        MvcResult first =
                mockMvc.perform(
                                get("/v1/privacy/consents")
                                        .with(subject)
                                        .param("limit", "1"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.events.length()").value(1))
                        .andExpect(jsonPath("$.events[0].id").value(newest.toString()))
                        .andExpect(jsonPath("$.currentAction").value("GRANTED"))
                        .andExpect(jsonPath("$.nextCursor").value(newest.toString()))
                        .andReturn();

        MvcResult second =
                mockMvc.perform(
                                get("/v1/privacy/consents")
                                        .with(subject)
                                        .param("limit", "1")
                                        .param("cursor", read(first, "$.nextCursor")))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.events.length()").value(1))
                        .andExpect(jsonPath("$.events[0].id").value(middle.toString()))
                        .andExpect(jsonPath("$.events[0].action").value("WITHDRAWN"))
                        .andExpect(jsonPath("$.currentAction").value("GRANTED"))
                        .andExpect(jsonPath("$.nextCursor").value(middle.toString()))
                        .andReturn();
        assertThat(read(second, "$.events[0].id"))
                .isNotEqualTo(newest.toString());

        mockMvc.perform(
                        get("/v1/privacy/consents")
                                .with(subject)
                                .param("limit", "1")
                                .param("cursor", read(second, "$.nextCursor")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.events[0].id").value(oldest.toString()))
                .andExpect(jsonPath("$.currentAction").value("GRANTED"))
                .andExpect(jsonPath("$.nextCursor").value(Matchers.nullValue()));

        JwtRequestPostProcessor foreign =
                identity(
                        "m5-page-consent-foreign",
                        "m5-page-consent-foreign@example.test",
                        "Consent Foreign");
        UUID foreignId = provision(foreign);
        UUID foreignCursor = insertConsent(foreignId, "GRANTED", base);
        mockMvc.perform(
                        get("/v1/privacy/consents")
                                .with(subject)
                                .param("cursor", foreignCursor.toString()))
                .andExpect(status().isNotFound());

        assertLimitBounds("/v1/privacy/consents", subject);
    }

    @Test
    void consentHistoryDoesNotInferAWithdrawalWhenNoEventExists()
            throws Exception {
        JwtRequestPostProcessor subject =
                identity(
                        "m5-page-empty-consent-subject",
                        "m5-page-empty-consent-subject@example.test",
                        "Empty Consent Subject");
        provision(subject);

        mockMvc.perform(get("/v1/privacy/consents").with(subject))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.purpose").value("HOUSEHOLD_SHARING"))
                .andExpect(jsonPath("$.currentPurposeVersion")
                        .value(Matchers.nullValue()))
                .andExpect(jsonPath("$.currentAction")
                        .value(Matchers.nullValue()))
                .andExpect(jsonPath("$.events").isEmpty())
                .andExpect(jsonPath("$.nextCursor")
                        .value(Matchers.nullValue()));
    }

    @Test
    void invitationPagesAreScopedAndIncomingPagesPreserveBothConsentSides()
            throws Exception {
        JwtRequestPostProcessor historyOwner =
                identity(
                        "m5-page-history-owner",
                        "m5-page-history-owner@example.test",
                        "History Owner");
        UUID historyHousehold =
                createHousehold(historyOwner, "Pagination history household");
        JwtRequestPostProcessor foreignHistoryOwner =
                identity(
                        "m5-page-history-foreign",
                        "m5-page-history-foreign@example.test",
                        "Foreign History Owner");
        UUID foreignHistoryHousehold =
                createHousehold(
                        foreignHistoryOwner,
                        "Pagination foreign history household");

        Instant historyBase = Instant.now().minus(Duration.ofMinutes(10));
        UUID historyOldest =
                insertInvitation(
                        historyHousehold,
                        "history-oldest@example.test",
                        historyBase);
        UUID historyMiddle =
                insertInvitation(
                        historyHousehold,
                        "history-middle@example.test",
                        historyBase.plus(Duration.ofMinutes(1)));
        UUID historyNewest =
                insertInvitation(
                        historyHousehold,
                        "history-newest@example.test",
                        historyBase.plus(Duration.ofMinutes(2)));
        UUID foreignHistoryCursor =
                insertInvitation(
                        foreignHistoryHousehold,
                        "history-foreign@example.test",
                        historyBase);

        MvcResult historyFirst =
                mockMvc.perform(
                                get(
                                                "/v1/households/{householdId}/invitations",
                                                historyHousehold)
                                        .with(historyOwner)
                                        .param("limit", "1"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items[0].id").value(historyNewest.toString()))
                        .andExpect(jsonPath("$.nextCursor").value(historyNewest.toString()))
                        .andReturn();
        MvcResult historySecond =
                mockMvc.perform(
                                get(
                                                "/v1/households/{householdId}/invitations",
                                                historyHousehold)
                                        .with(historyOwner)
                                        .param("limit", "1")
                                        .param(
                                                "cursor",
                                                read(
                                                        historyFirst,
                                                        "$.nextCursor")))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items[0].id").value(historyMiddle.toString()))
                        .andExpect(jsonPath("$.nextCursor").value(historyMiddle.toString()))
                        .andReturn();
        assertThat(read(historySecond, "$.items[0].id"))
                .isNotEqualTo(historyNewest.toString());
        mockMvc.perform(
                        get(
                                        "/v1/households/{householdId}/invitations",
                                        historyHousehold)
                                .with(historyOwner)
                                .param("limit", "1")
                                .param(
                                        "cursor",
                                        read(historySecond, "$.nextCursor")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(historyOldest.toString()))
                .andExpect(jsonPath("$.nextCursor").value(Matchers.nullValue()));
        mockMvc.perform(
                        get(
                                        "/v1/households/{householdId}/invitations",
                                        historyHousehold)
                                .with(historyOwner)
                                .param("cursor", foreignHistoryCursor.toString()))
                .andExpect(status().isNotFound());
        assertHouseholdInvitationLimitBounds(
                historyHousehold, historyOwner);

        JwtRequestPostProcessor visibleOwnerOne =
                identity(
                        "m5-page-visible-owner-one",
                        "m5-page-visible-owner-one@example.test",
                        "Visible Owner One");
        UUID visibleHouseholdOne =
                createHousehold(
                        visibleOwnerOne,
                        "Pagination visible household one");
        grantSharing(visibleOwnerOne, "page-visible-owner-one-grant");

        JwtRequestPostProcessor hiddenOwner =
                identity(
                        "m5-page-hidden-owner",
                        "m5-page-hidden-owner@example.test",
                        "Hidden Owner");
        UUID hiddenHousehold =
                createHousehold(
                        hiddenOwner,
                        "Pagination hidden household");

        JwtRequestPostProcessor visibleOwnerTwo =
                identity(
                        "m5-page-visible-owner-two",
                        "m5-page-visible-owner-two@example.test",
                        "Visible Owner Two");
        UUID visibleHouseholdTwo =
                createHousehold(
                        visibleOwnerTwo,
                        "Pagination visible household two");
        grantSharing(visibleOwnerTwo, "page-visible-owner-two-grant");

        JwtRequestPostProcessor invitee =
                identity(
                        "m5-page-invitee",
                        "m5-page-invitee@example.test",
                        "Pagination Invitee");
        createHousehold(invitee, "Pagination invitee household");
        grantSharing(invitee, "page-visible-invitee-grant");

        Instant incomingBase = Instant.now().minus(Duration.ofMinutes(5));
        UUID firstVisible =
                insertInvitation(
                        visibleHouseholdOne,
                        "m5-page-invitee@example.test",
                        incomingBase);
        UUID hidden =
                insertInvitation(
                        hiddenHousehold,
                        "m5-page-invitee@example.test",
                        incomingBase.plus(Duration.ofMinutes(1)));
        UUID secondVisible =
                insertInvitation(
                        visibleHouseholdTwo,
                        "m5-page-invitee@example.test",
                        incomingBase.plus(Duration.ofMinutes(2)));

        MvcResult incomingFirst =
                mockMvc.perform(
                                get("/v1/household-invitations")
                                        .with(invitee)
                                        .param("limit", "1"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].id").value(firstVisible.toString()))
                        .andExpect(jsonPath("$.nextCursor").value(firstVisible.toString()))
                        .andReturn();
        MvcResult incomingSecond =
                mockMvc.perform(
                                get("/v1/household-invitations")
                                        .with(invitee)
                                        .param("limit", "1")
                                        .param(
                                                "cursor",
                                                read(
                                                        incomingFirst,
                                                        "$.nextCursor")))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].id").value(secondVisible.toString()))
                        .andExpect(jsonPath("$.nextCursor").value(Matchers.nullValue()))
                        .andReturn();
        assertThat(read(incomingSecond, "$.items[0].id"))
                .isNotIn(firstVisible.toString(), hidden.toString());

        JwtRequestPostProcessor unconsentedInvitee =
                identity(
                        "m5-page-unconsented-invitee",
                        "m5-page-unconsented-invitee@example.test",
                        "Unconsented Invitee");
        createHousehold(
                unconsentedInvitee,
                "Pagination unconsented invitee household");
        insertInvitation(
                visibleHouseholdOne,
                "m5-page-unconsented-invitee@example.test",
                incomingBase.plus(Duration.ofMinutes(3)));
        mockMvc.perform(
                        get("/v1/household-invitations")
                                .with(unconsentedInvitee)
                                .param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0))
                .andExpect(jsonPath("$.nextCursor").value(Matchers.nullValue()));

        mockMvc.perform(
                        get("/v1/household-invitations")
                                .with(invitee)
                                .param("cursor", foreignHistoryCursor.toString()))
                .andExpect(status().isNotFound());
        assertLimitBounds("/v1/household-invitations", invitee);
    }

    @Test
    void householdPagesUseSubjectScopedUuidCursorAndEnforceLimitBounds()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m5-page-household-owner",
                        "m5-page-household-owner@example.test",
                        "Household Page Owner");
        UUID firstHousehold =
                createHousehold(owner, "Pagination household one");
        UUID secondHousehold =
                createHousehold(owner, "Pagination household two");

        MvcResult first =
                mockMvc.perform(
                                get("/v1/households")
                                        .with(owner)
                                        .param("limit", "1"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.nextCursor").isNotEmpty())
                        .andReturn();
        String firstId = read(first, "$.items[0].id");
        String firstCursor = read(first, "$.nextCursor");
        assertThat(firstId).isEqualTo(firstCursor);

        MvcResult second =
                mockMvc.perform(
                                get("/v1/households")
                                        .with(owner)
                                        .param("limit", "1")
                                        .param("cursor", firstCursor))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.nextCursor").value(Matchers.nullValue()))
                        .andReturn();
        assertThat(read(second, "$.items[0].id"))
                .isNotEqualTo(firstId)
                .isIn(firstHousehold.toString(), secondHousehold.toString());

        JwtRequestPostProcessor foreign =
                identity(
                        "m5-page-household-foreign",
                        "m5-page-household-foreign@example.test",
                        "Foreign Household Owner");
        UUID foreignHousehold =
                createHousehold(
                        foreign,
                        "Pagination foreign household");
        mockMvc.perform(
                        get("/v1/households")
                                .with(owner)
                                .param("cursor", foreignHousehold.toString()))
                .andExpect(status().isNotFound());

        assertLimitBounds("/v1/households", owner);
    }

    @Test
    void householdMemberPagesKeepOwnerFirstAndScopeMemberCursors()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m5-page-member-owner",
                        "m5-page-member-owner@example.test",
                        "Member Page Owner");
        UUID householdId =
                createHousehold(owner, "Pagination member household");

        JwtRequestPostProcessor firstMemberIdentity =
                identity(
                        "m5-page-member-one",
                        "m5-page-member-one@example.test",
                        "Member Page One");
        UUID firstMemberUserId = provision(firstMemberIdentity);
        JwtRequestPostProcessor secondMemberIdentity =
                identity(
                        "m5-page-member-two",
                        "m5-page-member-two@example.test",
                        "Member Page Two");
        UUID secondMemberUserId = provision(secondMemberIdentity);
        Instant base = Instant.now().minus(Duration.ofMinutes(2));
        UUID firstMember =
                insertMember(householdId, firstMemberUserId, base);
        UUID secondMember =
                insertMember(
                        householdId,
                        secondMemberUserId,
                        base.plus(Duration.ofMinutes(1)));

        MvcResult first =
                mockMvc.perform(
                                get(
                                                "/v1/households/{householdId}/members",
                                                householdId)
                                        .with(owner)
                                        .param("limit", "1"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].id").value(householdId.toString()))
                        .andExpect(jsonPath("$.items[0].role").value("OWNER"))
                        .andExpect(jsonPath("$.nextCursor").value(householdId.toString()))
                        .andReturn();
        MvcResult second =
                mockMvc.perform(
                                get(
                                                "/v1/households/{householdId}/members",
                                                householdId)
                                        .with(owner)
                                        .param("limit", "1")
                                        .param(
                                                "cursor",
                                                read(first, "$.nextCursor")))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].id").value(firstMember.toString()))
                        .andExpect(jsonPath("$.items[0].role").value("MEMBER"))
                        .andExpect(jsonPath("$.nextCursor").value(firstMember.toString()))
                        .andReturn();
        assertThat(read(second, "$.items[0].id"))
                .isNotEqualTo(householdId.toString());
        mockMvc.perform(
                        get(
                                        "/v1/households/{householdId}/members",
                                        householdId)
                                .with(owner)
                                .param("limit", "1")
                                .param("cursor", read(second, "$.nextCursor")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(secondMember.toString()))
                .andExpect(jsonPath("$.nextCursor").value(Matchers.nullValue()));

        JwtRequestPostProcessor foreignOwner =
                identity(
                        "m5-page-member-foreign-owner",
                        "m5-page-member-foreign-owner@example.test",
                        "Foreign Member Page Owner");
        UUID foreignHouseholdId =
                createHousehold(
                        foreignOwner,
                        "Pagination foreign member household");
        mockMvc.perform(
                        get(
                                        "/v1/households/{householdId}/members",
                                        householdId)
                                .with(owner)
                                .param("cursor", foreignHouseholdId.toString()))
                .andExpect(status().isNotFound());

        assertHouseholdMemberLimitBounds(householdId, owner);
    }

    @Test
    void guideVersionHistoryUsesGuideScopedUuidCursorAndLimitBounds()
            throws Exception {
        JwtRequestPostProcessor admin = guideAdmin();
        mockMvc.perform(
                        post(
                                        "/v1/admin/cancellation-guides/{guideId}/drafts",
                                        GUIDE_ONE)
                                .with(admin)
                                .header(
                                        "Idempotency-Key",
                                        "pagination-guide-draft-0001"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.guideVersion").value(2));

        MvcResult first =
                mockMvc.perform(
                                get(
                                                "/v1/admin/cancellation-guides/{guideId}/versions",
                                                GUIDE_ONE)
                                        .with(admin)
                                        .param("limit", "1"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].guideVersion").value(2))
                        .andExpect(jsonPath("$.nextCursor").isString())
                        .andReturn();
        String cursor = read(first, "$.nextCursor");
        UUID.fromString(cursor);

        MvcResult second =
                mockMvc.perform(
                                get(
                                                "/v1/admin/cancellation-guides/{guideId}/versions",
                                                GUIDE_ONE)
                                        .with(admin)
                                        .param("limit", "1")
                                        .param("cursor", cursor))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].guideVersion").value(1))
                        .andExpect(jsonPath("$.nextCursor").value(Matchers.nullValue()))
                        .andReturn();
        assertThat(read(first, "$.items[0].guideVersion"))
                .isNotEqualTo(read(second, "$.items[0].guideVersion"));

        mockMvc.perform(
                        get(
                                        "/v1/admin/cancellation-guides/{guideId}/versions",
                                        GUIDE_TWO)
                                .with(admin)
                                .param("cursor", cursor))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        get(
                                        "/v1/admin/cancellation-guides/{guideId}/versions",
                                        GUIDE_ONE)
                                .with(admin)
                                .param("cursor", UUID.randomUUID().toString()))
                .andExpect(status().isNotFound());

        assertGuideVersionLimitBounds(GUIDE_ONE, admin);
    }

    private UUID provision(JwtRequestPostProcessor identity) throws Exception {
        MvcResult result =
                mockMvc.perform(get("/v1/me").with(identity))
                        .andExpect(status().isOk())
                        .andReturn();
        return UUID.fromString(read(result, "$.id"));
    }

    private UUID createHousehold(
            JwtRequestPostProcessor identity, String name) throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(identity)
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
        return UUID.fromString(read(result, "$.id"));
    }

    private void grantSharing(
            JwtRequestPostProcessor identity, String idempotencyKey)
            throws Exception {
        mockMvc.perform(
                        post("/v1/privacy/consents")
                                .with(identity)
                                .header("Idempotency-Key", idempotencyKey)
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

    private UUID insertNotice(
            UUID userId, String noticeVersion, Instant acknowledgedAt) {
        UUID id = UUID.randomUUID();
        Object[] values = {
            id,
            userId,
            noticeVersion,
            FOUNDATION_CONTENT_SHA256,
            "ACKNOWLEDGED",
            acknowledgedAt,
            acknowledgedAt
        };
        jdbcTemplate.update(
                """
                INSERT INTO privacy_notice_acknowledgements (
                    id, user_id, notice_version, content_digest,
                    event_type, acknowledged_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        jdbcTemplate.update(
                """
                INSERT INTO privacy_notice_acknowledgement_locks (
                    id, user_id, notice_version, content_digest,
                    event_type, acknowledged_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        return id;
    }

    private UUID insertConsent(UUID userId, String action, Instant occurredAt) {
        UUID id = UUID.randomUUID();
        Object[] values = {
            id,
            userId,
            "HOUSEHOLD_SHARING",
            FOUNDATION_NOTICE_VERSION,
            action,
            occurredAt,
            occurredAt
        };
        jdbcTemplate.update(
                """
                INSERT INTO consent_events (
                    id, user_id, purpose, purpose_version,
                    action, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        jdbcTemplate.update(
                """
                INSERT INTO consent_event_locks (
                    id, user_id, purpose, purpose_version,
                    action, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values);
        return id;
    }

    private UUID insertInvitation(
            UUID householdId, String inviteeEmail, Instant createdAt) {
        UUID id = UUID.randomUUID();
        String compactId = id.toString().replace("-", "");
        jdbcTemplate.update(
                """
                INSERT INTO household_invitations (
                    id, household_id, invitee_email, role,
                    token_hash, pending_key, status,
                    accepted_by_user_id, optimistic_version,
                    expires_at, accepted_at, revoked_at,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 'MEMBER',
                    ?, ?, 'PENDING',
                    NULL, 0,
                    ?, NULL, NULL,
                    ?, ?
                )
                """,
                id,
                householdId,
                inviteeEmail,
                compactId + compactId,
                "pagination-" + id,
                createdAt.plus(Duration.ofDays(1)),
                createdAt,
                createdAt);
        return id;
    }

    private UUID insertMember(
            UUID householdId, UUID userId, Instant joinedAt) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO household_members (
                    id, household_id, user_id, role, status,
                    optimistic_version, joined_at, removed_at,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 'MEMBER', 'ACTIVE',
                    0, ?, NULL, ?, ?
                )
                """,
                id,
                householdId,
                userId,
                joinedAt,
                joinedAt,
                joinedAt);
        return id;
    }

    private void assertLimitBounds(
            String path, JwtRequestPostProcessor identity) throws Exception {
        mockMvc.perform(get(path).with(identity).param("limit", "0"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get(path).with(identity).param("limit", "101"))
                .andExpect(status().isBadRequest());
    }

    private void assertHouseholdInvitationLimitBounds(
            UUID householdId, JwtRequestPostProcessor identity)
            throws Exception {
        mockMvc.perform(
                        get(
                                        "/v1/households/{householdId}/invitations",
                                        householdId)
                                .with(identity)
                                .param("limit", "0"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        get(
                                        "/v1/households/{householdId}/invitations",
                                        householdId)
                                .with(identity)
                                .param("limit", "101"))
                .andExpect(status().isBadRequest());
    }

    private void assertHouseholdMemberLimitBounds(
            UUID householdId, JwtRequestPostProcessor identity)
            throws Exception {
        mockMvc.perform(
                        get(
                                        "/v1/households/{householdId}/members",
                                        householdId)
                                .with(identity)
                                .param("limit", "0"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        get(
                                        "/v1/households/{householdId}/members",
                                        householdId)
                                .with(identity)
                                .param("limit", "101"))
                .andExpect(status().isBadRequest());
    }

    private void assertGuideVersionLimitBounds(
            UUID guideId, JwtRequestPostProcessor identity) throws Exception {
        mockMvc.perform(
                        get(
                                        "/v1/admin/cancellation-guides/{guideId}/versions",
                                        guideId)
                                .with(identity)
                                .param("limit", "0"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        get(
                                        "/v1/admin/cancellation-guides/{guideId}/versions",
                                        guideId)
                                .with(identity)
                                .param("limit", "101"))
                .andExpect(status().isBadRequest());
    }

    private static String read(MvcResult result, String path)
            throws Exception {
        Object value =
                JsonPath.read(
                        result.getResponse().getContentAsString(), path);
        return String.valueOf(value);
    }

    private static JwtRequestPostProcessor identity(
            String subject, String email, String name) {
        return jwt()
                .jwt(
                        token ->
                                token.subject(subject)
                                        .claim("email", email)
                                        .claim("name", name))
                .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }

    private static JwtRequestPostProcessor guideAdmin() {
        return jwt()
                .jwt(
                        token ->
                                token.subject("m5-pagination-guide-admin")
                                        .claim(
                                                "email",
                                                "m5-pagination-guide-admin@example.test")
                                        .claim(
                                                "name",
                                                "Pagination Guide Admin"))
                .authorities(
                        new SimpleGrantedAuthority("ROLE_GUIDE_ADMIN"));
    }
}
