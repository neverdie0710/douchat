# Local agent execution

Local agents are not universally ACP clients. Douchat uses the protocol supported by each CLI:

- Codex: persistent `codex app-server` over private stdio JSON-RPC. One live thread per account + agent configuration + conversation/topic.
- Claude Code: persistent `--input-format stream-json --output-format stream-json` session over private stdio. Session persistence to Claude's transcript files is disabled.
- Other built-in and custom CLIs: existing one-shot adapters. They receive startup/heartbeat feedback but do not yet reuse a process or native session.

See [Codex App Server](https://developers.openai.com/codex/app-server/) and [Claude CLI reference](https://code.claude.com/docs/en/cli-reference).

## Lifetime and isolation

At most eight persistent connections are retained. A connection is never used by two simultaneous turns. Idle connections are evicted after five minutes or when capacity is needed; active tasks are not evicted. Account switches, agent disposal, conversation resets, cancellation and normal application exit close the owned process tree. Workspace cleanup waits for the child process to close. Request timers, abort listeners and progress timers are released on completion and failure. JSON frames are bounded; the application does not retain the complete streaming output.

Warm turns reuse native conversation state instead of re-sending the direct-chat transcript. Cold direct-chat connections receive recent topic history (the existing 20-message / 24,000-character bound). Live connections are not persisted across app restarts. After eviction, cancellation or a crash, a subsequent user turn opens a new connection. Failed tasks are never blindly replayed: tools may already have changed external state. The sole retry is Claude's specific pre-execution credential-source conflict using its existing account-login fallback.

No transport opens a network listener or enables permission bypass. Unsupported interactive protocol requests receive an explicit error instead of hanging. Codex retains workspace-write sandboxing; Claude retains its tool allowlist and denies unattended permission prompts.

## Long tasks and feedback

The old unconditional three-minute task timeout is removed. Protocol acknowledgements still have a 60-second timeout; it applies to accepting an RPC, not to completion of a running turn. The user can stop a task at any time. Every 15 seconds, a running task reports elapsed time and time since the last protocol event. Actual agent commentary and tool events update the visible activity bubble, throttled to once per second. After 60 seconds without events, the UI says it is waiting for new progress, rather than claiming continued successful work. These transient reports are not added as final chat answers.

While a local task is active, Electron requests `prevent-app-suspension`; this does not prevent forced sleep, shutdown, network failure, CLI/model limits, or external process termination. A disconnected task fails visibly. Tasks do not survive quitting Douchat.

## Verification

`localAgentConnection.test.ts` uses real Node subprocesses speaking the two protocols to exercise process/session reuse, topic/account isolation, cancellation, concurrent access rejection, crashes, malformed packets, long-running heartbeat behavior and idle workspace/process cleanup. Existing one-shot process tests continue to cover custom commands and Claude account-login fallback. Runtime and UI tests exercise visible progress state.

A local Codex two-turn smoke test verified retained context and warm reuse. Claude's live smoke test reached the CLI but failed on the configured account's insufficient credit; its successful multi-turn behavior is covered with the protocol fixture, not claimed as a live-model test. Windows process handling continues to use the executable-shim resolver and `taskkill /T /F`; this change still needs Windows interactive smoke testing.
