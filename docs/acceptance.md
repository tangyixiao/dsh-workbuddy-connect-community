# Runtime acceptance / 运行验收

This is an executable acceptance contract, not a record that every case has passed. Source tests, mocked wire requests, host registration, installation, and actual upstream generation are separate results. 本文是验收操作合同，不代表下表已经通过；夹具测试不能填作真实运行证据。Current published installation baseline / 当前安装基线：`0.1.17`. Changes described as “this change / 本次改动” require a candidate built from the exact reviewed commit and do not imply a published version.

## Record the exact target / 记录准确对象

Create one small record under the task-owned `work/` namespace (or attach a redacted record to the relevant PR). Reuse the existing runtime and compatible dependencies. Do not include tokens, account files, raw private prompts, or full tool logs. Use local aliases such as `account-A` when comparing accounts.

```text
date/time/timezone:
source commit + dirty diff, or published tag:
package name/version + artifact SHA-256:
installed package version/path verified locally (redact path when shared):
host DSH version / Desktop or standalone Web profile:
OS version / architecture / Node version:
product/provider: China/workbuddy or international/workbuddy-ai
desktop product version / local account alias:
model ID / reasoning offered + selected / context offered + selected:
evidence kind: source | fixture | installed | host-registration | live
case ID / exact action or command / expected / observed:
result: passed | failed | not-tested | blocked
sanitized evidence path or screenshot / upstream response ID if safe:
limitation / failure code / next action:
```

Every result belongs to that tuple of artifact, host, platform, product, account and model. A pass for one tuple cannot be copied into another. For a locally built candidate, retain its source SHA, dirty-diff identifier if applicable, and package hash; its unchanged manifest version alone cannot distinguish it from the published baseline. 每条结果只证明该组合，不能从一个产品、平台或 RC 外推。

## Offline source qualification / 离线源码检查

From the repository root, run these serially after integration. Use already installed compatible dependencies; use `pnpm install --frozen-lockfile` only when needed. Capture command, exit code and a concise log reference.

```sh
pnpm run check
node tools/check-repository.mjs
```

These commands qualify local source/build/tests/package rules only. Synthetic upstream events and platform fixtures must remain labelled `fixture`; even a real prepared-call wire body does not prove an upstream request succeeded. 本地检查通过不等于 CI、安装、激活或真实推理通过。Record CI separately against its actual commit.

## Installation and readiness / 安装与就绪

