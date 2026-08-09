package in.autopayguard.api.merchant;

import in.autopayguard.api.commitment.CommitmentCategory;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "merchants")
class MerchantEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "canonical_name", nullable = false, length = 160)
    private String canonicalName;

    @Column(name = "normalized_name", nullable = false, length = 160)
    private String normalizedName;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 40)
    private CommitmentCategory category;

    @Column(name = "country_code", nullable = false, length = 2)
    private String countryCode;

    @Column(name = "website_host", nullable = false, length = 253)
    private String websiteHost;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected MerchantEntity() {}

    MerchantSearchItemResponse toResponse() {
        return new MerchantSearchItemResponse(
                id, canonicalName, category, countryCode, websiteHost);
    }

    MerchantReference toReference() {
        return new MerchantReference(id, canonicalName, category);
    }
}
