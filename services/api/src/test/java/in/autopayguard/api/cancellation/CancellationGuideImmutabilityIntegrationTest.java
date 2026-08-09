package in.autopayguard.api.cancellation;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@ActiveProfiles("test")
class CancellationGuideImmutabilityIntegrationTest {

    private static final UUID GUIDE_ID =
            UUID.fromString("40000000-0000-4000-8000-000000000001");

    @Autowired private EntityManager entityManager;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void hibernateCannotDirtyUpdatePublishedGuideHistory() {
        String originalNotice =
                jdbcTemplate.queryForObject(
                        """
                        SELECT risk_notice
                        FROM cancellation_guide_versions
                        WHERE guide_id = ? AND version = 1
                        """,
                        String.class,
                        GUIDE_ID);
        String originalInstruction =
                jdbcTemplate.queryForObject(
                        """
                        SELECT instruction
                        FROM cancellation_guide_steps
                        WHERE guide_id = ?
                          AND guide_version = 1
                          AND track = 'SERVICE'
                          AND sequence_number = 1
                        """,
                        String.class,
                        GUIDE_ID);

        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        ignored -> {
                            CancellationGuideVersionEntity version =
                                    entityManager.find(
                                            CancellationGuideVersionEntity.class,
                                            new GuideVersionId(GUIDE_ID, 1));
                            CancellationGuideStepEntity step =
                                    entityManager.find(
                                            CancellationGuideStepEntity.class,
                                            new GuideStepId(
                                                    GUIDE_ID,
                                                    1,
                                                    GuideTrackKind.SERVICE,
                                                    1));
                            ReflectionTestUtils.setField(
                                    version,
                                    "riskNotice",
                                    "attempted ORM rewrite");
                            ReflectionTestUtils.setField(
                                    step,
                                    "instruction",
                                    "attempted ORM step rewrite");
                            entityManager.flush();
                        });

        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT risk_notice
                                FROM cancellation_guide_versions
                                WHERE guide_id = ? AND version = 1
                                """,
                                String.class,
                                GUIDE_ID))
                .isEqualTo(originalNotice);
        assertThat(
                        jdbcTemplate.queryForObject(
                                """
                                SELECT instruction
                                FROM cancellation_guide_steps
                                WHERE guide_id = ?
                                  AND guide_version = 1
                                  AND track = 'SERVICE'
                                  AND sequence_number = 1
                                """,
                                String.class,
                                GUIDE_ID))
                .isEqualTo(originalInstruction);
    }
}
