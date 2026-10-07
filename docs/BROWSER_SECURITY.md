# Browser cookie, CORS and CSRF topology

Packet 04C.3, October 7, 2026. The supported local topology is the dashboard at
`http://localhost:3000` and API at `http://localhost:4000`. They are different
origins but the same schemeful site. `CLIENT_URL` is the one exact credentialed
browser origin; it is parsed and shared by CORS and unsafe-request validation.

Refresh cookies are `HttpOnly`, `SameSite=Lax`, scoped to `/api/v1/auth`, and use
the same lifetime as `JWT_REFRESH_EXPIRES_IN`. Production mode also sets `Secure`.
Login, registration, invite acceptance and refresh return the access token in the
JSON response and the refresh token only in the cookie. Logout, logout-all and
password change clear the cookie with the same path and attributes. The dashboard
keeps access tokens in memory and sends credentialed refresh requests.

For POST/PATCH/PUT/DELETE requests, an `Origin` value must equal the configured
dashboard origin whenever present. A request carrying the refresh cookie without
`Origin` is denied, and `Sec-Fetch-Site: cross-site` is denied. This protects the
cookie refresh/logout boundary while retaining body refresh tokens for explicit
nonbrowser clients that omit cookies and Origin. GET/HEAD/OPTIONS are non-mutating;
CORS preflight emits credential headers only for the configured origin. Browsers
therefore cannot read or authorize a hostile-origin credentialed response.

## Production inputs required

Before deployment, record one exact HTTPS dashboard origin in `CLIENT_URL` and
confirm the API is reached over HTTPS so browsers accept the `Secure` cookie.
The current policy supports a same-site dashboard/API arrangement. A dashboard on
a different registrable site may not send a `SameSite=Lax` refresh cookie and is
not supported without a separately reviewed cookie/CSRF design.

Record the TLS terminator and proxy path before trusting forwarded client
addresses. Sellora currently uses the direct socket address for sessions and
attempt buckets and deliberately ignores `X-Forwarded-For`; behind one proxy,
clients will share that proxy's attempt bucket until a bounded trusted-proxy
design is added. Do not enable broad Express `trust proxy` or wildcard credentialed
CORS as a shortcut. Confirm the proxy preserves `Origin`, `Sec-Fetch-Site`,
`Set-Cookie`, preflight and the `/api/v1/auth` path.

If the dashboard and API are served through one public origin, retain the exact
origin check and verify the reverse proxy routes `/api/v1` without rewriting the
cookie path. If they use same-site subdomains, add only the exact dashboard origin;
no origin list or wildcard is currently implemented. Preview deployments require
an explicitly selected origin rather than accepting arbitrary subdomains.

## Local acceptance and limits

The disposable HTTP suite checks configured refresh max-age, `HttpOnly`,
`SameSite=Lax`, auth-only path, exact allowed origin, missing/hostile/null origin,
cross-site Fetch Metadata, allowed and hostile preflight, credentialed CORS headers,
and matching logout deletion path/attributes with an epoch expiry. A focused unit test confirms `Secure` in
production policy and rejects malformed/unsafe lifetime values.

These checks use real Express HTTP and disposable PostgreSQL, but not a browser,
TLS terminator, reverse proxy or deployed domain. Browser acceptance remains Part
10/15. Cross-tab refresh limits and access-token revocation delay remain as stated
in [SESSION_POLICY.md](SESSION_POLICY.md).
