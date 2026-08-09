package in.autopayguard.api.merchant;

import in.autopayguard.api.commitment.CommitmentCategory;
import jakarta.validation.ValidationException;
import java.text.Normalizer;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MerchantService {

    private static final Pattern NON_WORD = Pattern.compile("[^\\p{L}\\p{N}]+");

    private final MerchantRepository merchantRepository;

    MerchantService(MerchantRepository merchantRepository) {
        this.merchantRepository = merchantRepository;
    }

    @Transactional(readOnly = true)
    public MerchantSearchResultsResponse search(
            String rawQuery, CommitmentCategory category, int limit) {
        String query = normalize(rawQuery);
        if (query.length() < 2 || query.length() > 80) {
            throw new ValidationException("q must normalize to between 2 and 80 characters.");
        }
        if (limit < 1 || limit > 20) {
            throw new ValidationException("limit must be between 1 and 20.");
        }
        return new MerchantSearchResultsResponse(
                merchantRepository.search(query, category, PageRequest.of(0, limit)).stream()
                        .map(MerchantEntity::toResponse)
                        .toList());
    }

    @Transactional(readOnly = true)
    public MerchantReference requireCompatible(
            UUID merchantId, CommitmentCategory category) {
        MerchantReference merchant =
                merchantRepository
                        .findById(merchantId)
                        .map(MerchantEntity::toReference)
                        .orElseThrow(
                                () ->
                                        new ValidationException(
                                                "merchantId must identify a catalog merchant."));
        if (merchant.category() != category) {
            throw new ValidationException(
                    "category must match the selected catalog merchant.");
        }
        return merchant;
    }

    @Transactional(readOnly = true)
    public Optional<MerchantReference> findReference(UUID merchantId) {
        if (merchantId == null) {
            return Optional.empty();
        }
        return merchantRepository.findById(merchantId).map(MerchantEntity::toReference);
    }

    @Transactional(readOnly = true)
    public Optional<MerchantReference> findOneExactCompatible(
            String displayName, CommitmentCategory category) {
        String normalized = normalize(displayName);
        if (normalized.isEmpty() || normalized.length() > 160) {
            return Optional.empty();
        }
        var matches = merchantRepository.findExactCompatible(normalized, category);
        return matches.size() == 1
                ? Optional.of(matches.getFirst().toReference())
                : Optional.empty();
    }

    static String normalize(String value) {
        if (value == null) {
            throw new ValidationException("q is required.");
        }
        String normalized =
                Normalizer.normalize(value, Normalizer.Form.NFKC)
                        .toLowerCase(Locale.ROOT)
                        .strip();
        return NON_WORD.matcher(normalized).replaceAll(" ").strip().replaceAll(" +", " ");
    }
}
