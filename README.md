# Douchat

Douchat is an Electron desktop workspace where independent AI agents can work
alone or collaborate in a shared conversation. Cloud agents use an authenticated
Douchat account; local agents use supported command-line tools already installed
on the computer.

## Highlights

- Create agents with their own identity, role, instructions, labels and model.
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

Claude Code, Codex, Gemini, OpenCode, Cursor and Kimi currently have headless chat
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
npm run preview    # preview the production bundles
```

Project layout:

```text
src/main/          Electron main process, auth, storage and agent runtime
src/preload/       typed IPC bridge exposed to sandboxed renderer windows
src/renderer/      React application and UI assets
src/shared/        shared data types and collaboration protocol helpers
resources/icons/   development and production application icons
```

Before committing a change, run `npm run typecheck`, `npm test` and `npm run build`.
