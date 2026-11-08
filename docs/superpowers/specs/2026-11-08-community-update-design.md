# Community plugin update

Approved scope: the user accepted the comparison and requested an update on 2026-11-08, explicitly retaining Community and requiring their local installation to use the latest version. No migration to Bridge.

## Behavior

1. Observe the upstream SSE `usage.credit` value without altering forwarded bytes. Join the upstream response ID to a DSH assistant message and show its observed cost beside that message. Unknown is absent; an observed zero is shown. No token-price estimation. Interrupted responses never acquire fabricated completion or cost. Isolate providers and sessions, bound in-memory storage, and clear account-sensitive state on account change and shutdown. Historical costs are best-effort in-memory observations, not a durable billing ledger.
2. Share reasoning capability resolution between adapter and status document. Preserve declared-set precedence, validating-only observations, CN-only Off veto, and existing default behavior when upstream provides no valid default. Honor a valid upstream default consistently in picker and requests. Do not introduce a new high fallback.
3. Check release invariants automatically: package/bundle/client identity, version coherence, declared host ranges and DSH peers, runtime entry points and packed-file coverage. Preserve exact supported host versions. Document new behavior and limits, bump to 0.1.15, build and verify the packed artifact.
4. Update the actual local Desktop Community installation, preserve provider IDs, settings, other plugins and accounts, verify installed bytes and runtime compatibility. Verify runtime activation separately from installation and model inference. Keep a rollback backup.

## Architecture

Use a small host-side credit observer/index and an owner-authenticated same-origin read route. Consume DSH's actual installed session event and assistant-actions slot contracts rather than copying another project's API version. Keep browser code free of credentials and Node imports. Subscribe to session events only when that service exists. UI contributions retain existing guarded degradation. No real inference or paid probing is needed for implementation tests.

## Acceptance

Offline tests cover split UTF-8/SSE frames, zero/invalid credit, abort/interruption, reverse arrival order, concurrent responses, non-WorkBuddy events, account transitions and bounded storage. Route tests reject anonymous/non-owner access before lookup. UI tests cover unknown/zero, message/session separation, updates and cleanup. Existing stream interruption, auth, context-window and retry tests stay green. Full test suite, typecheck, build, release check, package inspection and exact-head CI must pass before delivery. Preserve MIT provenance if any source is adapted.

## Scope limits

No wholesale UI redesign, no broadened prompt rewriting, no change to retry defaults, no new compatibility claims, no credential export and no unrelated plugin updates. Source review, public release, local installation, runtime activation and live inference are reported separately.
