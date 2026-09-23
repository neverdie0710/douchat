# Agent task concurrency

All model backends share the same runtime scheduling rule: replies are serialized
by account, agent, conversation, and topic. The same contact can respond in separate
private chats and groups concurrently. Session history, tool context, input images,
run IDs, cancellation, and fallback replies belong to the individual session.
An agent remains busy until its last active reply completes.

Stopping a conversation cancels its running and queued replies without stopping
that contact's tasks in other conversations. Updating an active agent defers session
refresh until its active replies finish. Recursive handoffs cannot revisit an ancestor.

The Codex/Claude persistent connection pool permits eight connections; additional
conversations wait for capacity and can be cancelled while waiting. Idle connections
are evicted first. Other native adapters launch separate processes and use the
persistent workspace assigned to their session. Provider limits still apply.

Shared remote tasks are claimed and run concurrently (up to eight tasks per desktop).
Polling continues while tasks execute. Active crash-recovery outbox placeholders are
excluded from publication; each finished task publishes its own result independently.

Validation uses deterministic model stubs and native-protocol subprocess fixtures;
it does not make paid model calls or verify each vendor's live service concurrency.

Resource lifecycle audit:
- A shared budget of eight CLI main processes covers warm connections, one-shot
  execution, and model catalog queries. MCP/tool children are owned by each process
  group, not counted as separate slots. Slots are released on process close.
- At most two idle native connections stay warm. Connections idle for five minutes are closed; under pressure the least
  recently used idle connection is closed first. Saved threads survive eviction.
- Cloud/custom in-memory contexts expire after five idle minutes, with at most 32
  idle/warm cached entries (active replies are not evicted). History is rebuilt
  from the stored conversation when a context is cold.
- Shared rooms use stable account/agent/room sessions. Each turn reads its current
  caller and cancellation signal; cached tools do not capture earlier authorization.
- Internal planning sessions are temporary. Catalog queries are coalesced, bounded,
  and cancelled on account changes and quit. Agent disposal also cancels one-shot
  processes and requests waiting for capacity.
