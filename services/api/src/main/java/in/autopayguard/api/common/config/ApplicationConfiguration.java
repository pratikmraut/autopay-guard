package in.autopayguard.api.common.config;

import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration(proxyBeanMethods = false)
public class ApplicationConfiguration {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new InstantAwareJdbcTemplate(dataSource);
    }
}
