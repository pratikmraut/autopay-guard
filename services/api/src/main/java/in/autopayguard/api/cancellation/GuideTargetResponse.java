package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "GuideTarget", requiredProperties = {"label", "uri"})
public record GuideTargetResponse(String label, @Schema(format = "uri") String uri) {}
