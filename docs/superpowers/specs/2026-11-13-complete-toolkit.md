# Complete WorkBuddy toolkit

User scope: implement all remaining comparison/roadmap capabilities, retaining Community identity and the existing two-card composition. Issue #2 is closed with merged/published evidence; CLI privacy follow-up tests are in parent PR #33 at 232430e. This is a stacked change based on that reviewed source, not authorization to merge/publish or silently enable account writes and paid tools.

## Functional contracts

- Account controls extend existing cards: save/list/select/follow-desktop, optional labels/removal, opaque IDs and expected durable revision. Both providers remain isolated; no credentials/raw paths are serialized.
- Availability is observed only: bounded per-region/account/model response state, known busy/queue kinds, timestamps/TTL and verified retry/position fields. Unknown/expired observations are not healthy-state assertions. No generation probes or queue polling loops.
- Promotions expose source/freshness and verified fixed/recurring schedules. Unknown schedule/timezone/price stays unknown. Existing billing package balances/expiry are reused; no guessed entitlement tiers.
- Automation is disabled by default and per region/account. Rotation chooses a configured eligible saved account for the next independent request only after confirmed hard-credit failure; never replays the failed conversation, never rotates on policy/channel/model-busy/queue/network ambiguity. Bound switches and report actual serving scope. Daily check-in requires verified transport, explicit account allowlist, durable once/day admission before sending, unknown-outcome retention and no repeated uncertain write. Manual check-in is separate explicit action.
- Context rescue is preview/export then explicit human apply to the exact same idle session revision, using the host's compaction service. Preserve original export and tool/result linkage; do not promise exact summary text before model-backed compaction, and do not resend the failed request.
- Image/video are separate disabled-by-default capabilities. Use verified WorkBuddy/CodeBuddy protocol, a server-only credential/temporary-key seam and per-action host approval. Validate mode/arguments before billing, submit once, persist account-bound task IDs, provide bounded immediate status queries and preserve unknown status after timeout. Never regenerate merely because polling/timeouts are uncertain. Results use official host output/attachment contracts.
- CLI bridge is disabled by default. Spawn the installed CodeBuddy executable with an argument array (no shell), a validated workspace/model/effort, restricted read-only tools, empty strict MCP configuration, bounded turns/output/time, no session persistence and cancellation. No permission-bypass flags, auto-resume, provider/account fallback or arbitrary model-supplied executable/cwd. An explicit human command may invoke the same bounded route.

## Integration and acceptance

Use no new dependency tree. Actual active host services were inspected from the installed Electron archive: dsh-tools/user-approval/compaction/token-meter/commands/session are 0.2.2-rc.1. Keep optional capabilities fail-closed on older/missing services and do not widen engines/peer ranges. Derive structural service adapters from exact installed exports and verify their contracts with fixtures/isolated host integration.

All new capabilities need authenticated owner controls with loopback+control-key guards, closed input shapes, account/revision guards, persisted settings before effects, disposal and cancellation. No tool, scheduler or upstream write runs while disabled. Existing UI layout/typography is retained; add compact controls to existing cards rather than redesigning the page.

Each subsystem receives focused adversarial regressions and independent review; run one heavy job at a time, full `pnpm run check`, repository checker, exact package inspection, stacked PR and local candidate install/activation. Live billable/bonus actions remain disabled unless explicitly invoked for acceptance. No static/source/fixture evidence is described as live service success.
