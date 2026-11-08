# Task 1 report: per-message observed WorkBuddy credits

## Scope and implementation

- Added `WorkBuddyCreditSseObserver` and bounded `WorkBuddyCreditLog` in `src/credit-log.ts`. The observer uses streaming UTF-8 decoding, caps pending SSE text at 1 MiB, accepts only finite nonnegative `usage.credit` values paired with a response ID in the same data frame, and reports an observation only after `[DONE]` or a terminal `finish_reason`. It reads alongside the forwarded stream and never transforms or logs the payload.
- Added an in-memory join capped at 512 response IDs. Association uses the exact host assistant message replay response ID and stores provider, account, session, and message identity. Provider/account/session reads are isolated; zero is retained. Session disposal removes its records; account changes and plugin shutdown clear the join.
- The shim observes only successful stream end. It re-resolves the current credential before recording and uses an account generation captured at request start, so a response from a prior account cannot repopulate state after a switch. Aborted and errored streams do not emit observations.
- Added two GET-only credit routes, retaining owner admission, loopback Host/Origin checks, `no-store`, and auth-before-lookup behavior.
- Added the guarded `conversation.chat.assistant-actions` contribution. Its UI uses one refresh feed per mounted provider/session, validates returned credit numbers, shows unknown as absent and zero as `0`, clears stale data on failed reads, and cancels timers/in-flight requests when the last row unmounts. English and Chinese labels explain that values are observed, in-memory, and best-effort.

## Host contracts and dependencies

- Inspected `@deepseek-ai/dsh-session@0.2.2-rc.1`: `session/event` delivers committed events; `assistant/message` carries the assistant message, and `session/disposed` marks the session leaving the store. The plugin injects the optional `sessions` service and does not require it at startup.
- Inspected `@deepseek-ai/dsh-client-ui-chat@0.2.2-rc.1`: `conversation.chat.assistant-actions` is a session-scoped list slot whose owner supplies `messageId`. `source.replayState.response.responseId` provides the exact join key.
- Added both packages as exact `0.2.2-rc.1` dev dependencies. Runtime peers and the declared supported DSH range were not changed.
- No Bridge source was copied or adapted, so no third-party notice change was needed.

## Tests and validation

- RED evidence: before implementation, `pnpm exec vitest run tests/credit-log.spec.ts` failed at import because `src/credit-log.ts` did not exist. During parser development, a focused invalid-frame assertion caught that the test fixture mixed an earlier response ID with a later credit; the fixture and parser expectations were corrected to require same-frame IDs.
- Focused credit, shim, authenticated route, UI feed, and client-slot tests passed: 59 tests at the final focused run; the subsequent concurrent reverse-arrival case passed separately (10 credit-log tests).
- `pnpm run check` passed: typecheck, 962 tests passed / 7 skipped, and build. The extra concurrency test was added afterward and passed in its focused run. Build output is committed alongside source, matching repository convention.
- `git diff --check` passed.

## Concerns and limits

- The cost remains a best-effort in-memory observation. It is absent when the upstream response omits a valid response ID/credit pair or completion evidence, when host replay metadata omits the ID, or after account/session/process cleanup.
- The environment emitted a Node experimental localStorage warning during Vitest. Build also printed the existing CommonJS format recommendation and dependency-bundling hint; all checks completed successfully.

## Commit

- `feat: show observed WorkBuddy message credits` (this report is included in the Task 1 commit at branch HEAD).