package in.autopayguard.api.cancellation;

import org.springframework.data.jpa.repository.JpaRepository;

interface CancellationTargetRepository
        extends JpaRepository<CancellationTargetEntity, String> {}
