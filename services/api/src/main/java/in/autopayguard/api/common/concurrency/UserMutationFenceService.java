package in.autopayguard.api.common.concurrency;

import in.autopayguard.api.common.error.ResourceNotFoundException;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserMutationFenceService {

    private final JdbcTemplate jdbcTemplate;

    UserMutationFenceService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void lockLiveUser(UUID userId) {
        List<UUID> rows =
                jdbcTemplate.query(
                        """
                        SELECT id
                        FROM users
                        WHERE id = ? AND deleted_at IS NULL
                        FOR UPDATE
                        """,
                        (resultSet, rowNumber) ->
                                resultSet.getObject("id", UUID.class),
                        userId);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException();
        }
    }
}
