# Group scheduling: routing profiles, bounded decisions and task graphs

This change applies to desktop-local groups. Remote shared-room claim/lease
coordination remains a separate protocol. Existing account settings and legacy
single/sequential/parallel plans remain supported.

## Agent-level files at the routing boundary

The worker still receives its own full customization. The isolated controller
receives neither the caller's persona/skill instructions nor USER.md/MEMORY.md.
Both Jev and the member LLM receive bounded, descriptive member profiles:

- Existing role/description.
- Explicit routing/capability sections from IDENTITY.md, SOUL.md, AGENTS.md and
  TOOLS.md, up to 1,200 characters per file and 2,600 characters in total. Accepted headings include Group
  routing, Routing, Role, Capabilities, Specialties, Expertise, Responsibilities,
  Constraints and 群聊调度、调度信息、角色、能力、专长、职责、限制.
- Enabled skill names and frontmatter descriptions (including YAML multiline
  descriptions), bounded to 1,400 text characters per member. Skills relevant to
  the current request are prioritized; omitted skill count is explicit. Skill
  instruction bodies and disabled skills are excluded.
- Permission metadata, hosted/local runtime, queued/active reply count and actual
  hosted computer/connector tool names. Local adapters' tool inventory is unknown,
  not inferred from their brand or their TOOLS.md prose.

For example, the following section can be added to SOUL.md without publishing
that file's other sections to the group controller:

```markdown
## 群聊调度
- 擅长：中文技术写作、接口文档、方案评审。
- 交付物：结构化文档、修改建议。
- 限制：不执行生产部署。
```

These sections are intentionally shared with the configured decision service and
must contain only public routing information. They are declarations, not proof
of tool connectivity, authorization, or successful execution. Runtime permission
checks remain authoritative. File/skill edits are reflected on the next new task;
replayed workflows retain their saved roster snapshot.

## Decisions and startup latency

Cloud model catalogs are cached for five minutes per current access token and
concurrent catalog requests share one fetch. Cancellation of one caller does not
cancel another caller. Errors/empty catalogs are not cached; sign-out, token
changes and current-session 401s invalidate the cache. No cached credentials are
exposed to the renderer.

Jev asks a separate typed worker Choice for single-member work. An irrelevant
member's uncertain Noul no longer invalidates that choice. Multi-member work
continues to use Noul. Recovery omits irrelevant routing/member questions.

A no-action route must also identify ignore/completed/waiting, and agree with a
separate needsReply check. Waiting retains waitForHuman. A fresh request cannot
be declared completed without a completed contribution. Conflicts escalate to
the LLM; no heuristic keyword route silently replaces the selected policy.

Each decision invocation has a 120-second shared deadline across catalog,
configured decision service and member-controller fallback. Existing inner
transport/attempt limits still apply. Decision timing is recorded in run events.
Probe latency, planning latency and work duration are stored separately; complex
work duration no longer penalizes coordinator ranking as if it were probe delay.

## Task graphs and evidence

A plan may include up to 32 nodes:

```ts
{ id, memberId, instruction, dependsOn, expectedOutput,
  publicDeliverable?, requiredCapabilities? }
```

Validation rejects cycles, missing/self dependencies, duplicate IDs, unknown or
unavailable members, denied required capabilities and conflicting control flags.
Graph owners must match memberIds. Nodes belonging to the same member are
serialized; independent ready nodes run with at most four workers. New version-3
workflows start a dependent node immediately after its own prerequisites finish,
without waiting for unrelated slow nodes. Versions 1/2 keep their original wave
execution when replaying saved work. Review context and journal rounds use a
stable topological order; each node receives only the original public context and
its transitive dependency results. Node sessions are isolated by workflow/task.
Replacement calls also respect per-member execution serialization.

Successful results unlock dependencies. Graph-node IDs distinguish multiple
assignments to the same member and provide durable reply journal keys. Replacing
a worker retains the node identity and dependency edges. Follow-up graphs cannot
reuse completed node IDs. The controller reviews completed graph evidence before
ending or issuing more work.

A deterministic task evidence projection carries the original request and the
last 32 completed contributions, including assignment, expected output, public
result excerpts and message references. It uses no extra model call and never
includes private bodies. Public image artifact references are preserved, and up
to four referenced dependency images are loaded through account-scoped attachment
access for a downstream worker. Missing attachments pause execution; filenames
alone do not prove visual inspection. Private dependency triggers retain their
access restrictions during replacement. A new graph node with no text, public
artifact or private delivery pauses instead of unlocking dependents. This supplements the recent-message window; excerpts
are not a substitute for full artifacts when reviewing their quality.

## Errors, recovery and monitoring

