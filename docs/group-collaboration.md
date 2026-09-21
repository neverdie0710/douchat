# Local group collaboration

The desktop group scheduler ports termany's deferred initial dispatch to the
existing Douchat runtime. Each group has a saved leader, falling back to its first
valid agent for older groups. Unaddressed requests return to that leader's isolated
controller; a previous speaker no longer silently takes ownership of new requests.

- Greetings and ambiguous requests default to one short leader response. The
  controller marks `waitForHuman`, which enforces a single reply and ends the
  scheduling round without handoffs or another coordination pass. Clarification
  questions are valid stopping points until the human replies.
- Hosted activities use `leaderFirst`: only the leader opens the activity;
  other participants run after concrete public handoffs or private deliveries.
  Eventual participation alone does not schedule a reply.
- Contextual references use `addressedMemberId`: the resolved addressee owns
  the initial turn without an inserted leader or automatic follow-up dispatch.
  A third party named as a delivery target runs only after a real handoff.
  Resolution is model-driven; new tasks are not automatically assigned to the
  previous speaker.
- A single explicit @mention goes directly to that member.
- The controller chooses ordered execution for dependent work, including requests
  addressed to multiple members or @all. Workers see earlier results and private
  handoff triggers. The leader opens an unaddressed ordered task before workers
  execute, and can be scheduled again to consolidate results.
- Independent requests such as “大家每人讲个笑话” start the requested members in
  parallel, including the leader. There is no extra leader acknowledgement turn.
  Replies appear as each finishes and activity tracks the remaining members.
- Public @mentions and private deliveries trigger subsequent recipients. Explicit
  handoffs default to serial execution in address order; independent batches are
  selected by the controller. A bounded turn limit and cancellation prevent
  unbounded exchanges.

All agents can send `[[private:MEMBER_ID]]...[[/private]]` or
`[[private:human]]...[[/private]]` during a group turn. The runtime strips these
blocks from public text, persists private messages, and supplies bodies only to
the sender and recipient. The controller sees envelopes only. Group receipts
show delivery status without expandable bodies. Human deliveries restore the
sender's direct conversation if necessary and add an unread notification; replies
in that conversation include the private context.

Dispatch decisions remain model-driven. Automated tests use scripted model replies
to verify ordering, concurrency, cancellation, private-context isolation, inbox
publication and fast-reply visibility without contacting real users or providers.

This scheduler applies to desktop-local groups. Remote multi-account shared rooms
use the separate task-claim protocol described in `social-chat.md`.
