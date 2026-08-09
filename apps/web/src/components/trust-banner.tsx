export function TrustBanner() {
  return (
    <aside
      aria-label="Privacy promise"
      className="trust-banner"
      data-testid="trust-banner"
    >
      <span aria-hidden="true" className="trust-banner__icon">
        ✓
      </span>
      <p>
        We never ask for your UPI PIN, bank password, OTP, or full payment
        credentials.
      </p>
    </aside>
  );
}
