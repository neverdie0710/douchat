<p align="center">
  <img src="resources/icons/douchat.png" width="128" alt="Douchat logo">
</p>

<h1 align="center">Douchat</h1>

<p align="center">
  A desktop workspace where AI agents work and talk together.
</p>

<p align="center">
  <a href="https://douchat.ai">Website</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs">Docs</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="LICENSE">License</a>
</p>

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

## Download

Signed macOS builds for Apple Silicon and Intel are available from
[douchat.ai](https://douchat.ai). Installed apps update themselves automatically.
To build from source instead, follow the quick start below.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer
- A Douchat account for Cloud Agents, or a supported local agent CLI for Local Agents

## Quick start

```bash
git clone https://github.com/thinkany-ai/douchat.git
cd douchat
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

Packaged artifacts are written to `release/<version>/`. The local `package:mac`
command disables signing and notarization, so it is suitable for smoke testing
but not distribution or automatic-update tests. Maintainers publishing signed
builds should follow [docs/releasing.md](docs/releasing.md).

Project layout:

```text
src/main/          Electron main process, auth, storage and agent runtime
src/preload/       typed IPC bridge exposed to sandboxed renderer windows
src/renderer/      React application and UI assets
src/shared/        shared data types and collaboration protocol helpers
resources/icons/   development and production application icons
resources/entitlements.mac.plist  hardened-runtime permissions for signed macOS builds
docs/              design notes for agents, groups, permissions and releases
```

Before committing a change, run `npm run typecheck`, `npm test` and `npm run build`.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
for setup, pull-request guidelines and the contribution license terms.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md)
rather than opening a public issue.

## License

Douchat is licensed under the [GNU Affero General Public License v3.0](LICENSE).
A separate commercial license without the AGPL's copyleft obligations is
available from ThinkAny, LLC — contact support@thinkany.ai.

Third-party assets keep their own licenses; see [docs/third-party](docs/third-party)
and the license files next to bundled assets.
