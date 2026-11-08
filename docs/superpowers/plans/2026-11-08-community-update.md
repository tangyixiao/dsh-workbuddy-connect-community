# Community Plugin Update Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by task. User already approved execution in the current conversation; do not repeat approval questions.

**Goal:** Add useful Bridge-inspired capabilities to Community and update the user's actual local installation.

**Architecture:** Observe SSE costs and join them to session messages; serve authenticated per-session costs to a guarded assistant-actions contribution. Centralize reasoning resolution while retaining Community behavior. Verify package invariants before local deployment.

**Tech Stack:** TypeScript, React 18, Cordis, DSH 0.2.2-rc.1 development contracts, pi-ai 1.3.0, Vitest, tsdown, pnpm.

**Spec:** docs/superpowers/specs/2026-11-08-community-update-design.md

## Global Constraints

- Retain `dsh-workbuddy-connect-community`, provider IDs `workbuddy` and `workbuddy-ai`, current route auth and exact host support range.
- No synthetic SSE completion, cost estimates, live inference, paid probes, broad prompt rewrite or unrelated plugin changes.
- Unknown costs are absent; genuine zero is displayed. Do not disclose credentials or raw request content.
- Follow installed host contracts and preserve browser contribution guards. Bound registries, cancel pending work, clear account-sensitive state on identity changes.
- Keep source changes scoped and reviewable. Do not publish or install from a worker.

## Review Focus

- Several tool/model calls can occur before a final assistant event: attribute by actual response ID, never by latest session selection.
- A failed or interrupted stream can contain an earlier usage frame: do not report it as a successful final cost.
- Event/stream arrival order and provider/account changes: never mix sessions/accounts or retain unbounded waiters.
- Web state endpoints require DSH owner admission before reading data, plus current Host/Origin protections.
- Older supported hosts may lack the message slot/session service: degrade without disabling providers.

### Task 1: Observe and display per-message credits

**Files:** Create `src/credit-log.ts`, `src/credit-route.ts`, `src/client/WorkBuddyMessageCredit.tsx`; modify `src/shim.ts`, `src/index.ts`, `src/status-paths.ts`, `src/client/index.tsx`, `src/client/locales.ts`, relevant package/dev dependencies and client test config only if needed. Tests in focused credit specs and existing shim/auth/slot specs. Preserve provenance in THIRD_PARTY_NOTICES if adapting Bridge code.

**Interfaces:** `createWorkBuddyShim` accepts an optional `(responseId: string, credit: number) => void` observer. A bounded index joins response IDs to session/message IDs under provider/account scope. Route returns `{ sessionId, credits: Record<string, number> }` through owner auth. UI receives session and message IDs from the actual declared slot, fetching only its session and rendering the observed number.

- [ ] Read current host session event/slot definitions before implementing; choose exact dependency versions matching existing 0.2.2-rc.1 dev packages.
- [ ] Write failing behavioral tests for split frames/UTF-8, last usage value, zero/invalid input, interruption, arrival ordering, concurrency, account/session separation, bounded storage and auth-before-lookup.
- [ ] Run focused tests and record expected failures.
- [ ] Implement minimal observer/index/route and host integration without modifying forwarded stream bytes or interruption behavior.
- [ ] Write failing UI tests for observed zero, absent unknown, session/message switching, later refresh, teardown and absent host slot.
- [ ] Implement guarded UI contribution with bilingual labels and explicit in-memory/best-effort semantics.
- [ ] Run focused tests, typecheck, build and full suite; inspect diff and commit `feat: show observed WorkBuddy message credits`.

### Task 2: Share reasoning capability resolution

**Files:** Create `src/efforts.ts`; modify `src/adapter.ts`, `src/index.ts`, `src/status-paths.ts`, probe UI only as needed; add `tests/efforts.spec.ts` and extend reasoning/adapter/status tests.

**Interfaces:** A pure `resolveEfforts(info, observed, region)` supplies offered levels, Off eligibility and probe eligibility to adapter and status; a default resolver returns a valid upstream default only, otherwise undefined. Both resolveModel and request preparation must agree.

- [ ] Write failing tests for declared precedence, validating-only observation, CN Off veto, no reasoning/no switch, invalid default and absence preservation.
- [ ] Extract the existing decision into the shared resolver, consume it in adapter and probe/status assembly, and expose declaration-based availability without mislabeling it as a probe result.
- [ ] Honor a valid upstream default on both resolution and preparation using actual pi-ai/DSH contracts; preserve omission otherwise.
- [ ] Run focused and full checks, self-review and commit `refactor: share WorkBuddy reasoning capability resolution`.

### Task 3: Release checks, documentation and local delivery

**Files:** Create `scripts/check-release.mjs`; modify `package.json`, README.md, README.en.md, `.github/workflows/check.yml`, THIRD_PARTY_NOTICES if needed.

- [ ] Implement package/patch/bundle/version/host peer/runtime-output invariants, testing the checker against a temporary malformed manifest if it accepts a fixture path, without new dependencies.
- [ ] Wire the checker after build in CI. Document observed credits, limitations and reasoning behavior. Bump version to 0.1.15.
- [ ] Run full typecheck/test/build/check-release and `git diff --check`. Inspect npm pack list and tarball. Commit scoped tooling/release changes.
- [ ] Review exact commits and create scoped English PRs; independently inspect CI at each expected head before integration.
- [ ] Back up Desktop profile metadata/configuration and current installed package. Use Electron-owned DSH CLI to install the verified package, comparing all installed bytes and unrelated configuration/dependency state.
- [ ] Verify actual host version, compatibility and plugin heartbeat/activation. If the host needs restart, perform a controlled supported restart without interrupting active sessions; report live inference separately.
- [ ] Recheck remote/source/package/local version state and report concrete evidence. Keep rollback backup.
