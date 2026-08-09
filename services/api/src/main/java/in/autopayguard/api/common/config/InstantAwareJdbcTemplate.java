package in.autopayguard.api.common.config;

import java.time.Instant;
import java.time.ZoneOffset;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;

final class InstantAwareJdbcTemplate extends JdbcTemplate {

    InstantAwareJdbcTemplate(DataSource dataSource) {
        super(dataSource);
    }

    @Override
    protected PreparedStatementSetter newArgPreparedStatementSetter(Object[] arguments) {
        return super.newArgPreparedStatementSetter(databaseArguments(arguments));
    }

    @Override
    protected PreparedStatementSetter newArgTypePreparedStatementSetter(
            Object[] arguments, int[] argumentTypes) {
        return super.newArgTypePreparedStatementSetter(
                databaseArguments(arguments), argumentTypes);
    }

    static Object[] databaseArguments(Object[] arguments) {
        if (arguments == null) {
            return null;
        }

        Object[] databaseArguments = arguments.clone();
        for (int index = 0; index < databaseArguments.length; index++) {
            if (databaseArguments[index] instanceof Instant instant) {
                databaseArguments[index] = instant.atOffset(ZoneOffset.UTC);
            }
        }
        return databaseArguments;
    }
}
