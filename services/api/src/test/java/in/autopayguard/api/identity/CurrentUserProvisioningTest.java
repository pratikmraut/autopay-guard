package in.autopayguard.api.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import in.autopayguard.api.common.error.IdentityClaimsException;
import in.autopayguard.api.common.error.LocalUserNotProvisionedException;
import in.autopayguard.api.common.security.OpaqueCodes;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class CurrentUserProvisioningTest {

    private static final Instant NOW = Instant.parse("2026-08-09T12:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final String TOMBSTONE_DOMAIN =
            "autopay-guard/deletion-tombstone/v1:";

    @Test
    void productionDefaultDoesNotImplicitlyProvisionTokenSubjects() {
        UserRepository repository = mock(UserRepository.class);
        when(repository.findByOidcSubject("unprovisioned-subject"))
                .thenReturn(Optional.empty());
        CurrentUserService service = service(repository, false);

        assertThatThrownBy(
                        () ->
                                service.resolve(
                                        jwt(
                                                "unprovisioned-subject",
                                                "new@example.test",
                                                "New User")))
                .isInstanceOf(LocalUserNotProvisionedException.class);

        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void aDifferentSubjectCannotRebindAnExistingEmail() {
        UserRepository repository = mock(UserRepository.class);
        UserEntity existing =
                UserEntity.create(
                        "immutable-subject",
                        "shared@example.test",
                        "Existing User",
                        NOW.minusSeconds(60));
        when(repository.findByOidcSubject("different-subject"))
                .thenReturn(Optional.empty());
        CurrentUserService service = service(repository, false);

        assertThatThrownBy(
                        () ->
                                service.resolve(
                                        jwt(
                                                "different-subject",
                                                "shared@example.test",
                                                "Replacement User")))
                .isInstanceOf(LocalUserNotProvisionedException.class);

        assertThat(existing.toCurrentUser().email()).isEqualTo("shared@example.test");
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void theSameSubjectKeepsItsLocalIdentityAndProvisionedEmailWhileNameSynchronizes() {
        UserRepository repository = mock(UserRepository.class);
        UserEntity existing =
                UserEntity.create(
                        "immutable-subject",
                        "old@example.test",
                        "Old Name",
                        NOW.minusSeconds(60));
        CurrentUser before = existing.toCurrentUser();
        when(repository.findByOidcSubject("immutable-subject"))
                .thenReturn(Optional.of(existing));
        when(repository.saveAndFlush(any(UserEntity.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        CurrentUserService service = service(repository, false);

        CurrentUser resolved =
                service.resolve(
                        jwt(
                                "immutable-subject",
                                "  OLD@EXAMPLE.TEST ",
                                " Updated Name "));

        assertThat(resolved.id()).isEqualTo(before.id());
        assertThat(resolved.createdAt()).isEqualTo(before.createdAt());
        assertThat(resolved.email()).isEqualTo("old@example.test");
        assertThat(resolved.displayName()).isEqualTo("Updated Name");
        verify(repository).findByOidcSubject("immutable-subject");
        verify(repository).saveAndFlush(existing);
    }

    @Test
    void theSameSubjectCannotSilentlyChangeItsProvisionedEmail() {
        UserRepository repository = mock(UserRepository.class);
        UserEntity existing =
                UserEntity.create(
                        "immutable-subject",
                        "bound@example.test",
                        "Bound User",
                        NOW.minusSeconds(60));
        when(repository.findByOidcSubject("immutable-subject"))
                .thenReturn(Optional.of(existing));
        CurrentUserService service = service(repository, false);

        assertThatThrownBy(
                        () ->
                                service.resolve(
                                        jwt(
                                                "immutable-subject",
                                                "replacement@example.test",
                                                "Replacement User")))
                .isInstanceOf(IdentityClaimsException.class)
                .hasMessageContaining("does not match the provisioned account");

        assertThat(existing.toCurrentUser().email()).isEqualTo("bound@example.test");
        assertThat(existing.toCurrentUser().displayName()).isEqualTo("Bound User");
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void aTombstonedSubjectCannotReturnThroughDevelopmentAutoProvisioning() {
        UserRepository repository = mock(UserRepository.class);
        String subject = "deleted-subject";
        String subjectHash = OpaqueCodes.sha256(TOMBSTONE_DOMAIN + subject);
        when(repository.existsDeletionTombstoneBySubjectHash(subjectHash))
                .thenReturn(true);
        CurrentUserService service = service(repository, true);

        assertThatThrownBy(
                        () ->
                                service.resolve(
                                        jwt(
                                                subject,
                                                "deleted@example.test",
                                                "Deleted User")))
                .isInstanceOf(LocalUserNotProvisionedException.class);

        verify(repository).existsDeletionTombstoneBySubjectHash(subjectHash);
        verify(repository, never()).findByOidcSubject(any());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void verifiedEmailIsRequiredWhenConfigured() {
        UserRepository repository = mock(UserRepository.class);
        CurrentUserService service = service(repository, true, true);

        assertThatThrownBy(
                        () ->
                                service.resolve(
                                        jwt(
                                                "missing-verification-subject",
                                                "missing@example.test",
                                                "Missing Verification")))
                .isInstanceOf(IdentityClaimsException.class)
                .hasMessageContaining("verified email");
        assertThatThrownBy(
                        () ->
                                service.resolve(
                                        jwt(
                                                "unverified-subject",
                                                "unverified@example.test",
                                                "Unverified User",
                                                false)))
                .isInstanceOf(IdentityClaimsException.class)
                .hasMessageContaining("verified email");

        when(repository.findByOidcSubject("verified-subject"))
                .thenReturn(Optional.empty());
        when(repository.saveAndFlush(any(UserEntity.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        CurrentUser verified =
                service.resolve(
                        jwt(
                                "verified-subject",
                                "verified@example.test",
                                "Verified User",
                                true));

        assertThat(verified.email()).isEqualTo("verified@example.test");
    }

    private static CurrentUserService service(
            UserRepository repository, boolean autoProvision) {
        return service(repository, autoProvision, false);
    }

    private static CurrentUserService service(
            UserRepository repository,
            boolean autoProvision,
            boolean requireVerifiedEmail) {
        return new CurrentUserService(
                repository,
                CLOCK,
                new IdentityProperties(autoProvision, requireVerifiedEmail));
    }

    private static Jwt jwt(String subject, String email, String name) {
        return Jwt.withTokenValue("fake")
                .header("alg", "none")
                .subject(subject)
                .claim("email", email)
                .claim("name", name)
                .build();
    }

    private static Jwt jwt(
            String subject, String email, String name, boolean emailVerified) {
        return Jwt.withTokenValue("fake")
                .header("alg", "none")
                .subject(subject)
                .claim("email", email)
                .claim("email_verified", emailVerified)
                .claim("name", name)
                .build();
    }
}
