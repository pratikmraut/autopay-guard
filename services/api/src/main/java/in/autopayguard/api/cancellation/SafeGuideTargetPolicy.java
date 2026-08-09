package in.autopayguard.api.cancellation;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class SafeGuideTargetPolicy {

    private static final Pattern DNS_HOST =
            Pattern.compile(
                    "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$");

    public void validate(
            GuideStepKind kind, String targetValue, CancellationTargetEntity allowlist) {
        if (kind == GuideStepKind.INFORMATION
                || targetValue == null
                || allowlist == null
                || !allowlist.enabled()
                || kind != allowlist.actionType()) {
            throw new IllegalStateException("Guide target configuration is invalid.");
        }
        if (!StandardCharsets.US_ASCII.newEncoder().canEncode(targetValue)
                || targetValue.indexOf('\\') >= 0
                || targetValue.indexOf('%') >= 0) {
            throw new IllegalStateException("Guide target is not canonical ASCII.");
        }
        final URI uri;
        try {
            uri = new URI(targetValue);
        } catch (URISyntaxException exception) {
            throw new IllegalStateException("Guide target is not a valid URI.", exception);
        }
        if (!uri.isAbsolute()
                || uri.isOpaque()
                || uri.getUserInfo() != null
                || uri.getPort() != -1
                || uri.getQuery() != null
                || uri.getFragment() != null
                || uri.getHost() == null
                || uri.getRawPath() == null
                || !uri.normalize().equals(uri)
                || !targetValue.equals(uri.toASCIIString())
                || !allowlist.scheme().equals(uri.getScheme())
                || !allowlist.host().equals(uri.getHost())
                || !allowlist.host().equals(uri.getRawAuthority())
                || !canonicalHost(allowlist.host())
                || !canonicalPathPrefix(allowlist.pathPrefix())
                || uri.getRawPath().contains("//")
                || !withinPathPrefix(uri.getRawPath(), allowlist.pathPrefix())) {
            throw new IllegalStateException("Guide target does not match its exact allowlist.");
        }
        if (kind == GuideStepKind.SAFE_LINK) {
            if (!"https".equals(uri.getScheme())
                    || !uri.getHost().endsWith(".example")
                    || uri.getHost().length() <= ".example".length()) {
                throw new IllegalStateException("Guide HTTPS target must use a reserved .example host.");
            }
            return;
        }
        if (!"autopayguard-demo".equals(uri.getScheme())
                || !"mandates".equals(uri.getHost())
                || !uri.getRawPath().startsWith("/service/")) {
            throw new IllegalStateException("Guide app target is not the demo mandate route.");
        }
    }

    private static boolean canonicalHost(String host) {
        if (!StandardCharsets.US_ASCII.newEncoder().canEncode(host)
                || !host.equals(host.toLowerCase(java.util.Locale.ROOT))
                || host.contains("xn--")
                || !DNS_HOST.matcher(host).matches()) {
            return false;
        }
        return true;
    }

    private static boolean canonicalPathPrefix(String prefix) {
        return prefix != null
                && prefix.length() >= 2
                && prefix.startsWith("/")
                && StandardCharsets.US_ASCII.newEncoder().canEncode(prefix)
                && !prefix.contains("//")
                && !prefix.contains("..")
                && prefix.indexOf('\\') < 0
                && prefix.indexOf('%') < 0
                && prefix.indexOf('?') < 0
                && prefix.indexOf('#') < 0;
    }

    private static boolean withinPathPrefix(String path, String prefix) {
        if (path.equals(prefix)) {
            return true;
        }
        if (!path.startsWith(prefix)) {
            return false;
        }
        return prefix.endsWith("/")
                || (path.length() > prefix.length()
                        && path.charAt(prefix.length()) == '/');
    }
}
