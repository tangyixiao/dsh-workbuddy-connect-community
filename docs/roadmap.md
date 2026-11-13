# Feature boundaries and roadmap / 功能边界与路线

The published installation baseline is **0.1.17**; see its [release notes](release-notes-0.1.17.md). The preceding locally active **0.1.18** candidate and the upcoming **0.1.19 source candidate** are separate artifacts. This page describes source scope and remaining qualification, not a new release, a completion percentage or proof of live compatibility. Use the [complete toolkit operating guide](complete-toolkit.md) for steps, tool/command names and acceptance cases.

公开安装基线仍是 **0.1.17**。此前本地已激活的 **0.1.18** 候选与目标为 **0.1.19** 的本轮源码分别记录；旧候选激活不证明新工具集已安装或发布。本页说明源码范围与待验收边界，不提供开发百分比。操作步骤、工具、命令和验收用例见完整工具集指南。

## Published core / 已发布核心

| Capability / 能力 | Boundary / 边界 |
| --- | --- |
| Two providers / 双产品 | `workbuddy` and `workbuddy-ai` retain separate product/account boundaries. Enable only one of the original and community packages. / 两个产品分别隔离，原版与社区版不能同时启用。 |
| Models and context / 模型与上下文 | Current declarations feed model, reasoning and context choices; missing tiers are not invented. / 模型、推理与上下文档位依据声明，不补造缺失档位。 |
| Response credit / 单响应积分 | One completed upstream response's observed `usage.credit`, joined to the matching message/provider/account. Unknown stays hidden; memory is bounded and ephemeral. / 不是工具总计、会话总价或持久账本。 |
| Diagnostics / 诊断 | `doctor --share` has shipped since stable 0.1.11, excludes private diagnostics and reports inference `not-tested`. / 从正式版 0.1.11 起提供，明确真实推理未测。 |
| Dependency fixes / 依赖修复 | 0.1.17 qualifies the patched plugin dependencies; host-owned dependencies remain a separate boundary. / 不代表全部宿主依赖已修复。 |

The guides retain the narrower Windows catalog/menu and exact host-registration evidence. macOS/Linux live use, real generation and cross-region behavior require their own [acceptance records](acceptance.md).

已有 Windows 目录、菜单和特定宿主注册证据只证明对应范围；macOS/Linux 真实运行、模型生成、跨区服务需独立记录。

## Candidate source capabilities / 候选源码能力

These additions require the exact reviewed candidate and compatible host services. A published 0.1.17 install or the older active 0.1.18 candidate does not establish their installation. Source tests and mocked wire/host/process cases do not establish actual upstream success.

以下能力需准确的本轮候选包及兼容宿主服务。稳定包或旧候选的安装证据不能外推本轮；源码、模拟协议、宿主和子进程测试不能填作真实服务成功。

| Capability / 能力 | Source contract / 源码合同 |
| --- | --- |
| Structured failures / 错误分类 | Separate busy, hard credit, policy, channel and queue outcomes; keep actual HTTP 401 as authentication. / 不因业务拒绝自动重试。 |
| Foreign reasoning and defaults / 历史与推理默认值 | Strip foreign assistant thinking while preserving text/tool linkage; account/model-scoped validated defaults obey explicit request choices. / 不修改调用方对象，不补造推理等级。 |
| Saved accounts / 保存账号 | UI save/use/follow/name/remove, opaque IDs and durable revision checks; region and refresh isolation; no desktop-auth rewrite. / 过期写入、选中账号移除、损坏状态均拒绝。 |
| Passive availability / 被动可用性 | Account/model-scoped busy/queue observations, source/time/TTL and verified retry timing. Expired/absent is unknown; no proactive generation probe or invented queue position. / 无健康保证。 |
| Promotion facts / 活动事实 | Source/freshness, valid fixed windows and verified daily timezone windows. Unknown schedules, base prices, eligibility and tiers stay unknown. / 不按徽标推算免费额度。 |
| Optional rotation / 可选轮换 | Default off; explicit same-region pool and switch limit. Confirmed hard-credit failure may select a backup for the next independent request only; never replay the failure or rotate on policy/channel/busy/queue/network ambiguity. / 授权主账号与实际服务账号分别绑定。 |
| Check-in / 签到 | Explicit owner manual action for a saved personal account, or opt-in bounded automation with a member allowlist; authoritative status and durable admission before claim. Automatic HTTP Date UTC day is conservative, with a shared rolling 24-hour guard. Unknown is retained without repeated claims. / 手动不依赖自动化开关，不推测账单时区，不做企业领取。 |
| Images and video / 图片与视频 | Separate default-off switches, declared media catalog models, per-call approval, one submission and durable account-bound task queries. Text/image edit and text/frame video; reference-to-video is rejected before billing. / 不接收模型传入凭据，不因超时重生成。 |
| CodeBuddy review / CLI 审阅 | Default off; configured workspace/model/effort, ordinary CLI permissions, Read/Glob/Grep, strict empty MCP, no hooks or session persistence, bounded child and cancellation. Uses its own CLI sign-in; no hard filesystem sandbox is claimed. / 模型工具逐次审批，人工命令明确授权。 |
| Context rescue / 上下文救援 | Default off; original export and effective summary target/account preview, then explicit human apply for the same idle content/routing and authorization revision. Verify host policy overrides; freeze the actual send scope, allow one summary send and no rotation/retry. Original retained; no model apply tool or failed-request resend. / 摘要在应用时由宿主生成，预览不承诺精确文本，未知实现或外产品目标拒绝。 |

Host tool, approval, command, session and compaction adapters are based on inspected **0.2.2-rc.1** contracts and fail closed when required services are absent. This does not widen engine/peer ranges. The original two-card composition is retained; Chinese/English desktop/mobile visual acceptance remains a separate record.

宿主适配依据已核对的 **0.2.2-rc.1** 合同，缺少必要服务时不可用，不扩大依赖与引擎范围。继续使用原有双卡片布局，中文、英文及桌面/移动尺寸的视觉验收单独记录。

## Remaining qualification / 后续验收

| Work / 工作项 | Required evidence / 所需证据 |
| --- | --- |
| Integrated source and artifact / 集成源码与包 | Full local checks, repository/package inspection, exact source commit, candidate version and artifact hash; CI is a separate result. / 不把局部测试当作完整构建或 CI。 |
| Installation and UI / 安装与界面 | Verify the actual installed version and activation, missing-service behavior and existing card states at desktop/mobile widths. / 保留回退材料，按真实版本截图。 |
| Live optional actions / 真实扩展操作 | Separate explicit authorization and small action/credit budget for media, CLI inference, check-in and model-backed compaction. / 未授权不执行，未执行保持未测。 |
| Wider products/platforms / 更多产品与平台 | Record exact host/profile, OS/architecture, product, account and model for each real run. / Windows 的目录或夹具结果不能外推 macOS、Linux 或国际服务。 |
| Unsupported extensions / 未支持扩展 | Reference-to-video and other unimplemented modes need a verified protocol/credential/approval design before adoption; no fallback to guessed endpoints or providers. / 不把接口存在当作已接入或已验收。 |

Use the [toolkit's no-charge acceptance cases](complete-toolkit.md#acceptance-without-new-live-charges--不增加真实扣费的验收) before any separately authorized live run. Preserve source, fixture, build, CI, publication, installation/activation and live-use boundaries in every delivery record.

先执行不增加真实扣费的验收用例，再决定另行授权的真实请求；交付记录始终区分源码、夹具、构建、CI、发布、安装激活与实际使用。