Default member-based scheduling now also starts new tasks with the compact
participation review (hosted/local agents and custom-provider members). A negative
or invalid response falls back to the full planner within the same attempt
deadline. A valid full decision remains accepted. Continuations first review
current task evidence with `complete`, `waiting`, or `continue`; only `continue`
or an invalid review needs full planning. Recovery retains its dedicated protocol.
This adds a review call for complex requests, but removes full-plan generation
for confirmed personal participation and ordinary completion. Decision validation
now distinguishes an invalid mode from a non-array member list and non-string
member IDs, giving repair attempts specific field guidance.

Negative health entries are rechecked on the next new request rather than
quarantining members for the healthy-cache interval. Busy, timed-out, failed
transport and non-PONG probes are inconclusive (`unknown`); only a confirmed
configuration failure blocks initial dispatch. Local agents skip an extra
startup/PONG call after configuration eligibility is checked. Actual execution
failures still quarantine that member within the current workflow. Personal
participation now gets 60 seconds instead of 15 seconds.

Resetting group context clears that group's health cache, while preserving
history and agent configuration. Cancelled work cannot save a late health
observation after reset. Round summaries say “did not reply this round” rather
than asserting that every absent participant is unavailable.

An uncertain Jev `ordered` route on a new request now receives a compact semantic
participation review before full planning. The reviewing member selects exact
participant IDs and order; validation constrains the roster, and the executor
runs those personal contributions without a task graph or summary round. The
route hint is not itself permission to dispatch. Ambiguous/complex requests and
invalid review responses fall back to full planning within the same candidate
deadline. This is not a keyword shortcut or a lower confidence threshold.

Planning fallback notices distinguish timeout, empty output, invalid format,
authentication and rate limiting without copying raw provider diagnostics into
chat. The overall deadline uses localized copy, is cleared on completion, and
does not announce another candidate when less than one second remains.

Member planning now shares a 60-second candidate/request limit and a 180-second
overall decision budget. This removes the hidden 20-second hosted/local request
cutoff inside the former 40-second candidate limit, while retaining time for a
third candidate after two full timeouts. Format correction shares the candidate
deadline, and provider decision time also consumes the overall budget. Human
cancellation and late-result rejection remain in effect. These limits require
an updated app build; they do not change an already installed release.

Parallel failure recovery starts when the failure is observed, rather than after
unrelated workers finish. Policy changes are serialized. Batch results commit in
declared order. All started promises settle before a fatal error leaves the
executor. New workflows use stable per-slot recovery decision keys so a replay
with different transport timing does not make a second recovery decision.

Text plus an execution error is a partial result, not success. The runtime
preserves public partial output and attached artifacts, strips private transport
bodies, and pauses rather than repeating potentially effectful operations.
Provider errors are preserved even when the last assistant message contains text.

The workflow journal records start, finish, executor heartbeat and last actual
progress separately. Heartbeats persist every 15 seconds and timers stop when a
call settles. Hosted stream/tool events and local adapter activity update actual
progress. A heartbeat proves the desktop executor is alive; it does not prove a
remote worker is advancing. Existing execution deadlines and interruption/replay
safety remain in force. This adds observability, not distributed failover or
permission to repeat operations with unknown external effects.

Expected outputs are explicit and the controller receives evidence for review.
Generic semantic acceptance, arbitrary-file verification, calibrated Score
selection and risk-specific timeouts remain future work. No measured latency/accuracy improvement is claimed without live comparison.

## Validation (2026-09-24)

- Latest targeted planning/participation regression: four files, 94 tests passed,
  including ordered subsets, negative review fallback, absent slots, timeout
  termination and distinct failure reasons.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Scheduling regression: eight test files, 129 tests passed.
- Latest `npx vitest run`: 95 test files passed, two failed, one skipped;
  902 tests passed, two failed, four skipped. The failures are in the separately
  changing settings UI: `preferences.test.ts` requires a server snapshot for
  `usePreferences`, and `AgentSettingsDialog.test.tsx` expects a removed Skills
  navigation button. Those UI changes were left intact. Paid/live-provider tests
  were not enabled.
- Added coverage for profile/memory isolation, catalog sharing/cancellation and
  account changes, single-worker selection, explicit waiting/completion,
  graph validation/fan-in/repeated owners/replay, prompt evidence retention,
  immediate parallel failure recovery, partial-result pausing, stable recovery
  slots and separate heartbeat/progress timestamps. Streaming coverage verifies
  early dependency release, concurrency/owner limits, cancellation draining,
  legacy wave replay, empty-output blocking, actual image handoff, node-session
  isolation, private dependency access and bounded task-relevant skill metadata.

These are implementation and regression checks, not live routing accuracy or
latency benchmarks. Jev threshold calibration and production p50/p95 measurements
still require representative real-model tasks.
