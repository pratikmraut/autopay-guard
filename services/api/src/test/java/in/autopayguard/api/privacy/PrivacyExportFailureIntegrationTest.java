package in.autopayguard.api.privacy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class PrivacyExportFailureIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbcTemplate;

    @MockitoBean private PrivacyExportService exportService;

    @Test
    void oversizedExportPersistsFailedWithoutAReadyOrPartialArtifact()
            throws Exception {
        when(exportService.build(any(), any()))
                .thenThrow(new PrivacyExportService.ExportTooLargeException());

        assertFailedExport(
                identity(
                        "m5-oversized-export-subject",
                        "m5-oversized-export@example.test"),
                "privacy-oversized-export");
    }

    @Test
    void incompleteExportPersistsFailedWithoutAReadyOrPartialArtifact()
            throws Exception {
        when(exportService.build(any(), any()))
                .thenThrow(
                        new IllegalStateException(
                                "Injected incomplete subject inventory."));

        assertFailedExport(
                identity(
                        "m5-incomplete-export-subject",
                        "m5-incomplete-export@example.test"),
                "privacy-incomplete-export");
    }

    private void assertFailedExport(
            JwtRequestPostProcessor requester, String idempotencyKey)
            throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/v1/privacy/requests")
                                        .with(requester)
                                        .header(
                                                "Idempotency-Key",
                                                idempotencyKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "requestType": "EXPORT"
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.status").value("FAILED"))
                        .andReturn();
        UUID requestId =
                UUID.fromString(
                        JsonPath.read(
                                created.getResponse().getContentAsString(),
                                "$.id"));

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT COUNT(*)
                                FROM privacy_export_artifacts
                                WHERE request_id = ?
                                """,
                                Integer.class,
                                requestId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForList(
                                """
                                SELECT to_status
                                FROM privacy_request_events
                                WHERE request_id = ?
                                """,
                                String.class,
                                requestId))
                .containsExactlyInAnyOrder(
                        "REQUESTED", "PROCESSING", "FAILED");

        mockMvc.perform(
                        get(
                                        "/v1/privacy/requests/{requestId}/export",
                                        requestId)
                                .with(requester))
                .andExpect(status().isConflict());
    }

    private static JwtRequestPostProcessor identity(
            String subject, String email) {
        return jwt()
                .jwt(
                        token ->
                                token.subject(subject)
                                        .claim("email", email)
                                        .claim("name", "Export Failure Subject"))
                .authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }
}
