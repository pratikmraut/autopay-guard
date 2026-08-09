package in.autopayguard.api.merchant;

import in.autopayguard.api.commitment.CommitmentCategory;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface MerchantRepository extends JpaRepository<MerchantEntity, UUID> {

    @Query(
            """
            select distinct m
            from MerchantEntity m
            left join MerchantAliasEntity a on a.merchantId = m.id
            where (
                m.normalizedName like concat('%', :term, '%')
                or a.normalizedAlias like concat('%', :term, '%')
            )
              and (:category is null or m.category = :category)
            order by m.canonicalName asc, m.id asc
            """)
    List<MerchantEntity> search(
            @Param("term") String term,
            @Param("category") CommitmentCategory category,
            Pageable pageable);

    @Query(
            """
            select distinct m
            from MerchantEntity m
            left join MerchantAliasEntity a on a.merchantId = m.id
            where m.category = :category
              and (
                m.normalizedName = :term
                or a.normalizedAlias = :term
              )
            order by m.id asc
            """)
    List<MerchantEntity> findExactCompatible(
            @Param("term") String term,
            @Param("category") CommitmentCategory category);
}
