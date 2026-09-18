# Douchat

Douchat is an Electron desktop workspace where independent AI agents can work
alone or collaborate in a shared conversation. Cloud agents use an authenticated
Douchat account; local agents use supported command-line tools already installed
on the computer.

## Highlights

- Create agents with their own identity, role, instructions and labels.
- Use direct chats, group chats, topics, `@` mentions and lead-agent dispatch.
- Hand work between agents with private and agent-to-agent messages.
- Connect supported local agent CLIs without copying their credentials into Douchat.
- Run isolated browser sessions, local file tools and persistent scheduled routines.
- Keep conversations, topics and agent configuration in Electron's local user-data directory.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer
- A Douchat account for Cloud Agents, or a supported local agent CLI for Local Agents

## Quick start

```bash
npm ci
cp .env.example .env
npm run dev
```

The default development service is `http://localhost:3000`. Change
`DOUCHAT_SERVICE_URL` in `.env` if the web app runs on another local port. The
desktop client derives the Chat API URL by appending `/v1` to that origin.

## Configuration

Only `.env.example` belongs in source control. `.env` and all environment-specific
variants are ignored because they can contain credentials or private infrastructure
details.

| Variable | Purpose | Required |
| --- | --- | --- |
| `DOUCHAT_SERVICE_URL` | Development login and Cloud Chat origin | No; defaults to the local web app |
| `DOUCHAT_WEB_URL` | Backwards-compatible alias for `DOUCHAT_SERVICE_URL` | No |
| `GATEWAY_BASE_URL` | OpenAI-compatible endpoint for tests or signed-out scripted runtimes | No |
| `GATEWAY_API_KEY` | Credential for the optional gateway | Only with an authenticated gateway |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY` | Optional direct provider credentials | No |

Packaged builds always use `https://douchat.ai`; development environment overrides
cannot redirect production account tokens. A signed-in desktop client uses its
first-party Douchat session even if generic gateway variables are present.

To exercise a compatible gateway end to end, set the variables in your shell and
run the live suite. It is skipped when either value is missing:

```bash
GATEWAY_BASE_URL=https://gateway.example/v1 \
GATEWAY_API_KEY=replace-with-a-local-secret \
npx vitest run src/main/gateway.live.test.ts
```

Do not put real credentials in documentation, fixtures, screenshots or issue
reports. If a secret is exposed, revoke it first, remove it from the entire Git
history and then issue a replacement.

## Authentication and data safety

Browser sign-in uses an authorization-code flow. The access token is encrypted
with Electron `safeStorage`, remains in the main process and is never sent to the
renderer or copied into generic endpoint settings. Cloud models are loaded from
`GET /v1/models`, and replies stream through `POST /v1/chat/completions`.

The first time an account signs in on a local profile, Douchat creates the Cloud
contact **Dr. Dou** (豆博士), opens its private chat by default, and asks it to
send a short welcome after Cloud Chat connects. The account is marked as onboarded,
so later sign-ins do not create duplicates and deleting the contact is respected.

Renderer windows use context isolation, sandboxing and no Node.js integration.
User-selected avatars are stored as local data URLs, and message attachments are
served to the renderer through IPC rather than exposing arbitrary file paths.

Local file tools are restricted to Downloads, Desktop and Documents. Moves do not
overwrite existing files, and deletion is not exposed. Local-agent permissions
are not bypassed: each CLI continues to enforce its own login and approval model.

## Agent collaboration

Each agent has a private chat. Groups add a lead member that opens the conversation,
dispatches work and consolidates the result:

- Unaddressed group messages are routed as `single`, `parallel`, `sequential` or
  `none`; explicit `@name` and `@all` mentions bypass the dispatcher.
- If a member cannot answer, it is quarantined for that run and another member can
  take over. The conversation identifies a substitute lead when needed.
- `[[private:MEMBER_ID]]...[[/private]]` privately delivers content to a group
  member; `[[private:human]]...[[/private]]` delivers it to the user.
- `[[a2a:BOT_ID]]...[[/a2a]]` hands work to another bot from a direct chat.
- Topics keep unrelated tasks in separate runtime sessions and histories.

