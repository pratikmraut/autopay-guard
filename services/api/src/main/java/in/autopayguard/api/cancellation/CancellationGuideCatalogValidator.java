package in.autopayguard.api.cancellation;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class CancellationGuideCatalogValidator implements ApplicationRunner {

    private final CancellationGuideService guideService;

    CancellationGuideCatalogValidator(CancellationGuideService guideService) {
        this.guideService = guideService;
    }

    @Override
    @Transactional(readOnly = true)
    public void run(ApplicationArguments args) {
        guideService.validatePublishedCatalog();
    }
}
