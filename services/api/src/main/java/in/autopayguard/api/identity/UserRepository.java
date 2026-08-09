package in.autopayguard.api.identity;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface UserRepository extends JpaRepository<UserEntity, UUID> {

    Optional<UserEntity> findByOidcSubject(String oidcSubject);

    @Query(
            value =
                    """
                    SELECT CASE WHEN COUNT(*) > 0 THEN TRUE ELSE FALSE END
                    FROM deletion_tombstones
                    WHERE subject_hash = :subjectHash
                    """,
            nativeQuery = true)
    boolean existsDeletionTombstoneBySubjectHash(
            @Param("subjectHash") String subjectHash);
}
