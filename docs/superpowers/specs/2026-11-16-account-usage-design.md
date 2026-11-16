# Accounts and observed usage

Implement the first delivery agreed in the comparison: saved-account credit overview, durable plugin-observed usage, account-specific check-in outcomes, resilient refresh, and current bilingual documentation. Keep the existing two product cards, disclosure, spacing and component patterns. These are additions to the existing composition, not a new page or visual direction.

## Approach

Extend the current toolkit and authenticated routes. Reuse saved-account revision checks, region isolation, fetchCredits, atomic writes and check-in admission. A separate desktop account manager or an official-usage scraper would add unrelated permissions and unsupported API assumptions; neither is in this release. Expiry-based recommendations and policy changes remain a later delivery.

## Contracts

- Credit overview uses each saved account's credential without selecting it. GET only reads cached overview; an explicit owner action refreshes accounts with at most two requests in flight, no generation or claims. Preserve previous successful values and their timestamps on error. Account revision/region changes invalidate publication of stale results.
- Durable history records completed requests through this plugin, with opaque account, model, response ID, time and optional observed credit. Missing credit stays unknown. Deduplicate responses; no prompts, tokens, raw user IDs, tool arguments, or private error text. Retain 31 days, at most 5,000 entries and at most 4 MiB; expose the bounded coverage and 1/7/30 day summaries, per account/model and at most 100 recent request details. Disk failure never fails inference or pretends persistence succeeded.
- A completed request remains attributed to its frozen original account even if selection changes during streaming. CN/global and enterprise/personal stay distinct. A stale stream must not populate the new account's message-credit display.
- Check-in observation contains target account, time, manual/automatic mode, outcome and optional awarded credits. Automatic and manual paths feed the same bounded per-account latest-result view. Observation failure does not retry a claim or weaken durable admission.
- Refresh transport failures preserve the last successful display, mark it stale and disable mutations until revalidated. Sign-out, provider changes and unauthorized access clear private state. Existing controls keep revision guards. Hidden documents stop new periodic refreshes.
- No new dependencies, broad filesystem scans, client-auth rewriting, live generation, automated consent, or policy/retry changes. No real check-in or generation during validation.

## Delivery

Use one feature PR with meaningful commits for independently reviewable stores, integrations, account/check-in services, UI, docs and release preparation. Preserve the existing unrelated Codecov branch. Validate focused behaviors, full checks, package contents and desktop/mobile Chinese rendering. Publish only the checked source and verify npm, GitHub Release, author/third-party catalogs, installation and activation separately. Use the next patch version 0.1.21; existing preview channels remain separate.