## Local agents

Open **Settings → Agents**, or choose **Manage local agents** in Contacts, then
refresh the catalog. Detection uses the login-shell `PATH`, including tools
installed through nvm, pnpm or `~/.local/bin`.

Claude Code, Codex, Gemini, Grok Build, OpenCode, Cursor and Kimi currently have headless chat
adapters. Install and sign in to a CLI in the terminal before creating a contact.
Several contacts may use the same CLI while retaining separate topic histories.
Detection confirms that an executable exists; it cannot guarantee login state or
compatibility with every CLI version.

Each turn runs in a temporary working directory with recent conversation context.
It does not resume an unrelated terminal session. Local replies have a three-minute
timeout, can be stopped from the UI and do not expose private browser tools.

## Development

```bash
npm run dev        # start Electron with hot reload
npm run typecheck  # check main, preload and renderer TypeScript
npm test           # run the Vitest suite
npm run build      # create production bundles in out/
npm run package    # create an unpacked app for the current platform
npm run package:mac    # unsigned Apple Silicon + Intel DMGs/ZIPs for smoke tests
npm run package:win    # x64 NSIS installer
npm run package:linux  # x64 AppImage + deb package
npm run preview    # preview the production bundles
```

Packaged artifacts are written to `release/<version>/`.

## Release and automatic updates

Production updates are served from the public `douchat` Cloudflare R2 bucket at
`https://cdn.douchat.ai`, while GitHub Releases remain the private staging area.
`electron-builder` creates each platform installer plus its checksum-protected
update manifest, and the packaged app embeds only the public CDN URL. The
renderer can request a check or installation over IPC, but it cannot replace the
release feed or access the R2 publishing credentials.

Installed builds check quietly after launch. Users can also open
**Settings → About** to check manually. One click downloads the verified update,
installs it and restarts Douchat. If an agent task is active, the completed
download waits until the task has finished before restarting.

To prepare a release:

1. Set the same version in `package.json` and `package-lock.json`.
2. Commit the version change and push it.
3. Tag that commit with `v<version>` and push the tag.
4. Wait for `.github/workflows/release.yml` to create a draft GitHub Release.
5. Test the attached DMG, then publish the draft. Publishing runs
   `.github/workflows/publish-cdn.yml`, which uploads versioned files first and
   `latest-mac.yml` last. The manifest update is the shipping step seen by
   installed clients.

```bash
npm version 0.2.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: Douchat 0.2.0"
git tag v0.2.0
git push origin dev v0.2.0
```

Tagged releases ship separate signed and notarized Apple Silicon (`arm64`) and
Intel (`x64`) macOS builds. Both architectures share `latest-mac.yml`; the
updater selects the matching ZIP automatically, so users never download the
other architecture's Electron runtime.
Windows and Linux installers can be produced from the workflow's manual action,
but are not attached to public tagged releases until their signing and support
channels are enabled.

The release workflows use these repository secrets:

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the certificate archive |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_PASSWORD` | App-specific Apple password |
| `APPLE_TEAM_ID` | Apple Developer team identifier |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account containing the `douchat` bucket |
| `R2_ACCESS_KEY_ID` | Bucket-scoped R2 Object Read & Write token id |
| `R2_SECRET_ACCESS_KEY` | Bucket-scoped R2 token secret |

Never store these values in `.env`, the builder configuration or Git history.
The R2 token is restricted to the `douchat` bucket and exists only in GitHub
Actions Secrets; downloads through `cdn.douchat.ai` are public and credential-free.
The local `package:mac` command explicitly disables signing and notarization, so
it is suitable for smoke testing but not distribution or automatic-update tests.

Project layout:

```text
src/main/          Electron main process, auth, storage and agent runtime
src/preload/       typed IPC bridge exposed to sandboxed renderer windows
src/renderer/      React application and UI assets
src/shared/        shared data types and collaboration protocol helpers
resources/icons/   development and production application icons
resources/entitlements.mac.plist  hardened-runtime permissions for signed macOS builds
```

Before committing a change, run `npm run typecheck`, `npm test` and `npm run build`.
