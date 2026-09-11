package in.autopayguard.api.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.autopayguard.api.common.security.OpaqueCodes;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = {
        "app.identity.self-registration-enabled=true",
        "app.identity.auto-provision=true",
        "spring.datasource.url=jdbc:h2:mem:account_enrollment;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AccountEnrollmentIntegrationTest {
    private static final String ISSUER = "https://issuer.test.example/realms/autopay-guard";
    private static final String PATH = "/v1/account/enrollment";
    private static final String BODY = "{\"ageConfirmed\":true,\"privacyNoticeAccepted\":true,\"privacyNoticeVersion\":\"foundation-v1\"}";
    private static final AccountEnrollmentRequest REQUEST = new AccountEnrollmentRequest(true, true, "foundation-v1");

    @Autowired private MockMvc mvc;
    @Autowired private AccountEnrollmentService service;
    @Autowired private UserRepository repository;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private in.autopayguard.api.privacy.PrivacyRequestService privacyService;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    private CurrentUserService currentUsers;

    @Test
    void explicitEnrollmentIsRequiredThenIdempotentAndNoticeIsRecorded() throws Exception {
        Jwt token = token("new-account", "New.Account@Example.Test");
        mvc.perform(get("/v1/me").with(authentication(token)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ENROLLMENT_REQUIRED"));
        mvc.perform(get("/v1/privacy/notices/current").with(authentication(token)))
                .andExpect(status().isOk());
        assertThat(repository.findByOidcSubject("new-account")).isEmpty();
        String response = mvc.perform(post(PATH).with(authentication(token))
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("new.account@example.test"))
                .andExpect(jsonPath("$.ageConfirmed").value(true))
                .andExpect(jsonPath("$.privacyNoticeAccepted").value(true))
                .andReturn().getResponse().getContentAsString();
        String id = com.jayway.jsonpath.JsonPath.read(response, "$.id");
        mvc.perform(post(PATH).with(authentication(token)).contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        mvc.perform(get("/v1/me").with(authentication(token)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        assertThat(jdbc.queryForObject("SELECT oidc_issuer FROM users WHERE id = ?", String.class, UUID.fromString(id)))
                .isEqualTo(ISSUER);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM privacy_notice_acknowledgements WHERE user_id = ?", Integer.class, UUID.fromString(id)))
                .isOne();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM households WHERE owner_user_id = ?", Integer.class, UUID.fromString(id)))
                .isZero();
    }

    @Test
    void rejectsMissingInvalidAndUnverifiedClaimsEvenWhenDevVerificationIsOff() throws Exception {
        for (Map.Entry<String, Object> invalid : Map.<String, Object>ofEntries(
                Map.entry("iss", "https://wrong.example.test"), Map.entry("sub", " padded "),
                Map.entry("email", "bad address"), Map.entry("email_verified", false),
                Map.entry("name", "x".repeat(201))).entrySet()) {
            Jwt original = token("invalid-profile", "profile@example.test");
            Jwt invalidToken = Jwt.withTokenValue("fake").header("alg", "none")
                    .claims(claims -> { claims.putAll(original.getClaims()); claims.put(invalid.getKey(), invalid.getValue()); }).build();
            mvc.perform(post(PATH).with(authentication(invalidToken)).contentType(MediaType.APPLICATION_JSON).content(BODY))
                    .andExpect(status().isUnprocessableEntity());
        }
        for (String claim : List.of("iss", "sub", "email", "email_verified", "name")) {
            Jwt missing = Jwt.withTokenValue("fake").header("alg", "none")
                    .claims(claims -> { claims.putAll(token("missing-claim", "missing@example.test").getClaims()); claims.remove(claim); }).build();
            mvc.perform(post(PATH).with(authentication(missing)).contentType(MediaType.APPLICATION_JSON).content(BODY))
                    .andExpect(status().isUnprocessableEntity());
        }
        assertThat(repository.findByOidcSubject("invalid-profile")).isEmpty();
        assertThat(repository.findByOidcSubject("missing-claim")).isEmpty();
    }

    @Test
    void rejectsAnonymousStaffMissingAndMixedRoles() throws Exception {
        mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).content(BODY)).andExpect(status().isUnauthorized());
        for (List<String> roles : List.of(List.<String>of(), List.of("GUIDE_ADMIN"), List.of("USER", "GUIDE_ADMIN"), List.of("USER", "USER"))) {
            Jwt invalid = Jwt.withTokenValue("fake").header("alg", "none")
                    .claims(claims -> claims.putAll(token("invalid-role", "role@example.test").getClaims()))
                    .claim("resource_access", Map.of("autopay-guard-api", Map.of("roles", roles))).build();
            // Even a forged ROLE_USER authentication cannot bypass the raw claim check.
            mvc.perform(post(PATH).with(authentication(invalid)).contentType(MediaType.APPLICATION_JSON).content(BODY))
                    .andExpect(status().isForbidden());
        }
    }

    @Test
    void rejectsMissingConsentUnknownIdentityFieldsAndStaleNotice() throws Exception {
        for (String invalid : List.of(BODY.replace("\"ageConfirmed\":true", "\"ageConfirmed\":false"),
                BODY.replace("\"privacyNoticeAccepted\":true", "\"privacyNoticeAccepted\":false"),
                BODY.replace("\"ageConfirmed\":true,", ""),
                BODY.replace("}", ",\"email\":\"attacker@example.test\"}"),
                BODY.replace("}", ",\"password\":\"never-accepted\"}"))) {
            mvc.perform(post(PATH).with(authentication(token("consent", "consent@example.test")))
                            .contentType(MediaType.APPLICATION_JSON).content(invalid)).andExpect(status().isBadRequest());
        }
        mvc.perform(post(PATH).with(authentication(token("consent", "consent@example.test")))
                        .contentType(MediaType.APPLICATION_JSON).content(BODY.replace("foundation-v1", "old-v0")))
                .andExpect(status().isConflict());
        assertThat(repository.findByOidcSubject("consent")).isEmpty();
    }

    @Test
    void emailCollisionsNeverLinkOrExposeAnExistingAccount() throws Exception {
        CurrentUser first = service.enroll(token("first-email", "Same@Example.Test"), REQUEST);
        mvc.perform(post(PATH).with(authentication(token("second-email", "same@example.test")))
                        .contentType(MediaType.APPLICATION_JSON).content(BODY)).andExpect(status().isConflict());
        assertThat(repository.findByOidcSubject("second-email")).isEmpty();
        assertThat(repository.findByOidcSubject("first-email").orElseThrow().toCurrentUser().id()).isEqualTo(first.id());
    }

    @Test
    void deletedIdentityCannotReEnrollOrReceiveEnrollmentRequiredCode() throws Exception {
        jdbc.update("INSERT INTO deletion_tombstones(subject_hash, execution_id, created_at) VALUES (?, ?, ?)",
                OpaqueCodes.sha256("autopay-guard/deletion-tombstone/v1:deleted-signup"), UUID.randomUUID(), Instant.now());
        Jwt token = token("deleted-signup", "deleted-signup@example.test");
        mvc.perform(post(PATH).with(authentication(token)).contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").doesNotExist());
        mvc.perform(get("/v1/me").with(authentication(token)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").doesNotExist());
    }

    @Test
    void issuerCollisionIsDeniedAndSeparateAccountsSeeOnlyTheirOwnWorkspace() throws Exception {
        repository.saveAndFlush(UserEntity.createBound("https://former.example.test", "issuer-collision", "issuer@example.test", "Former", Instant.now()));
        Jwt collision = token("issuer-collision", "issuer@example.test");
        mvc.perform(post(PATH).with(authentication(collision)).contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isForbidden());
        mvc.perform(get("/v1/me").with(authentication(collision))).andExpect(status().isForbidden());
        Jwt alice = token("alice-enrollment", "alice-enrollment@example.test");
        Jwt bob = token("bob-enrollment", "bob-enrollment@example.test");
        assertThat(service.enroll(alice, REQUEST).id()).isNotEqualTo(service.enroll(bob, REQUEST).id());
        mvc.perform(post("/v1/households").with(authentication(alice)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Alice private\",\"defaultCurrency\":\"INR\",\"timezone\":\"Asia/Kolkata\",\"ageConfirmed\":true,\"privacyNoticeAccepted\":true,\"privacyNoticeVersion\":\"foundation-v1\"}"))
                .andExpect(status().isCreated());
        mvc.perform(get("/v1/households").with(authentication(alice))).andExpect(jsonPath("$.items.length()").value(1));
        mvc.perform(get("/v1/households").with(authentication(bob))).andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void concurrentEnrollmentIsIdempotentAcrossTransactions() throws Exception {
        String unique = UUID.randomUUID().toString();
        Jwt token = token(unique, unique + "@example.test");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch go = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<CurrentUser> task = () -> {
                ready.countDown();
                if (!go.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Concurrent start timed out");
                return service.enroll(token, REQUEST);
            };
            var first = executor.submit(task);
            var second = executor.submit(task);
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            go.countDown();
            CurrentUser user = first.get(10, TimeUnit.SECONDS);
            assertThat(second.get(10, TimeUnit.SECONDS).id()).isEqualTo(user.id());
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM privacy_notice_acknowledgements WHERE user_id = ?", Integer.class, user.id())).isOne();
        }
    }

    static Jwt token(String subject, String email) {
        return Jwt.withTokenValue("fake").header("alg", "none").issuer(ISSUER).subject(subject)
                .claim("email", email).claim("email_verified", true).claim("name", "Portfolio Tester")
                .claim("resource_access", Map.of("autopay-guard-api", Map.of("roles", List.of("USER")))).build();
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void deletionCannotPassEnrollmentBetweenTombstoneCheckAndUserLookup() throws Exception {
        String unique = "delete-race-" + UUID.randomUUID();
        Jwt requester = token(unique, unique + "@example.test");
        CurrentUser user = service.enroll(requester, REQUEST);
        Jwt administrator = token("admin-" + unique, "admin-" + unique + "@example.test");
        service.enroll(administrator, REQUEST);
        var request = privacyService.create(requester, UUID.randomUUID().toString(),
                new in.autopayguard.api.privacy.CreateDeletionPrivacyRequest(
                        in.autopayguard.api.privacy.PrivacyRequestType.DELETION));
        CountDownLatch checked = new CountDownLatch(1);
        CountDownLatch releaseEnrollment = new CountDownLatch(1);
        doAnswer(invocation -> {
            invocation.callRealMethod();
            checked.countDown();
            if (!releaseEnrollment.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Enrollment race fence timed out");
            }
            return null;
        }).when(currentUsers).rejectDeletedSubject(unique);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var enrollment = executor.submit(() -> service.enroll(requester, REQUEST));
            assertThat(checked.await(5, TimeUnit.SECONDS)).isTrue();
            var deletion = executor.submit(() -> privacyService.execute(administrator,
                    request.id(), request.version(), UUID.randomUUID().toString()));
            try {
                assertThatThrownBy(() -> deletion.get(200, TimeUnit.MILLISECONDS))
                        .isInstanceOf(java.util.concurrent.TimeoutException.class);
            } finally {
                releaseEnrollment.countDown();
            }
            assertThat(enrollment.get(10, TimeUnit.SECONDS).id()).isEqualTo(user.id());
            assertThat(deletion.get(10, TimeUnit.SECONDS).status())
                    .isEqualTo(in.autopayguard.api.privacy.PrivacyRequestStatus.EXECUTED);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE oidc_subject = ?", Integer.class, unique)).isZero();
            assertThatThrownBy(() -> service.enroll(requester, REQUEST))
                    .isInstanceOf(in.autopayguard.api.common.error.LocalUserNotProvisionedException.class);
        }
    }

    private static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor authentication(Jwt token) {
        return jwt().jwt(token).authorities(new SimpleGrantedAuthority("ROLE_USER"));
    }
}
