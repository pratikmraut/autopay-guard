package in.autopayguard.api.notification;

import jakarta.mail.MessagingException;
import jakarta.mail.SendFailedException;
import jakarta.mail.internet.MimeMessage;
import java.net.SocketTimeoutException;
import java.util.Locale;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailException;
import org.springframework.mail.MailParseException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

@Component
class MailpitEmailTransport implements NotificationEmailTransport {

    private final JavaMailSender mailSender;
    private final NotificationProperties properties;
    private final FakeRecipientPolicy recipientPolicy;

    MailpitEmailTransport(
            JavaMailSender mailSender,
            NotificationProperties properties,
            FakeRecipientPolicy recipientPolicy,
            @Value("${spring.mail.host:localhost}") String smtpHost,
            @Value("${spring.mail.properties.mail.smtp.connectiontimeout:3000}")
                    long connectionTimeoutMillis,
            @Value("${spring.mail.properties.mail.smtp.timeout:5000}")
                    long readTimeoutMillis,
            @Value("${spring.mail.properties.mail.smtp.writetimeout:5000}")
                    long writeTimeoutMillis) {
        this.mailSender = mailSender;
        this.properties = properties;
        this.recipientPolicy = recipientPolicy;
        validateMailpitBoundary(
                properties,
                recipientPolicy,
                smtpHost,
                connectionTimeoutMillis,
                readTimeoutMillis,
                writeTimeoutMillis);
    }

    @Override
    public void send(EmailEnvelope envelope) {
        if (properties.email().mode() != NotificationEmailMode.MAILPIT) {
            throw new NotificationDeliveryException(
                    NotificationFailureCategory.PROVIDER_PERMANENT, false);
        }
        if (!recipientPolicy.isAllowed(envelope.recipient())) {
            throw new NotificationDeliveryException(
                    NotificationFailureCategory.RECIPIENT_NOT_FAKE, false);
        }

        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper =
                    new MimeMessageHelper(
                            message, false, java.nio.charset.StandardCharsets.UTF_8.name());
            helper.setFrom(properties.email().fromAddress());
            helper.setTo(envelope.recipient());
            helper.setSubject(envelope.subject());
            helper.setText(envelope.body(), false);
            message.setHeader("Message-ID", envelope.messageId());
            message.setHeader("Auto-Submitted", "auto-generated");
            message.setHeader("X-Auto-Response-Suppress", "All");
            mailSender.send(message);
        } catch (MailException | MessagingException exception) {
            throw classified(exception);
        }
    }

    private static NotificationDeliveryException classified(Throwable failure) {
        if (hasCause(failure, SocketTimeoutException.class)) {
            return new NotificationDeliveryException(
                    NotificationFailureCategory.PROVIDER_TIMEOUT, true);
        }
        if (failure instanceof MailAuthenticationException
                || failure instanceof MailParseException
                || hasCause(failure, SendFailedException.class)) {
            return new NotificationDeliveryException(
                    NotificationFailureCategory.PROVIDER_PERMANENT, false);
        }
        return new NotificationDeliveryException(
                NotificationFailureCategory.PROVIDER_TRANSIENT, true);
    }

    private static boolean hasCause(
            Throwable failure, Class<? extends Throwable> expected) {
        Throwable current = failure;
        for (int depth = 0; current != null && depth < 12; depth++) {
            if (expected.isInstance(current)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private static void validateMailpitBoundary(
            NotificationProperties properties,
            FakeRecipientPolicy recipientPolicy,
            String smtpHost,
            long connectionTimeoutMillis,
            long readTimeoutMillis,
            long writeTimeoutMillis) {
        if (properties.email().mode() != NotificationEmailMode.MAILPIT) {
            return;
        }
        String normalizedHost =
                smtpHost == null ? "" : smtpHost.strip().toLowerCase(Locale.ROOT);
        if (!Set.of("mailpit", "localhost", "127.0.0.1").contains(normalizedHost)) {
            throw new IllegalStateException(
                    "MAILPIT mode requires the literal local Mailpit or loopback SMTP host.");
        }
        if (!recipientPolicy.isAllowed(properties.email().fromAddress())) {
            throw new IllegalStateException(
                    "MAILPIT mode requires a configured fake-local from address.");
        }
        if (connectionTimeoutMillis <= 0
                || readTimeoutMillis <= 0
                || writeTimeoutMillis <= 0) {
            throw new IllegalStateException(
                    "MAILPIT mode requires finite positive SMTP connection, read, and write timeouts.");
        }
        final long providerCallBudgetMillis;
        try {
            providerCallBudgetMillis =
                    Math.addExact(
                            Math.addExact(
                                    connectionTimeoutMillis,
                                    readTimeoutMillis),
                            writeTimeoutMillis);
        } catch (ArithmeticException exception) {
            throw new IllegalStateException(
                    "Configured SMTP timeout budget exceeds the notification lease.",
                    exception);
        }
        if (providerCallBudgetMillis
                > properties.leaseDuration().toMillis() / 2) {
            throw new IllegalStateException(
                    "The combined SMTP timeout budget must be at most half the notification lease duration.");
        }
    }
}