1. Record the current enabled plugin and rollback version/configuration. Download or build exactly one intended artifact. Compute its hash with `Get-FileHash -Algorithm SHA256 <package.tgz>` on PowerShell, `shasum -a 256 <package.tgz>` on macOS, or `sha256sum <package.tgz>` on Linux. Compare with an independently supplied release checksum when available; a self-computed hash identifies the artifact but does not authenticate its origin.
2. For Desktop, install through Extensions → Plugin Management → Add Plugin. For a standalone Web profile you control, use the versioned command in the [guide](guide.en.md#install-or-replace). Keep the community package disabled until the original `dsh-workbuddy-connect` is disabled; then enable the community package. Preserve the original and its data for rollback.
3. Verify the installed package version and enabled state through the host, then confirm that each intended provider appears once. Do not infer activation from the `.tgz`, source manifest or a successful install command alone.
4. Run both read-only diagnostics below for the products being accepted. Save the redacted JSON with the case record. A credential found locally is not a token validation or generation test.

```sh
dsh-workbuddy-connect-community doctor --share --provider workbuddy
dsh-workbuddy-connect-community doctor --share --provider workbuddy-ai
```

5. Open the model picker and plugin status in the actual host. Record catalog source/time, model IDs, offered efforts, and context choices. Confirm the two providers keep separate product/account state. If the desktop product, credentials, or host service is unavailable, record `blocked` with the diagnostic reason; never substitute fixture evidence.

## Coverage matrix / 覆盖矩阵

Fill one record per tested cell. Every unexecuted cell stays `not-tested`. The declared DSH range is `0.2.1-rc.2`, `0.2.1-rc.3`, `0.2.1-rc.5`, `0.2.2-rc.1`; qualify each release/profile separately. Versions outside it need their own compatibility work before a support claim.

| Actual machine / 实机 | China `workbuddy` | International `workbuddy-ai` | Required separate evidence / 独立证据 |
| --- | --- | --- | --- |
| Windows | not-tested in this contract | not-tested in this contract | OS/arch, DSH/profile, installed artifact, desktop version, cases below |
| macOS | not-tested in this contract | not-tested in this contract | Same; record missing product/helper as blocked |
| Linux | not-tested in this contract | not-tested in this contract | Same; record missing product/helper as blocked |

Existing evidence is narrower: the guides record a Windows China catalog/menu observation and specific host-registration checks. They do not establish accepted live generation for all products, hosts or systems. 已有 Windows 目录/菜单/注册证据不填充本表真实生成结果。

## Live cases / 真实请求用例

Run only within explicitly authorized live-request scope and an agreed small request/credit budget. Record the actual count and stop at that budget. Do not force quota exhaustion, policy violations or busy conditions; observe them naturally or cover classification offline. If a required condition cannot be reproduced safely, mark that case `not-tested`. No automatic replay or account rotation is part of this contract.

| Case | Action / 操作 | Acceptance evidence / 通过证据 |
| --- | --- | --- |
| L1 Basic stream | Select the recorded provider/model and ask `Reply exactly: COMMUNITY_ACCEPTANCE_OK`. | Actual response text, successful completion, elapsed time, provider/model and safe response ID; distinguish a catalog entry from generation. |
| L2 Cancellation | Start a bounded request such as `Count from 1 to 200, one number per line`; cancel after the stream starts. | Host reaches cancelled state promptly, stream stops, no invented success or credit badge; record whether upstream cancellation was observable. Do not infer zero billing. |
| L3 Tools | In a disposable task-owned directory, ask the host to use its read-only tool to list that directory, then state the returned name. Do not grant unrelated write or shell scope. | Tool-call ID/name/arguments and result linkage preserved, final answer follows the real result, no duplicate execution. Record host permissions/tool availability; unavailable tools mean blocked. |
| L4 Effort | Pick one currently declared or validating-observed effort; send a small request. For this change, also set a per-model default in the existing row, reload, explicitly override for one request, then reset. | Offered/selected/saved/effective values, request metadata or sanitized wire evidence and live outcome agree. Explicit choice wins; reset restores valid upstream/host behavior. Effort request evidence does not prove the provider internally used a particular thinking budget. |
| L5 Context | Choose one declared context tier, reload the host, then inspect the current model/account state. | Persisted tier and host context budget agree; a model without tiers offers no invented choice. No huge-context paid request is required. |
| L6 Credit | Inspect L1 or another already authorized completed response with actual `usage.credit`. If it is missing, record unknown; do not make extra requests just to obtain a badge. | Badge is tied to that response/message/provider/account; explicit `0` shows, unknown stays hidden. It is one response observation, not summed tool/session billing. Compare restart/session unload clearing only after preserving the evidence. |
| L7 Account isolation | For this change, opt in to two already authorized saved accounts in one region, select explicitly between idle requests, then return to desktop-following mode. Repeat in the other region only if available. | Selection persists; regions and preferences stay isolated; no silent rotation, desktop-auth modification or exported credentials. Concurrent refresh/switch race evidence belongs in offline tests unless the actual host run observes it. |
| L8 Mixed history | Continue a bounded conversation that already includes another provider/model's assistant reasoning and a tool result, then switch to the tested provider/model. | Sanitized prepared wire evidence excludes foreign reasoning but preserves answer text/tool linkage and own-model thinking. Live completion is separate; a visible answer alone cannot prove the history filter. |

For this change, confirm structured errors in focused offline wire tests: `14003` model busy, `14018` credits exhausted, `11140` policy rejection, `11128` channel rejection, and `6020/6021/6022` queue status. Genuine HTTP 401 must remain authentication; nested codes, request IDs or free text must not impersonate a structured top-level code. In a live failure, record HTTP/business code and host outcome separately. Busy is not evidence of exhausted credits; deterministic rejections must not trigger automatic retries. 本次改动的错误分类应同时有离线回归证据；未遇到的线上错误保持未测。

## Completion and cleanup / 完成与清理

Report passed, failed, blocked and not-tested cases explicitly, with their exact coverage tuple and evidence kind. Attach only redacted material. Retain the small record, chosen package hash and useful screenshots; stop task-owned hosts/watchers and remove disposable scratch after checking its resolved boundary and consumers. Preserve the rollback package/configuration until installation acceptance and the user's rollback window are complete. A PR, green CI, published tag or installed plugin is a separate milestone from live acceptance.
