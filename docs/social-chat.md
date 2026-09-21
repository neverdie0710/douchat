# Friends and shared groups

The Friends group in the desktop Contacts section uses the existing Douchat desktop login token to talk to
`/api/desktop-auth/social` in the sibling `douchat-tanstack` service. Tokens and task
claims stay in Electron's main process.

## First version

The Add friend dialog uses a narrower 480px width and shares its typography and
header styling with the scheduled-task viewer. Create agent is in the message-list plus menu; its dialog includes an Add friend
button that opens this search dialog.

Friends appear under Contacts alongside built-in agents, group chats and agents;
there is no separate Friends navigation tab. Requests and accepted friends appear directly as avatar/name/status rows. Select
a person to view their profile using the same layout as an agent, then accept or
decline the request, or send a message. Start a group from the shared chat-details member picker. Shared groups
appear in the existing Group chats folder.

- Open the message list’s **+ → Create agent → Add friend** flow, search
  an existing user’s email, review their avatar/name/email, and send a friend request. The recipient accepts or
  declines it; an accepted relationship permits direct messages and group invitations.
- Create a group from accepted friends. Each member adds/removes their own locally
  owned agents, including their own built-in account administrator.
- Send ordinary text to the group, or select one of your agents to assign a task.
  Writing an `@name` in a normal message does not dispatch work.
- Group agents receive the owner's request plus bounded shared chat context, not
  private chat history. Replies are visible to all group members.
- The owner's desktop executes both local CLI agents and Cloud agents. Pending tasks
  wait for a device that has that agent. Messages refresh every two seconds while the
  conversation is open; people, rooms and requests refresh every three seconds.
- Human direct messages support text and up to four pasted images (8 MB each, 20 MB total). Shared groups currently support text and text agent replies. Other shared file uploads,
  presence, read receipts, group moderation and adding people after group creation
  are outside this first version.

## Unified direct-message inbox

Human direct rooms synchronize in the main process every two seconds, even when
Contacts is closed. They are stored as ordinary account-scoped conversations and
messages. A conversation carries a person and a remote room address, never a fake
model configuration. Both participants get independent local IDs and preferences.

BotInbox, ChatPane, InspectorRail, the member picker, history/search, mark-read,
manual unread, pin, mute, hide, delete, and detached windows use the existing
conversation APIs. Runtime.sendMessage dispatches human recipients to SocialClient
before connecting any model; ordinary agent conversations retain model execution.
The old standalone FriendChatPane adapter has been removed.

Deleting/clearing history is local to the account/device, as with agent chats.
Persisted message-ID tombstones prevent the next sync from restoring cleared
messages, without relying on the device clock. A new incoming message can bring
a hidden/deleted conversation back. Pending send retries reuse the same message
ID after a lost receipt. Photos are read from current account profiles.

The service stores versioned direct-message bodies in its existing content column,
including bounded image attachments, and returns decoded text/images. Downloaded
images enter the same local attachment store used by agent chat.

## Ownership and delivery

Service-side agent ids combine the authenticated account id with the local agent id.
The server derives the sender from the session and checks room membership and agent
ownership on both sending and claiming. Ordinary messages and agent results never
enter the task queue. The renderer cannot claim or complete jobs.

The main process also validates the task's author/owner and the persisted local agent
owner before invoking the runtime. Legacy local agents acquire ownership the first
time they are shared; newly created agents inherit the current account. Updating an
agent through IPC cannot change ownership.

Task claiming uses a conditional database update and verifies the saved claim (including
on MySQL, where the shared database adapter emulates `returning()`). Only one device
executes a task. Sending a message with the same id is idempotent. Execution results
are stored in a local SQLite outbox and publication can be retried without rerunning
tools. Signing out aborts active execution and keeps that account's unpublished result
for its next login. A crash after claiming is not automatically retried, because tools
may already have performed work; a saved in-flight receipt becomes an interrupted-task
result. A connection loss during the initial claim can leave an uncertain running task;
confirm any external effects before sending another task.

## Run and deploy

Both desktop and service changes are required. The development database has been
updated with `social_friendship`, `social_room`, `social_membership`, and `social_message`.
Start the service on the desktop's `DOUCHAT_SERVICE_URL`, then restart the desktop main
process to load its new IPC handlers.

The service's SQLite, PostgreSQL and MySQL schema templates include the new tables.
Production deployment still needs a reviewed, additive migration generated for the
production database provider before deploying the service. No production migration or
deployment is performed by this implementation.

Verification:

```sh
# desktop
npm run typecheck
npm test
npm run build

# douchat-tanstack service
pnpm exec tsc --noEmit
pnpm exec tsx --test tests/social.test.ts
pnpm build
```

The service integration test uses an isolated temporary SQLite database and does not
send messages to real users. Renderer checks use fixture accounts.

## Shared member presentation and follow-ups

The mention picker includes human peers and agents owned by the signed-in account;
other owners' agents remain visible in the member grid but cannot be selected for
invocation. The main process and service still enforce agent ownership on send.

Agent memberships include public appearance metadata (image, emoji, generated
avatar seed, color, built-in identity and local agent type). The owning desktop
refreshes changed profiles during inbox synchronization via `update-agent`. This
operation requires an existing membership, preserves its ordering, and cannot
restore a removed agent. Receivers use these fields without looking up a matching
local contact. Avatar data is excluded from model task context. Both the desktop
and service must run this version, and the owner's desktop must sync once to fill
appearance data for older memberships. No database migration is required.

A plain shared-group follow-up continues the account's preceding addressed agent
exchange. Explicit mentions override it; `@all` invokes all locally owned room
agents. An unaddressed message without an established exchange defaults to one
owned member rather than broadcasting to every agent. This deterministic shared
room routing is separate from the model-driven local-group controller.
