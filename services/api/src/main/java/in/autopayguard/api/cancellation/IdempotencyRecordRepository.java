package in.autopayguard.api.cancellation;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface IdempotencyRecordRepository
        extends JpaRepository<IdempotencyRecordEntity, IdempotencyRecordId> {

    @Query(value = "SELECT id FROM users WHERE id = :userId FOR UPDATE", nativeQuery = true)
    Object lockOwner(@Param("userId") UUID userId);
}
