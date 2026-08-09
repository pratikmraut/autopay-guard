package in.autopayguard.api.merchant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import in.autopayguard.api.commitment.CommitmentCategory;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MerchantServiceExactMatchTest {

    @Test
    void attachesOnlyOneExactNormalizedCategoryCompatibleMatch() {
        MerchantRepository repository = mock(MerchantRepository.class);
        MerchantEntity entity = mock(MerchantEntity.class);
        MerchantReference reference =
                new MerchantReference(
                        UUID.randomUUID(),
                        "Cloud Nest",
                        CommitmentCategory.SOFTWARE);
        when(repository.findExactCompatible(
                        "cloud nest", CommitmentCategory.SOFTWARE))
                .thenReturn(List.of(entity));
        when(entity.toReference()).thenReturn(reference);

        var result =
                new MerchantService(repository)
                        .findOneExactCompatible(
                                "\uff23\uff4c\uff4f\uff55\uff44\u3000Nest!",
                                CommitmentCategory.SOFTWARE);

        assertThat(result).contains(reference);
        verify(repository)
                .findExactCompatible(
                        "cloud nest", CommitmentCategory.SOFTWARE);
    }

    @Test
    void absentOrAmbiguousExactMatchesRemainMerchantLess() {
        MerchantRepository repository = mock(MerchantRepository.class);
        MerchantEntity first = mock(MerchantEntity.class);
        MerchantEntity second = mock(MerchantEntity.class);
        when(repository.findExactCompatible(
                        "same alias", CommitmentCategory.SUBSCRIPTION))
                .thenReturn(List.of(first, second));
        when(repository.findExactCompatible(
                        "missing", CommitmentCategory.MEMBERSHIP))
                .thenReturn(List.of());
        MerchantService service = new MerchantService(repository);

        assertThat(
                        service.findOneExactCompatible(
                                "Same Alias",
                                CommitmentCategory.SUBSCRIPTION))
                .isEmpty();
        assertThat(
                        service.findOneExactCompatible(
                                "Missing",
                                CommitmentCategory.MEMBERSHIP))
                .isEmpty();
    }
}
