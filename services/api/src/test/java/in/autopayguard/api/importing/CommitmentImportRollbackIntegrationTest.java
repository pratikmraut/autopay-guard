package in.autopayguard.api.importing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.autopayguard.api.audit.AuditService;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockPart;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CommitmentImportRollbackIntegrationTest {

    private static final String CSV =
            "name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label\n"
                    + "Rollback fixture,OTHER,10,INR,MONTHLY,2026-08-01,UNKNOWN,\n";
    private static final MediaType SAFE_MULTIPART_FORM_DATA =
            MediaType.parseMediaType(
                    "multipart/form-data;boundary=AutopayGuardM6TestBoundary");

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;
    @MockitoSpyBean private AuditService auditService;

    @Test
    void failureAfterTerminalUpdateRollsBackCommitmentsDecisionsAndStatus()
            throws Exception {
        JwtRequestPostProcessor owner =
                identity(
                        "m6-rollback-owner",
                        "m6-rollback-owner@example.test");
        UUID household = createHousehold(owner);
        MvcResult uploaded = upload(owner, household);
        UUID importId =
                UUID.fromString(
                        JsonPath.read(
                                uploaded.getResponse().getContentAsString(),
                                "$.id"));
        MvcResult preview =
                mockMvc.perform(get("/v1/imports/{id}", importId).with(owner))
                        .andExpect(status().isOk())
                        .andReturn();
        String itemId =
                JsonPath.read(
                        preview.getResponse().getContentAsString(),
                        "$.items[0].id");
        AuditService auditTarget =
                AopTestUtils.getUltimateTargetObject(auditService);
        doAnswer(
                        invocation -> {
                            if (invocation.getArgument(2)
                                    == AuditService.Action.IMPORT_CONFIRMED) {
                                throw new IllegalStateException(
                                        "Injected failure after import update.");
                            }
                            return invocation.callRealMethod();
                        })
                .when(auditTarget)
                .record(any(), any(), any(), any(), any());

        mockMvc.perform(
                        post("/v1/imports/{id}/confirm", importId)
                                .with(owner)
                                .header(HttpHeaders.IF_MATCH, "\"0\"")
                                .header(
                                        "Idempotency-Key",
                                        "m6-rollback-confirm-1")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"selectedItemIds":["%s"]}
                                        """
                                                .formatted(itemId)))
                .andExpect(status().isInternalServerError());

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM recurring_commitments
                                WHERE import_job_id = ?
                                """,
                                Integer.class,
                                importId))
                .isZero();
        var job =
                jdbcTemplate.queryForMap(
                        """
                        SELECT status, raw_payload, raw_processed_at,
                               optimistic_version,
                               selected_item_count, created_commitment_count
                        FROM commitment_import_jobs WHERE id = ?
                        """,
                        importId);
        assertThat(job.get("status")).isEqualTo("PREVIEW_READY");
        assertThat(job.get("raw_payload")).isNull();
        assertThat(job.get("raw_processed_at")).isNotNull();
        assertThat(((Number) job.get("optimistic_version")).longValue())
                .isZero();
        assertThat(((Number) job.get("selected_item_count")).intValue())
                .isZero();
        assertThat(((Number) job.get("created_commitment_count")).intValue())
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM commitment_import_items
                                WHERE import_job_id = ?
                                  AND (
                                      selected IS NOT NULL
                                      OR created_commitment_id IS NOT NULL
                                  )
                                """,
                                Integer.class,
                                importId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT count(*) FROM m5_idempotency_records
                                WHERE operation = 'IMPORT_CONFIRM'
                                  AND resource_id = ?
                                """,
                                Integer.class,
                                importId))
                .isZero();
    }

    private MvcResult upload(
            JwtRequestPostProcessor owner, UUID household) throws Exception {
        MockPart householdPart =
                new MockPart(
                        "householdId",
                        household.toString().getBytes(StandardCharsets.US_ASCII));
        householdPart.getHeaders().setContentType(MediaType.TEXT_PLAIN);
        MockPart file =
                new MockPart(
                        "file",
                        "rollback.csv",
                        CSV.getBytes(StandardCharsets.UTF_8));
        file.getHeaders().setContentType(MediaType.parseMediaType("text/csv"));
        return mockMvc.perform(
                        multipart("/v1/imports")
                                .part(householdPart)
                                .part(file)
                                .contentType(SAFE_MULTIPART_FORM_DATA)
                                .with(owner)
                                .header(
                                        "Idempotency-Key",
                                        "m6-rollback-upload-01"))
                .andExpect(status().isCreated())
                .andReturn();
    }

    private UUID createHousehold(JwtRequestPostProcessor owner)
            throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/v1/households")
                                        .with(owner)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "name": "M6 rollback",
                                                  "defaultCurrency": "INR",
                                                  "timezone": "Asia/Kolkata",
                                                  "ageConfirmed": true,
                                                  "privacyNoticeAccepted": true,
                                                  "privacyNoticeVersion": "foundation-v1"
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn();
        return UUID.fromString(
                JsonPath.read(created.getResponse().getContentAsString(), "$.id"));
    }

    private static JwtRequestPostProcessor identity(
            String subject, String email) {
        return jwt()
                .jwt(
                        token ->
                                token.subject(subject)
                                        .claim("email", email)
                                        .claim("name", "Rollback Owner"))
                .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }
}
