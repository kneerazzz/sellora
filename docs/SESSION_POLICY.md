# Staff session contract

This records the current server behavior and the 04A dashboard repair. It is not a
claim that account lifecycle, every route's permission matrix or deployment-cookie
topology is complete; those remain 04B/04C. No refresh replay grace period exists.

| Event | Server behavior | Client/operator consequence |
| --- | --- | --- |
| Valid access JWT | Resolve the current active user on every protected request | Current DB role is authority, not the signed role snapshot |
| Role change | Next authorization lookup uses the current role | UI may need a profile refresh; hiding controls is not authorization |
| Inactive/deleted user | Access denied at next lookup; refresh denied (403 inactive, 401 absent) | An already admitted request is not retroactively cancelled |
| Organization change | Old access JWT rejected because its organization no longer matches | Refresh rows bind to user ID, so an unrevoked refresh adopts the current organization; revoke sessions before an offboarding/membership move |
| Expired access JWT | 401, even for a still-active account | Client attempts one refresh and retries the original request once |
| Expired/missing/revoked refresh | 401; no replacement or cookie clearing | Sign in again; old-token replay does not revoke unrelated/winning sessions |
| Two refreshes using the same token | Conditional consumption gives one winner and one 401 loser | Winner receives a random replacement; loser sends no Set-Cookie and cannot overwrite the winning cookie |
| Replacement insert failure | Consumption and insert roll back together; 500, no cookie | Original token remains usable for a later retry |
| Logout/session revocation/logout-all/password change | Applicable refresh records revoked; issued access JWTs have no session-row link | Access remains usable until configured expiry unless current user state changes |

The default access lifetime is 15 minutes (`JWT_ACCESS_EXPIRES_IN`). Thus refresh
revocation alone has up to the remaining configured JWT lifetime of access delay.
The default stored refresh lifetime is seven days (`JWT_REFRESH_EXPIRES_IN`), and
the refresh cookie uses the same configured lifetime. The supported browser
topology and local CORS/CSRF acceptance are recorded in
[BROWSER_SECURITY.md](BROWSER_SECURITY.md).

## Dashboard refresh behavior

`refreshAccessSession()` is shared by AuthProvider bootstrap through
`refreshSession()` and the API response interceptor. Concurrent callers in one
browser context wait for the same promise. Success updates the in-memory access
token; failure reaches callers, the interceptor clears the token, and the promise
is cleared so a later attempt is possible. The interceptor retries each original
request once and excludes auth endpoints from recursive refresh. React development
effect duplication therefore shares the same pending rotation.

Separate tabs have separate promises. Two simultaneous rotations of the same
cookie can still produce one loser; no cross-tab lock or automatic stale-token
replay is promised. The winning response updates the shared cookie, while a losing
bootstrap may require signing in again. Do not add blind retries using a captured
old token. Lost network responses after a committed rotation can also require
re-login. Logout racing with an already admitted refresh is not a guaranteed
family-wide revocation; session-family/version tracking is not implemented. Include
these boundaries in support/offboarding design before offering stronger promises.

## Actual acceptance and commands

Run from `apps/server`:

```sh
npm run typecheck
node --import tsx --test src/modules/auth/sessionPolicy.test.ts
node --import tsx --test ../web/test/clientRefresh.test.ts
npm run test:db
```

The client test intentionally uses the server's installed TypeScript test runner
to execute the web test with the web app's own Axios dependency. It adds no runtime
dependency to the dashboard. It exercises actual client/bootstrap/interceptor
modules using offline Axios adapters; it is a focused command, not currently part
of default server `npm test` or hosted CI. Part 15A must include it or equivalent
browser coverage in the release suite. From `apps/web`, run `npm run build` too.

The Docker wrapper creates/owns a new database target, runs `httpSessions.ts` and
the existing DB refresh-race harness, then removes its container/tmpfs. HTTP tests
cover cookie/body refresh, single winner/replay, access/refresh expiry, actual
replacement-insert rollback and retry, current role, inactive/deleted/moved users,
logout delay and deleted-user cascade. The 04C lifecycle harness adds cookie
attributes, exact-origin mutation, Fetch Metadata, preflight and cookie-clearing
assertions. Client adapter tests cover deduplicated bootstrap/401 requests and
failure/retry. No real browser multi-tab journey or production deployment is claimed.
