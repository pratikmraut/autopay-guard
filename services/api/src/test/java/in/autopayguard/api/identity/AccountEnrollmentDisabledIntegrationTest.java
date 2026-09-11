package in.autopayguard.api.identity;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AccountEnrollmentDisabledIntegrationTest {
    @Autowired private MockMvc mvc;

    @Test
    void enrollmentIsClosedByDefault() throws Exception {
        mvc.perform(post("/v1/account/enrollment")
                        .with(jwt().jwt(AccountEnrollmentIntegrationTest.token("disabled", "disabled@example.test"))
                                .authorities(new SimpleGrantedAuthority("ROLE_USER")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ageConfirmed\":true,\"privacyNoticeAccepted\":true,\"privacyNoticeVersion\":\"foundation-v1\"}"))
                .andExpect(status().isForbidden());
    }
}
