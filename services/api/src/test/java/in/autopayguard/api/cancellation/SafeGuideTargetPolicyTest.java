package in.autopayguard.api.cancellation;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class SafeGuideTargetPolicyTest {

    private final SafeGuideTargetPolicy policy = new SafeGuideTargetPolicy();

    @Test
    void acceptsOnlyTheCanonicalFictionalHttpsAndDemoAppShapes() {
        assertThatCode(
                        () ->
                                policy.validate(
                                        GuideStepKind.SAFE_LINK,
                                        "https://streambox.example/manage/subscription",
                                        allowlist(
                                                GuideStepKind.SAFE_LINK,
                                                "https",
                                                "streambox.example",
                                                "/manage/")))
                .doesNotThrowAnyException();
        assertThatCode(
                        () ->
                                policy.validate(
                                        GuideStepKind.APP_DEEP_LINK,
                                        "autopayguard-demo://mandates/service/manage",
                                        allowlist(
                                                GuideStepKind.APP_DEEP_LINK,
                                                "autopayguard-demo",
                                                "mandates",
                                                "/service/")))
                .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @MethodSource("maliciousTargets")
    void rejectsNonCanonicalOrEscapingTargetCorpus(
            GuideStepKind kind,
            String uri,
            String scheme,
            String host,
            String pathPrefix) {
        assertThatThrownBy(
                        () ->
                                policy.validate(
                                        kind,
                                        uri,
                                        allowlist(kind, scheme, host, pathPrefix)))
                .isInstanceOf(IllegalStateException.class);
    }

    private static Stream<Arguments> maliciousTargets() {
        return Stream.of(
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service..example/manage/subscription",
                        "https",
                        "service..example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://-service.example/manage/subscription",
                        "https",
                        "-service.example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service-.example/manage/subscription",
                        "https",
                        "service-.example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://xn--evil.example/manage/subscription",
                        "https",
                        "xn--evil.example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service.example/manage//subscription",
                        "https",
                        "service.example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service.example/manage//subscription",
                        "https",
                        "service.example",
                        "/manage//"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service.example/manage/subscriptionevil",
                        "https",
                        "service.example",
                        "/manage/subscription"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service.example/manage/%2e%2e/admin",
                        "https",
                        "service.example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://user@service.example/manage/subscription",
                        "https",
                        "service.example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service.example:443/manage/subscription",
                        "https",
                        "service.example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service.example/manage/subscription?next=evil",
                        "https",
                        "service.example",
                        "/manage/"),
                Arguments.of(
                        GuideStepKind.APP_DEEP_LINK,
                        "autopayguard-demo://mandates/service//manage",
                        "autopayguard-demo",
                        "mandates",
                        "/service/"),
                Arguments.of(
                        GuideStepKind.SAFE_LINK,
                        "https://service.example/manage/subscription",
                        "https",
                        "other.example",
                        "/manage/"));
    }

    private static CancellationTargetEntity allowlist(
            GuideStepKind kind, String scheme, String host, String pathPrefix) {
        CancellationTargetEntity target = mock(CancellationTargetEntity.class);
        when(target.enabled()).thenReturn(true);
        when(target.actionType()).thenReturn(kind);
        when(target.scheme()).thenReturn(scheme);
        when(target.host()).thenReturn(host);
        when(target.pathPrefix()).thenReturn(pathPrefix);
        return target;
    }
}
