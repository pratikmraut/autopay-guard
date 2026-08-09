package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(name = "GuideTrack", requiredProperties = {"track", "title", "steps"})
public record GuideTrackResponse(
        GuideTrackKind track, String title, List<GuideStepResponse> steps) {}
