# Property Direct booking context prerequisites (Phases 2–3)

## Local Development: one-command Backend startup

From `E:\React\kooch`, under the approved `COPPER-DESKTOP\Copper` account:

```powershell
.\scripts\dev-backend.ps1
```

The script reads the existing flat environment-setting Hashtable in
`C:\Users\Copper\AppData\Local\Kooch\Development\property-direct-context.psd1`.
It validates the existing application identity, encrypted persistent Key Ring and
trusted CurrentUser certificate/private-key presence. It never provisions or replaces them.
Validation checks file encryption metadata and certificate validity, not actual key decryption.
It refuses to build or start when port 5081 is occupied, and never kills another process.

Every invocation performs an incremental **Release** build of current source with `--no-restore`;
build failure prevents startup. Existing .NET 9 SDK/NuGet assets must already be available.
It then runs with `--no-build --no-launch-profile`, Development environment, and explicit
`--AutomaticDatabaseMutations:Enabled=false`. The existing Data Protection settings are also
pinned on the runtime command line. Only process environment values are loaded; previous values
are restored when the script exits. No global environment, launch profile or database defaults change.
This safety applies to this script: plain `dotnet run` still uses the application's existing defaults.

Preflight without building, loading environment values or launching:

```powershell
.\scripts\dev-backend.ps1 -ValidateOnly
```

For a graceful restart, press **Ctrl+C in the owning Backend console**, wait for shutdown,
then run the same one-command startup again. If the owning console is unavailable or port 5081
remains occupied, stop and investigate; do not force-stop another process. At startup, explicitly
confirm the log message:

```text
Automatic database migrations, seed operations, and background database writers are disabled.
```

Also confirm `Development`, `http://localhost:5081` and absence of certificate/key-recovery errors.
The script's preflight/build success is not proof of HTTP readiness or live payment verification.
Do not delete keys, change the certificate/application identity, apply migrations, or perform live
booking/payment checks as part of a restart. PowerShell execution policy must permit this local script;
the script does not change policy or trust stores.

Account booking creation now accepts an optional `propertyDirectContext: {propertyId, token}`.
Without this object, new Account sessions and reservations use Marketplace policy 0. With a valid context,
new sessions and all their reservations use policy 2, atomically in the existing creation transaction.
The `/book/{slug}` frontend is integrated with authenticated Property Direct checkout. After checkout revalidation,
a valid protected context selects policy 2 for new Account bookings. `/properties/{slug}` retains Marketplace policy 0.
Invalid Direct context never silently falls back to Marketplace. Reception Link / policy 1 is not activated.
This describes the implemented contracts, not completed live end-to-end verification or Production deployment.
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
