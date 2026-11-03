# Property Direct booking context prerequisites (Phase 2)

This phase only issues and validates contexts. Booking creation and commission selection do not consume them yet.
Public `/book/{slug}` links are reusable and not secret. A context proves server authorization, not referral origin.

No persistent Data Protection ring was explicitly configured before this feature. The new endpoint fails closed
with HTTP 503 until the operator supplies both settings (environment variables shown):

- `PropertyDirectBookingContexts__KeyRingPath`: an existing absolute directory, provisioned by the operator.
- `PropertyDirectBookingContexts__ApplicationName`: a stable deployment-specific application discriminator.
- `PropertyDirectBookingContexts__LifetimeMinutes`: optional, default 20; validated range 1–60.
- `PropertyDirectBookingContexts__KeyEncryptionCertificateThumbprint`: optional installed certificate for
  Data Protection key encryption at rest. The service identity must have access to its private key.

No deployment path, key, certificate, or live configuration is supplied by source control. No database key store
or automatic migration is introduced. Directory creation and permissions are operator responsibilities.
The configuration applies to the application's shared ASP.NET Core Data Protection provider, not a second ring.

For containers/multiple instances, mount the same persistent, access-controlled key directory, use the same
application name and, if configured, certificate/private key on every instance. Keep clocks synchronized.
Do not use an ephemeral container filesystem. Windows DPAPI-only machine keys are unsuitable for a shared ring.
Explicit file persistence does not automatically encrypt XML keys: use certificate encryption or operator-managed
encrypted storage with strict service-account ACLs. Do not enable issuance before these protections are verified.
Back up the ring and encryption certificate securely, retain old keys through token expiry, and test recovery.
Loss/revocation of required keys makes existing contexts invalid; do not fall back to Marketplace implicitly.

Issuance: POST `/api/account/property-direct-booking-contexts`, authenticated active Account user, body
`{propertySlug,idempotencyKey}` only. Result `{propertyId,token,expiresAtUtc}`. Treat the token as a secret;
use TLS, disable body logging/capture on this endpoint, never place tokens in URLs, analytics, or error reports.
The route uses the existing JWT session-version/active-user validation and a per-user in-process limit of
10 requests/minute, with no queue (429). A multi-instance deployment must add an equivalent shared ingress limit.
Unapproved, deleted and missing Properties receive the same 404. Missing key configuration returns generic 503.

Protection purpose: `Kooch.Account.PropertyDirectBookingContext.v1`. Protected JSON contains version, client ID,
Property ID, fixed numeric policy 2, SHA-256 of the booking service's trimmed key, and UTC issuance/expiry instants.
There is no public validation endpoint. Validation binds all fields and rejects expiry without grace/replay bypass.
Phase 3 must recheck Property approval, RoomType membership, creation transactions and semantic idempotency;
issuance is not a reservation, allocation, quota claim, or guarantee of future availability.
