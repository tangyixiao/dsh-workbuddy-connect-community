# Community improvements implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the comparison's actionable reliability, reasoning-management and manual-account improvements in the existing Community plugin.

**Architecture:** Keep current provider and credential seams. Add focused account and preference modules; use existing authenticated controls and model rows. Drop foreign thinking before serialization, and classify explicit upstream business codes without broad text guessing.

**Tech Stack:** TypeScript, existing DSH/pi-ai APIs, React, Vitest, pnpm; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-community-improvements.md`

## Global constraints

- Provider IDs remain `workbuddy` and `workbuddy-ai`; no automatic rotation, opaque fingerprint rewrites, publishing or merging.
- Reuse dependencies and checkout; scratch only `work/community-improvements-20261113/`; one heavy verification job at a time.
- Preserve unrelated credentials, accounts, preview settings and installed plugins. Saved accounts are explicit opt-in.
- All status, wire, offline checks, CI, installation and live inference evidence stay distinct.

## Review focus

- Stale UI writes must never change another account's preferences.
- Explicit request efforts must survive defaults; prepared calls must keep captured defaults.
- Foreign reasoning must disappear without losing original answer/tool content or mutating histories.
- Policy, queue and model-busy failures must not be reported as account quota exhaustion.
- Account selection during an outstanding refresh must not write a different account's credentials into the selected scope.

## Tasks

### 1. Documentation and acceptance
- [ ] Correct `docs/guide.zh-CN.md`, English guide and entry-page wording; add `docs/acceptance.md` and `docs/roadmap.md` for exact validation and dependencies.
- [ ] Run repository documentation checker; commit only owned documentation paths after integration.

### 2. Upstream error contract
- [ ] Add wire-level regressions covering structured numeric/string codes, nested/request-id false positives and HTTP 401 precedence.
- [ ] Update `src/upstream.ts`, `src/shim.ts`, dependent exhaustive maps; prove model-busy is RATE_LIMIT, policy/queue/channel are deterministic and non-retrying.
- [ ] Run focused tests, then report changes for integration review.

### 3. Foreign thinking
- [ ] Write red/green prepared-call tests with cross-provider and cross-model histories and own-model controls.
- [ ] Add `src/history.ts` and integrate at adapter stream boundary before pi-ai conversion.
- [ ] Assert input immutability, tool/text preservation and both route wire dispatch.

### 4. Per-model reasoning default
- [ ] Add persisted `ReasoningDefaultStore` with reset, account/region isolation and validated values.
- [ ] Add authenticated `set-model-default-effort` action; status fields include offered levels, saved and effective defaults.
- [ ] Extend existing model rows and localized copy; use saved preference only when still offered, explicit request wins, capture prepared metadata.
- [ ] Test persistence, malformed state, stale writes, reset, capability changes, explicit override and in-flight capture; run focused UI/server/adapter tests.

### 5. Manual accounts
- [ ] Implement bounded explicit account save/list/select/follow-desktop using plugin-owned state; preserve desktop files and default behavior until opt-in.
- [ ] Add CLI commands and redacted output. Test wrong region, missing account, corrupt state, concurrent refresh and selection persistence.
- [ ] Add usage documentation after API settles, run focused tests.

### 6. Integrated delivery
- [ ] Review every diff, run `pnpm run check` and `node tools/check-repository.mjs` serially; verify packaging once.
- [ ] Fresh whole-branch review, address actionable defects, commit allowlisted files and create a scoped draft PR.
- [ ] Install tested candidate locally using existing host mechanisms where possible; verify exact artifact and activation separately. Do not interrupt active host work without authorization.
- [ ] Reconcile scratch/process ownership; retain only review and acceptance evidence.
