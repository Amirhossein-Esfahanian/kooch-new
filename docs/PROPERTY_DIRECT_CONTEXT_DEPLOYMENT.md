# Property Direct booking context prerequisites (Phases 2–3)

Account booking creation now accepts an optional `propertyDirectContext: {propertyId, token}`.
Without this object, new Account sessions and reservations use Marketplace policy 0. With a valid context,
new sessions and all their reservations use policy 2, atomically in the existing creation transaction.
The frontend is not connected yet: `/book/{slug}` still uses Marketplace semantics. Reception policy 1 is not activated.
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
Creation rechecks Property approval under the existing Property lock, plus RoomType/Room membership, pricing
and capacity. Issuance is not a reservation, allocation, quota claim, or guarantee of future availability.

Direct request identity wraps the unchanged canonical Account request hash in a deterministic version-1
attribution envelope (Property ID and fixed policy 2). Token bytes and timestamps are not request identity.
Marketplace/historical hashes are unchanged, and historical null Session policies are not backfilled.
Matching replay is checked under the existing idempotency lock before new-creation checks. An explicitly
Direct request may omit its token only for a stored policy-2 session with matching Property and request hash.
If a replay supplies a token, authenticity and all bindings remain mandatory; only expiry may be ignored.
Tokenless input never authorizes a new Direct session. New creation always requires a currently valid token.
Invalid context never falls back to Marketplace. Missing key configuration returns generic 503 from Account
creation as well as issuance. Key loss prevents supplied-token replay, but does not prevent authenticated,
exact tokenless replay of an already-created Direct session.
