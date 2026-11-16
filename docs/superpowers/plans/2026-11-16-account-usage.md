# Account and Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people compare saved-account credits and inspect retained usage and check-in outcomes inside the current DSH cards.

**Architecture:** Extend the existing toolkit route with bounded cached account credits and account-specific check-in observations. Observe completed shim streams into a bounded atomic history store; expose only owner-authorized projections. Keep existing UI composition and conservative request behavior.

**Tech Stack:** Existing TypeScript, Node, React 18, Vitest, DSH atomic-write; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-account-usage-design.md`

## Global Constraints

- Retain 31 days, at most 5,000 entries and at most 4 MiB; return at most 100 recent usage records. UTC rolling time windows are labeled accurately.
- Credit refresh concurrency at most two; GET makes no new account-credit network calls. No account selection changes.
- Opaque account IDs, region and enterprise isolation; no credentials, prompts or private exception strings in history or responses.
- Keep existing two-card composition, bilingual copy and stale-account guards. No live generation/check-in validation, new dependencies, or unrelated branch changes.
- One heavy test/build at a time. Scratch uses D: under this task namespace; C: has less than 10 GiB free and must not receive new downloads/caches.
- One feature PR; meaningful staged commits, no empty commits; target release 0.1.21 with source/CI/publish/install/runtime evidence tracked separately.

## Review Focus

- Account switches during stream completion must retain original attribution without leaking into new message-credit joins (Task 1).
- Overlapping processes, duplicate response IDs, corrupt/oversized history and disk failure must remain bounded and fail visibly without breaking inference (Task 1).
- Account removal/credential rotation while quota refresh is in flight must not publish stale private data (Task 2).
- Automatic check-in failures before submission and uncertain post-submit outcomes must display accurately without another claim (Task 2).
- Transport failure preserves data read-only, while unauthorized/provider-change clears private state and late refreshes cannot restore it (Task 3).

### Task 1: Durable observed usage and streaming integration

**Files:** Create `src/usage-store.ts`, `tests/usage-store.spec.ts`; modify `src/shim.ts`, `src/index.ts`, `src/toolkit-runtime.ts`, `src/toolkit-types.ts`; add focused shim/runtime tests.

**Interfaces:** Produce `WorkBuddyUsageStore` with bounded atomic `record`, filtered `read` and `flush` methods; serializable `UsageRecord` and `UsageSummary` types. Add an optional observer hook to shim, binding model and opaque account from the frozen request credential. ToolkitWebState gains optional `usage` and safe unavailable/persistence status. Preserve existing constructor/test seams with optional/default integrations. No Node runtime import from browser code.

- [ ] Write and run failing tests for reload/dedup/31-day pruning/size bounds/corruption/parallel writers, unknown credits and original-account attribution.
- [ ] Implement store and commit it with its tests.
- [ ] Integrate completed-stream observation and owner-filtered toolkit reads; test no credentials/body writes, no extra network calls and fail-open observation.
- [ ] Run targeted Vitest plus typecheck; commit integration with tests; report exact interfaces to controller.

### Task 2: Cached saved-account credits and check-in observations

**Files:** Create `src/account-overview.ts`, `tests/account-overview.spec.ts`; modify `src/toolkit-runtime.ts`, `src/toolkit-types.ts`, `src/toolkit-route.ts`, `src/checkin-service.ts`; extend respective tests.

**Interfaces:** ToolkitWebState gains optional overview keyed by opaque saved account IDs and per-account latest check-in results. ToolkitAction gains explicit `refresh-account-credits` with expected account/revision and optional saved id. Produce no-refresh GET projections and refresh methods with captured snapshot validation. CheckinServiceOptions gains optional result observer used by both manual and automatic paths; fixed safe outcome codes only.

- [ ] Write and run failing tests for two-way concurrency, per-account isolation, refresh without selecting, error preserves timestamp/value, removed account and late response rejection.
- [ ] Implement cached overview, guarded route action, and tests; commit.
- [ ] Write and run automatic/manual observation tests including throws, duplicate admission, unknown, cancelled scope and removed accounts.
- [ ] Implement bounded account-specific check-in results; run relevant tests and typecheck; commit.

### Task 3: Existing-panel presentation and resilient refresh

**Files:** Modify `src/client/WorkBuddyToolkitPanel.tsx`, `src/client/toolkit-locales.ts`, `src/client/WorkBuddyMessageCredit.tsx` as needed; create focused presentation components only where useful; extend `tests/toolkit-panel.spec.ts` and presentation tests.

**Interfaces:** Consume the actual types from Tasks 1/2. Existing account row adds credits, expiry horizons, last refresh, result; existing disclosure adds usage summary and recent records. Add refresh-all and individual refresh controls using owner/revision guards. Do not change the two-card page composition. Missing optional fields render as unknown/unavailable.

- [ ] Write and run regression tests for preserving display after transport failure and disabling stale mutations; unauthorized/provider changes clear state.
- [ ] Implement resilience and commit with regressions.
- [ ] Implement bilingual account overview, check-in rows and 1/7/30 day usage views, per-model/account summaries and capped recent requests using existing visual patterns. Avoid raw IDs where account labels exist; all unknown/partial/history limits disclosed.
- [ ] Add meaningful presentation tests and hidden-document refresh tests; run focused checks and typecheck; commit.

### Task 4: Qualification, docs and release

**Files:** Update README entry pages, detailed bilingual guides, roadmap, complete-toolkit, release notes, version metadata and tests as required.

- [ ] Reconcile old baseline claims and document actual source scope, retention, UTC windows, observation gaps and recovery limits; commit.
- [ ] Run full `pnpm run check`, `node tools/check-repository.mjs`, package inspection; review branch independently and address findings in scoped commits.
- [ ] Verify Chinese desktop/mobile current composition and key states using bounded local fixtures with no credentials, capture useful evidence and stop server.
- [ ] Bump 0.1.21 consistently, validate release/package and create one PR containing the meaningful commits; attach PR.
- [ ] Check exact PR head CI; merge through normal repository controls preserving commits where permitted; publish checked npm and Release assets; verify hashes and catalog/local-install/activation results separately.
