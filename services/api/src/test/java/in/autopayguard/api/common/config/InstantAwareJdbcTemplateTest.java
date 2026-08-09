package in.autopayguard.api.common.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class InstantAwareJdbcTemplateTest {

    @Test
    void convertsInstantArgumentsToUtcOffsetDateTimeWithoutMutatingTheCallerArray() {
        Instant timestamp = Instant.parse("2026-07-28T12:34:56Z");
        Object marker = new Object();
        Object[] arguments = {timestamp, marker, null};

        Object[] databaseArguments = InstantAwareJdbcTemplate.databaseArguments(arguments);

        assertThat(databaseArguments)
                .containsExactly(
                        OffsetDateTime.ofInstant(timestamp, ZoneOffset.UTC), marker, null);
        assertThat(arguments).containsExactly(timestamp, marker, null);
    }

    @Test
    void preservesNullArgumentArrays() {
        assertThat(InstantAwareJdbcTemplate.databaseArguments(null)).isNull();
    }
}
