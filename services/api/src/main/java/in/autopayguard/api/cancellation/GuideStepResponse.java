package in.autopayguard.api.cancellation;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        name = "GuideStep",
        requiredProperties = {"sequence", "kind", "title", "instruction", "target"})
public record GuideStepResponse(
        int sequence,
        GuideStepKind kind,
        String title,
        String instruction,
        GuideTargetResponse target) {}
