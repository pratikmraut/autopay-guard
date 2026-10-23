package in.autopayguard.api.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import in.autopayguard.api.identity.CurrentUser;
import in.autopayguard.api.identity.CurrentUserService;
import jakarta.validation.ValidationException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class AdminAuditEventServiceBoundsTest {

    private final CurrentUserService users = mock(CurrentUserService.class);
    private final AuditService audit = mock(AuditService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AdminAuditEventService service = new AdminAuditEventService(users, audit, jdbc);

    @ParameterizedTest
    @ValueSource(ints = {Integer.MIN_VALUE, -1, 0, 101, Integer.MAX_VALUE})
    void invalidLimitIsRejectedBeforeAnyIdentityOrDatabaseMutation(int limit) {
        assertThatThrownBy(() -> service.list(null, null, limit))
                .isInstanceOf(ValidationException.class)
                .hasMessage("limit must be between 1 and 100.");
        verifyNoInteractions(users, audit, jdbc);
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 100})
    @SuppressWarnings("unchecked")
    void validLimitAddsOnlyTheBoundedLookaheadRow(int limit) {
        when(users.resolve(null)).thenReturn(new CurrentUser(
                UUID.randomUUID(), "audit-fixture@example.test", "Audit Fixture", "UTC", "en-IN",
                true, true, "foundation-v1", Instant.EPOCH));
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
                .thenAnswer(invocation -> {
                    assertThat(invocation.getArgument(2, Integer.class)).isEqualTo(limit + 1);
                    return List.of();
                });
        assertThat(service.list(null, null, limit).items()).isEmpty();
    }
}
