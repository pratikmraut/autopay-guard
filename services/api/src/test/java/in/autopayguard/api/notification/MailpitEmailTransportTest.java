package in.autopayguard.api.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.time.Duration;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSender;

class MailpitEmailTransportTest {

    @Test
    void acceptsOnlyLiteralMailpitOrLoopbackHosts() {
        for (String host : List.of("mailpit", "localhost", "127.0.0.1")) {
            assertThatCode(() -> transport(host, mailpitProperties()))
                    .doesNotThrowAnyException();
        }

        assertThatThrownBy(
                        () ->
                                transport(
                                        "smtp.real-provider.example",
                                        mailpitProperties()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsARealOrMalformedFromAddressAtConstruction() {
        NotificationProperties invalid =
                properties(
                        NotificationEmailMode.MAILPIT,
                        "billing@example.com");

        assertThatThrownBy(() -> transport("mailpit", invalid))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void sendsOnlyTheFrozenGenericContentToAFakeRecipient() throws Exception {
        JavaMailSender sender = mock(JavaMailSender.class);
        MimeMessage message =
                new MimeMessage(Session.getInstance(new Properties()));
        when(sender.createMimeMessage()).thenReturn(message);
        NotificationProperties properties = mailpitProperties();
        MailpitEmailTransport transport =
                new MailpitEmailTransport(
                        sender,
                        properties,
                        new FakeRecipientPolicy(properties),
                        "mailpit",
                        3_000,
                        5_000,
                        5_000);
        String key = "a".repeat(64);

        transport.send(
                new NotificationEmailTransport.EmailEnvelope(
                        "demo@autopayguard.local",
                        NotificationSemanticKey.messageId(key),
                        NotificationOutboxWorker.EMAIL_SUBJECT,
                        NotificationOutboxWorker.EMAIL_BODY));

        verify(sender).send(message);
        assertThat(message.getSubject())
                .isEqualTo(NotificationOutboxWorker.EMAIL_SUBJECT);
        assertThat(message.getContent().toString())
                .isEqualTo(NotificationOutboxWorker.EMAIL_BODY)
                .doesNotContain("merchant", "amount", "UPI", "Card ending");
        assertThat(message.getRecipients(Message.RecipientType.TO))
                .extracting(Object::toString)
                .containsExactly("demo@autopayguard.local");
        assertThat(message.getHeader("Message-ID"))
                .containsExactly(NotificationSemanticKey.messageId(key));
        assertThat(message.getHeader("Auto-Submitted"))
                .containsExactly("auto-generated");
    }

    @Test
    void refusesARealRecipientBeforeCallingTheSender() {
        MailpitEmailTransport transport =
                transport("mailpit", mailpitProperties());

        assertThatThrownBy(
                        () ->
                                transport.send(
                                        new NotificationEmailTransport.EmailEnvelope(
                                                "person@example.com",
                                                NotificationSemanticKey.messageId(
                                                        "b".repeat(64)),
                                                NotificationOutboxWorker.EMAIL_SUBJECT,
                                                NotificationOutboxWorker.EMAIL_BODY)))
                .isInstanceOf(NotificationDeliveryException.class)
                .satisfies(
                        failure ->
                                assertThat(
                                                ((NotificationDeliveryException) failure)
                                                        .category())
                                        .isEqualTo(
                                                NotificationFailureCategory
                                                        .RECIPIENT_NOT_FAKE));
    }

    @Test
    void rejectsUnboundedOrLeaseUnsafeSmtpTimeouts() {
        NotificationProperties properties = mailpitProperties();
        FakeRecipientPolicy recipientPolicy =
                new FakeRecipientPolicy(properties);

        assertThatThrownBy(
                        () ->
                                new MailpitEmailTransport(
                                        mock(JavaMailSender.class),
                                        properties,
                                        recipientPolicy,
                                        "mailpit",
                                        0,
                                        5_000,
                                        5_000))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("finite positive SMTP");
        assertThatThrownBy(
                        () ->
                                new MailpitEmailTransport(
                                        mock(JavaMailSender.class),
                                        properties,
                                        recipientPolicy,
                                        "mailpit",
                                        30_000,
                                        20_001,
                                        10_000))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at most half");
    }

    @Test
    void rejectsAWorkerLeaseShorterThanOneMinute() {
        assertThatThrownBy(
                        () ->
                                new NotificationProperties(
                                        "-",
                                        "-",
                                        "-",
                                        25,
                                        Duration.ofSeconds(59),
                                        Duration.ofHours(2),
                                        new NotificationProperties.Email(
                                                NotificationEmailMode.DISABLED,
                                                "no-reply@autopayguard.local",
                                                List.of(
                                                        "@autopayguard.local",
                                                        ".example.test"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at least one minute");
    }

    private static MailpitEmailTransport transport(
            String host, NotificationProperties properties) {
        return new MailpitEmailTransport(
                mock(JavaMailSender.class),
                properties,
                new FakeRecipientPolicy(properties),
                host,
                3_000,
                5_000,
                5_000);
    }

    private static NotificationProperties mailpitProperties() {
        return properties(
                NotificationEmailMode.MAILPIT,
                "no-reply@autopayguard.local");
    }

    private static NotificationProperties properties(
            NotificationEmailMode mode, String from) {
        return new NotificationProperties(
                "-",
                "-",
                "-",
                25,
                Duration.ofMinutes(2),
                Duration.ofHours(2),
                new NotificationProperties.Email(
                        mode,
                        from,
                        List.of("@autopayguard.local", ".example.test")));
    }
}
