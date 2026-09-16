package in.autopayguard.api.common.security;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.autopayguard.api.identity.CurrentUserService;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HeaderOnlyBearerAuthenticationIntegrationTest {

    private static final String TOKEN = "header-only-fictional-fixture";

    @Autowired private MockMvc mockMvc;
    @MockitoBean private JwtDecoder decoder;
    @MockitoBean private CurrentUserService currentUserService;

    @ParameterizedTest
    @ValueSource(strings = {
        "/v1/admin/audit-events",
        "/v1/household-invitations",
        "/v1/households/00000000-0000-4000-8000-000000000001/invitations",
        "/v1/privacy/requests/00000000-0000-4000-8000-000000000002/export",
        "/v1/admin/privacy/requests",
        "/v1/privacy/requests/00000000-0000-4000-8000-000000000002",
        "/v1/privacy/requests"
    })
    void cookiesAndQueryTokensCannotReachAnyFlaggedGetHandler(String path) throws Exception {
        mockMvc.perform(get(path)
                        .header(HttpHeaders.ORIGIN, "https://other.example.test")
                        .cookie(new Cookie("JSESSIONID", TOKEN),
                                new Cookie("authjs.session-token", TOKEN),
                                new Cookie("access_token", TOKEN),
                                new Cookie("Authorization", TOKEN))
                        .queryParam("access_token", TOKEN))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
        verifyNoInteractions(decoder, currentUserService);
    }

    @Test
    void formOnlyCredentialsCannotAuthenticateAnUnsafeRequest() throws Exception {
        mockMvc.perform(post("/v1/privacy/requests")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("access_token", TOKEN)
                        .param("username", "fictional-fixture@example.test")
                        .param("password", "not-a-real-password"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(decoder, currentUserService);
    }

    @Test
    void statelessApiIgnoresPreviouslyAuthenticatedHttpSession() throws Exception {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
                new SecurityContextImpl(new JwtAuthenticationToken(fixtureJwt(),
                        List.of(new SimpleGrantedAuthority("ROLE_USER")))));

        mockMvc.perform(get("/v1/me").session(session)
                        .cookie(new Cookie("JSESSIONID", session.getId())))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(decoder, currentUserService);
    }

    @Test
    void basicAuthorizationCannotAuthenticate() throws Exception {
        mockMvc.perform(get("/v1/me")
                        .header(HttpHeaders.AUTHORIZATION, "Basic Zml4dHVyZTpmaXh0dXJl"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(decoder, currentUserService);
    }

    @Test
    void authorizationBearerHeaderAuthenticatesButDoesNotGrantAdminRole() throws Exception {
        when(decoder.decode(TOKEN)).thenReturn(fixtureJwt());

        mockMvc.perform(get("/v1/admin/audit-events")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
        verify(decoder).decode(TOKEN);
        verifyNoInteractions(currentUserService);
    }

    private static Jwt fixtureJwt() {
        return Jwt.withTokenValue(TOKEN)
                .header("alg", "RS256")
                .issuer("https://issuer.test.example/realms/autopay-guard")
                .subject("header-only-fictional-fixture")
                .issuedAt(Instant.now().minusSeconds(60))
                .expiresAt(Instant.now().plusSeconds(300))
                .claim("resource_access", Map.of("autopay-guard-api",
                        Map.of("roles", List.of("USER"))))
                .build();
    }
}
