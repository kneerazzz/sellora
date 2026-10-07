# Account operations

Packet 04C.2, October 7, 2026. This is the supported local onboarding, recovery
and staff-offboarding process. It does not claim email delivery or production
browser topology. Account attempts use the shared limits documented in
[DEVELOPMENT.md](DEVELOPMENT.md).

## Invite and onboarding

An ADMIN or MANAGER creates an invite through `POST /api/v1/invites`; a MANAGER
may invite only a REP. The response contains the 48-hour invite URL because no
email adapter is configured. The authenticated operator must deliver that URL
through an already established private channel. Do not place it in tickets,
shared logs or public chat. The public validate route returns only the recipient,
role, organization display metadata and expiry.

An invite is single-use. Acceptance atomically claims the pending, unexpired
record before creating the user and session. Revoke and resend use conditional
updates, so accept-versus-revoke/resend races have one terminal winner. Resending
revokes the previous capability and returns a new private URL. There is no email
verification beyond possession of the administrator-delivered invite; production
email verification remains unimplemented and must not be promised.

## Password recovery

There is no public email-address recovery endpoint, preventing account discovery
through recovery requests. After verifying the staff member through an existing
company channel, an ADMIN may call `POST /api/v1/users/:id/recovery`. The response
contains a 30-minute, single-use capability for private delivery. The database
stores only its SHA-256 hash; issuing another capability invalidates prior unused
ones. `POST /api/v1/auth/reset-password` consumes it atomically, changes the
password, revokes every refresh session and invalidates outstanding recovery
capabilities. Already issued access JWTs retain the bounded behavior in
[SESSION_POLICY.md](SESSION_POLICY.md).

For operator break glass, run from `apps/server` with a deliberately selected
target and a new private output path:

```sh
SELLORA_ACCOUNT_DATABASE_URL=<selected-postgresql-target> \
  node --import tsx scripts/accountRecovery.ts <organization-id> <user-id> <new-private-output-file>
```

The command never reads the ambient `DATABASE_URL`, creates the output file with
exclusive mode `0600`, prints no token, and removes the file if issuance fails.
Verify the organization, user and delivery channel before running it. Delete the
private file after successful delivery; the application cannot retract a copy.
The disposable acceptance harness executes both its success and failure paths.

Passwords are capped at 72 UTF-8 bytes on registration, invite acceptance,
recovery reset and authenticated change so bcrypt never silently treats two
accepted inputs as the same truncated password.

## Password change and offboarding

An authenticated password change verifies and serializes against the current
password, revokes refresh sessions and invalidates recovery capabilities. A
concurrent reset, change or offboarding operation cannot leave a replacement
refresh session after the lifecycle action commits.

Only an ADMIN can call `POST /api/v1/users/:id/deactivate`. Self-deactivation and
admin-to-admin deactivation are denied because organization ownership transfer is
not implemented. Deactivation marks the staff user inactive, revokes their
refresh sessions and recovery capabilities, and revokes pending invites for the
same organization/email. Access JWT requests fail when current user state is
resolved.

API keys are organization-owned rather than staff-owned. Offboarding therefore
revokes every active API key in that organization when the departing staff member
may have held them; keys in other organizations remain unchanged. The operator
must create and privately distribute replacement keys to each retained integration
and verify the old keys fail. This is intentionally disruptive and should be
scheduled with the integration owners.

API-key creation locks and rechecks the authenticated staff user in the same
transaction as insertion. It shares the user-row lock with offboarding: a key
created first is included in the later organization-wide revocation, while a
creation queued after offboarding is denied.

## Local acceptance and remaining limits

`npm run test:db` exercises invite expiry/single use/revoke/resend and races,
recovery hashing/reissue/expiry/concurrent use, refresh revocation, generic inactive
login denial, deterministic refresh/login lifecycle races, both API-key/offboarding
lock orders, break-glass file behavior, staff/API-key/foreign access controls and
organization-scoped offboarding against disposable PostgreSQL and real HTTP.
Provider responses are deterministic where the inherited suite needs them.

No email was sent and no live organization was changed. Production email delivery,
organization ownership transfer, user reactivation, per-user API-key ownership,
access-token session linkage, client acceptance and production cookie/CORS/CSRF
behavior remain outside this packet.
