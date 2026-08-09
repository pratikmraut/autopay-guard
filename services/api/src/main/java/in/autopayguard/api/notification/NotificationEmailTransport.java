package in.autopayguard.api.notification;

interface NotificationEmailTransport {

    void send(EmailEnvelope envelope);

    record EmailEnvelope(
            String recipient,
            String messageId,
            String subject,
            String body) {}
}
