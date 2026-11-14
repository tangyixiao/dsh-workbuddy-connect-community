# Feature boundaries and roadmap / 功能边界与路线

The published installation baseline is `0.1.17`; see its [release notes](release-notes-0.1.17.md). This page distinguishes the existing core, this source change, and future proposals. It is not a release announcement, percentage-complete chart, or evidence of live compatibility. 当前安装基线为 `0.1.17`；本页不代表新版本发布、全部平台验收或开发百分比。

## Existing core / 已有核心

| Capability / 能力 | Boundary and evidence / 边界与证据 |
| --- | --- |
| Two providers / 双产品 | `workbuddy` and `workbuddy-ai` retain separate product/account boundaries while reusing desktop sign-in. The original and community packages cannot both be enabled. |
| Model/context controls / 模型与上下文 | Catalog models, validated reasoning choices and declared context tiers feed existing host controls. Missing tiers are not guessed; fresh desktop context fallback has strict account/model/input-cap matching. |
| Credit observation / 积分观测 | A bounded in-memory observation of one completed upstream response, linked to a message. Unknown is hidden, observed zero can show; it is not a durable ledger or a session/tool total. |
| Diagnostics / 诊断 | Redacted `doctor --share` is read-only and explicitly reports live inference as `not-tested`. Host owner authentication protects available Web controls. |
| Release dependency fixes / 依赖修复 | 0.1.17 qualifies patched plugin runtime dependencies; it does not claim all host-owned dependencies are patched. |

The guides preserve the narrower Windows catalog/menu and host-registration evidence. macOS/Linux live use and cross-region generation require [actual acceptance records](acceptance.md); a platform fixture cannot establish them. 已有源码、测试和目录能力与实际平台、账号、上游服务验收分别记录。

## This change / 本次源码改动

The following work is scoped to the reviewed source and its verification record. Installing the published `0.1.17` package does not by itself install these additions. Consult the PR's exact commit/checks and candidate artifact before testing them.

| Work / 工作项 | Contract / 验证合同 |
| --- | --- |
| Structured upstream failures / 上游错误分类 | Separate busy, exhausted credits, policy, channel and queue codes. Keep genuine HTTP 401 as authentication, ignore nested/request-ID false positives, and avoid deterministic retries. |
| Foreign thinking / 外来思考过滤 | Remove another provider/model's assistant thinking before conversion; preserve original text, tools, own-model thinking, route IDs and caller input objects. Verify prepared bodies for both regions. |
| Per-model effort defaults / 模型默认推理等级 | Existing model rows manage defaults by region/account/model. Only offered validated efforts are selectable. Explicit request choice wins, then saved preference, then a valid upstream default, then existing host behavior; reset is available. Persist before applying and reject stale account writes. |
| Manual saved accounts / 手动账号管理 | Explicit plugin-owned save/list/select/follow-desktop operations with redacted output and region/refresh isolation. No arbitrary file scan, desktop-auth rewrite, silent account refresh or automatic rotation. |
| Documentation / 文档 | Version-correct installation links, precise credit semantics, executable platform/product acceptance and this bounded roadmap. |

Local tests, package creation, installation/activation and live acceptance remain separate milestones. The delivery record must state which actually ran. No new model identity, fingerprint obfuscation or automatic failed-conversation replay is included.

## Further proposals / 后续提案

These are dependencies and decision gates, not promises or work marked complete. 后续项尚不视为已实现，先满足前置条件再决定范围。

| Proposal / 提案 | Prerequisites / 前置条件 | Acceptance boundary / 验收边界 |
| --- | --- | --- |
| Busy/queue visualization / 忙碌与排队展示 | Reliable structured classifications and real examples of retry/queue timing; choose existing host status surfaces first. | Display only observed state and timing; no invented queue position, capacity or automatic retry. A substantial UI change needs approved visual composition. |
| Promotions/plan metadata / 活动与套餐信息 | A documented authoritative upstream source, clear expiry/timezone and account/region scope, and permission to display it. | Label source and freshness; do not infer free quota, discounts or eligibility from model availability. No fabricated marketing content. |
| Context rescue / 上下文救援 | Defined host context/session APIs, reliable token/context limits, explicit user intent and a recoverable preview of proposed compaction/export. | Preserve tool/result linkage and let the user inspect what is retained. Do not silently replay a failed request or send the conversation to another service. |
| Automatic account rotation / 自动轮换 | Separate explicit authorization and design review, service-term assessment, quota/error distinctions and race-safe account isolation. Manual account management must first be accepted. | Current behavior remains manual. Future work must define consent, observable selection, costs, stop conditions and credential boundaries before implementation; no account cycling to bypass a policy/channel rejection. |
| Wider host/platform support / 扩大兼容 | Real supported desktop product and exact DSH/runtime on each intended machine. | Execute the [coverage matrix and live cases](acceptance.md) per product/OS/host. Keep unavailable combinations blocked or not-tested. |

Use a scoped issue or PR to agree a proposal's trigger, dependencies, evidence and stop conditions before implementation. Live service behavior can change independently of the package; acceptance records need dated versions and actual observations.
