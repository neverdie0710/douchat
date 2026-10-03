# Connany connectors

> Status: enabled. The connector list comes from Connany's `GET /v1/connectors`,
> so whatever the administrator enables (currently Notion, Linear and GitHub)
> appears in Settings and in agent tools. Nothing is hard-coded on either side.

## Architecture

```text
Desktop main (ConnanyManager) ──▶ Douchat backend ──▶ Connany HTTP API (/v1)
  POST /api/desktop-auth/connectors     modules/connany/service.ts
  Bearer <desktop login token>          external_user_id = authenticated user ID
```

- `CONNANY_BASE_URL` and `CONNANY_API_KEY` exist only in the backend environment.
  `CONNANY_ALLOW_WRITES=true` enables write tools; it is off by default.
- The backend uses the Connany SDK (`modules/connany/client.ts`, copied from the
  Connany repository's `sdk/client.ts`) and `createAgentTools`. The connector of a
  connection is always read from Connany, never taken from the desktop.
- Backend commands: `list`, `connect {connector}`, `session {connector, id}`,
  `reconnect`, `disconnect`, `check`, `access`, `list_tools`, `call_tool`
  (`confirmed: true` only after the user approved a write) and `events`.
- `connect_url` never leaves the desktop main process. It opens in the system browser.

## Settings → Connectors

Lists the enabled connectors with their Connany title and avatar. A detail page per connector supports adding an account
(the session is polled every 5 seconds until connected, error or expired),
setting a default account, renaming locally, checking the connection,
reconnecting the original account, granting resource access when
`needs_access` is true, and disconnecting with confirmation.

## In conversations

Before each cloud-agent turn the desktop refreshes the user's connections (cached
for 30 seconds) and registers:

- `request_connection {connector}`: shows a "Connect Notion" prompt. After the user
  clicks it, the authorization page opens in the browser. The tool waits for the
  session to finish, and the turn continues.
- `{connector}_list_tools` / `{connector}_call_tool`: Connany's `list_tools` /
  `call_tool` adapter for the selected account. The optional `account` name picks
  among the user's connections. The executor resolves it to a connection ID that
  the backend re-verifies. The model never supplies a user or connection ID.
- `connector_accounts`: account names, status and default, without IDs.

A `reauth_required` error shows a "Reconnect Notion" prompt, then retries the call
once. A `connection_revoked` error tells the model to use `request_connection`.
Writes are refused unless the backend enables them. When enabled, every write asks
the user first through the permission prompt (`accountWrite`, always asked).

## State changes

Connany has no webhooks. The backend polls `GET /v1/events` once for the whole
project, at most every 10 seconds. It persists the cursor in the protected config
key `connany_events_cursor` and keeps the last 50 events per user in memory. The
desktop asks for its user's events every 30 seconds. Any event reloads the account
list, which rebuilds agent tools on the next turn and refreshes Settings.

## Verification (2026-10-02)

- Backend `tests/connany.test.ts`: 12 passed. Covers spoofed identity, unsupported
  connectors, session polling, read-only default, write confirmation, foreign,
  revoked and expired connections, account routes, the shared event poll and rate limits.
- Desktop: full suite 1201 passed / 4 skipped; typecheck passes.
- Live against local Connany (`:3200`): connector list, Notion/Linear session
  creation, session polling, foreign session and connection isolation (404).
