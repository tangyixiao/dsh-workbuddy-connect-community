# Complete WorkBuddy toolkit implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with scoped file ownership and a fresh whole-branch review. Track execution in ignored `work/all-features-20261113/progress.md`.

**Goal:** Implement every remaining agreed capability with explicit activation and bounded effects.
**Architecture:** Existing variants, authenticated card routes, account store and shim stay authoritative. Focused modules supply availability, promotion metadata, automation, host tools, context rescue and bounded CLI/media adapters.
**Tech Stack:** Existing TypeScript/React/Cordis/Schemastery/Vitest dependencies and installed official runtimes; no added dependency tree.
**Spec:** `docs/superpowers/specs/2026-11-13-complete-toolkit.md`.

## Constraints and review focus

- Preserve provider IDs, 0.2.x declared host ranges, account/response cost boundaries, existing settings and installed preview state.
- Default off for rotation/check-in/media/CLI; no uncertain writes/retries or failed-conversation replay.
- No arbitrary executable/path/credential inputs, raw diagnostic leakage, implicit cross-account tasks, stale revision writes or unbounded polling/output/processes.
- Scratch only this task namespace; retain >=10GiB free, <=2GiB optional growth, <=20MiB logs; serialize heavy jobs.
- Exact active host API evidence is local ignored scratch; do not commit vendor source or authentication material.

## Tasks and file ownership

1. Root: durable toolkit settings/DTOs/authenticated feature+account route, account controls and revision checks; integrate all subsystems through index/web-status/client/locales. Root also owns availability observation callbacks/store and promotion metadata wiring. Write stale-account/origin/key/persistence and rendering tests.
2. Media/check-in agent: verify actual installed official protocols before implementation; own media-client/task-store/tools and checkin-client/service + focused tests. Depend on generic host-tool port (task3) and toolkit settings contract; no index/client edits. Document exact protocol evidence/unknown outcomes.
3. Runtime-tools agent: own structural host-tools/approval adapters, bounded CodeBuddy runner/tool/command and context preview/export/apply wrappers; inspect actual 0.2.2-rc.1 API before writing. No index/client edits. Test schemas, approval unavailable, disabled state, snapshots, cancellation, output and process bounds.
4. Automation agent: own toolkit-settings store and account-policy service; extend account-store/auth only for explicitly scoped saved credential resolution/refresh with CAS, not global selection mutation. Implement next-request rotation and durable once/day admission interfaces with injected check-in transport. No shim/index/client edits. Test default off, concurrent admission/selection/refresh, no policy/channel rotations and no replay.
5. Root: complete protocol/UI/status integration and per-feature capability detection, source candidate version and bilingual guide/acceptance/roadmap. Review every agent diff and fixes.
6. Fresh reviewers: cross-subsystem privacy/scope/cost/lifecycle review, full tests/build/repository/pack checks, stacked PR with exact head evidence, preserve local candidate rollback and verify actual host loading. No merge/publication implied.

Each implementation task uses a red/green cycle on meaningful new behavior. Unknown protocol is a research blocker for that concrete transport, not permission to invent endpoints or claim completion. Continue independent tasks while resolving it.
