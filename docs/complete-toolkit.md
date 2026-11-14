# Complete toolkit operating guide / 完整工具集操作指南

This guide describes the source candidate targeting **0.1.19**. It is an operating contract, not a release announcement or a record of successful live requests. Read the [main English guide](guide.en.md), [中文主指南](guide.zh-CN.md), [feature boundaries](roadmap.md) and [acceptance record format](acceptance.md) alongside it.

本文说明目标版本为 **0.1.19** 的源码候选功能，是操作说明与验收合同，不表示已经发布或真实服务请求已经通过。安装、激活、宿主接线、模拟测试和真实请求分别记录。

| Version / 版本 | What it establishes / 证据边界 |
| --- | --- |
| Published stable / 已发布正式版 **0.1.17** | The [stable release](https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/tag/v0.1.17) and [npm version](https://www.npmjs.com/package/dsh-workbuddy-connect-community/v/0.1.17) remain the published installation baseline. Installing them does not install the toolkit described here. / 仍是公开安装基线，不包含本文对新增工具集的发布承诺。 |
| Previously activated local candidate / 前一轮本地已激活候选 **0.1.18** | The preceding local candidate is a separate artifact. Its activation does not prove that the upcoming toolkit is installed, published or live-tested. / 前一轮本地候选包的激活不能证明本次工具集已经安装、发布或完成真实请求验收。 |
| Source candidate / 本轮源码候选 **0.1.19** | Requires a build/package from the exact reviewed commit, its own package hash, and separate installation/activation evidence. / 需记录准确源码提交、包哈希，以及独立安装与激活证据；不能直接套用旧候选包结果。 |

## Start in the existing cards / 从现有卡片开始

Open the matching **WorkBuddy** or **WorkBuddy AI** plugin card and expand **Accounts and optional features / 账号与扩展能力**. The two products retain separate accounts and settings. Images, videos, CodeBuddy review, context rescue, automatic rotation and automatic check-in all start off. Save the current account before choosing its optional features. Settings are persisted before effects become available.

进入对应产品的原有卡片，展开「账号与扩展能力」。国内版与国际版的账号、设置分别保存。图片、视频、CodeBuddy 审阅、上下文救援、自动轮换和自动签到默认关闭。先保存当前账号，再为其选择功能；设置成功持久化后才开放相应操作。

Tools and paid actions need compatible host services. The source adapters were checked against DSH **0.2.2-rc.1** interfaces; that inspection does not widen the package's declared compatibility range or qualify other hosts. Missing tool, approval, command, session or compaction services leave the dependent operation unavailable. A feature switch makes a capability available; it does not itself approve a media/CLI call or start generation.

工具和可能计费的操作依赖相应宿主服务。源码适配器依据 DSH **0.2.2-rc.1** 接口核对，不据此扩大包的兼容范围。缺少工具、审批、命令、会话或压缩服务时，相关能力保持不可用。打开功能开关只开放能力，不等于批准某次媒体或 CLI 调用，也不会立即生成内容。

## Saved accounts / 保存账号

Use **Save current account / 保存当前账号** to create or update a plugin-owned snapshot of the effective sign-in. To capture a different desktop sign-in while a saved account is selected, first choose **Follow desktop sign-in / 跟随桌面登录**. Each row supports **Select as primary / 选为主账号**, a local display name, and **Remove / 移除**. Switch away from a selected primary account before removing it. Names are for identification, not proof of quota, entitlement or successful authentication.

「保存当前账号」保存的是当前有效登录。如果已经手动选择保存账号，要捕获另一个桌面登录，应先恢复「跟随桌面登录」。账号行提供「选为主账号」、本地显示名称与「移除」；移除当前主账号前，先选择其他主账号或恢复跟随桌面登录。名称只用于辨认，不证明额度、权益或认证有效。

Account and settings controls carry durable revisions. A stale write is rejected and the card reloads the latest state; inspect it before acting again. No token, raw account identifier or account-file content belongs in an issue report. Saved snapshots contain credentials even though the controls and account CLI return redacted data. Saving/removing a snapshot does not edit the desktop app's auth file. The existing `logout` command does not delete all saved accounts; see the [account CLI instructions](guide.en.md#this-change-manually-save-and-select-accounts).

账号和设置操作携带持久化版本号；状态过期时拒绝写入并重新读取，核对后再操作。账号快照包含凭据，不能作为问题附件；控件或 CLI 输出脱敏不代表存储文件也脱敏。保存、移除快照不会修改桌面认证文件；已有 `logout` 也不等于删除全部保存账号。

## Observed availability and promotions / 可用性观测与活动信息

Busy/queue information comes from actual structured upstream responses for the matching product, account and model. Observations have source/time information and a short TTL (120 seconds by default). An expired or absent observation means **unknown**, not healthy or immediately available. Retry timing is shown only when a valid upstream `Retry-After` value was observed. There is no proactive generation probe, guessed queue position, capacity estimate or polling loop that submits requests to measure availability.

忙碌、排队状态只取自对应产品、账号、模型实际响应中的结构化分类，并保留来源、观测时间和短期有效期，默认 120 秒。没有记录或记录过期表示「未知」，不表示服务健康、立即可用。重试时间只采用有效的上游 `Retry-After`；不通过额外生成探测可用性，不编造排队位置或容量。

Promotion facts retain their upstream source and fetch time. Fixed windows need valid boundaries; daily windows need verified start/end values and a supported explicit timezone. Cross-midnight windows are evaluated in that timezone. Unknown or malformed timing stays unknown. Upstream discounts/badges are not a base price, a free-quota calculation or a promise that this account qualifies. Existing billing balances and expiries remain separate observations; no plan tier or missing price is invented.

活动信息保留上游来源与获取时间。固定活动需有效起止边界，每日活动需可验证时间和明确受支持的时区；跨午夜窗口按该时区判断。缺失或无效时间保持未知。折扣因子、徽标不能代替原价、免费额度或账号资格；原有余额、到期信息另行展示，不补造套餐等级或价格。

## Optional next-request rotation / 可选的下一请求轮换

Select each saved account explicitly under **Accounts permitted for automation / 允许参与自动化的账号**, choose the maximum switch count (1–3), then enable **Switch after confirmed credit exhaustion / 积分明确不足后切换账号**. Saving an account does not add it to the pool. The current primary account owns this consent; an eligible selected backup may serve a later independent request.

在「允许参与自动化的账号」中逐个勾选保存账号，设置最多切换次数 1–3，再开启「积分明确不足后切换账号」。保存账号不会自动加入池。授权设置属于当前主账号；选定的合格备用账号可用于之后的新独立请求。

Only a confirmed hard-credit failure arms a switch. The failed request remains failed. The switch is consumed when the next independent request chooses its account; catalog/status reads do not consume it. No conversation is automatically replayed or resent. Busy, queue, policy, channel, authentication and ambiguous network failures do not arm rotation. The pool stays within the same region, has a switch limit, and stops when no eligible account remains. Changing the primary selection or consent resets the policy context. The serving account can differ from the primary consent owner; media approval identifies the actual account that would serve that action.

只有明确的硬性积分不足才触发待切换状态，失败请求仍保留为失败。下一条独立请求选择账号时才消耗切换机会，读取目录或状态不会消耗。不会自动重放或重发失败对话；忙碌、排队、策略/渠道拒绝、认证及网络不确定错误不触发轮换。账号池限于同一区域并受次数上限约束，无合格账号时停止。主账号或授权设置改变会重置策略上下文。实际服务账号可能与授权主账号不同，媒体审批会标出该次操作的实际账号。

## Check-in / 签到

For an explicit manual claim, use the saved personal account's **Check in / 签到** button. This owner-authorized action does not require automatic check-in to be enabled or the account to join its automation pool, and does not select the account for conversations. Enterprise claims are rejected. A separate **Automatic daily check-in / 每日自动签到** switch controls the bounded scheduler and requires an explicit member allowlist; when off, it creates no check-in timer or automatic request.

手动签到直接点击已保存个人账号行的「签到」，这是 owner 的明确操作，不要求先开启自动签到或将账号加入自动化池，也不切换对话账号；企业领取被拒绝。「每日自动签到」另有开关，须逐个选定允许参与的账号，关闭时没有签到定时器或自动请求。

Each attempt first queries authoritative status. Before a claim is sent, a durable admission record reserves the attempt as **unknown**. Automatic admission uses the response's HTTP Date converted to a UTC day, labelled a **conservative boundary**, plus a rolling interval of at least 24 hours across attempts for that account. This is not a guessed billing timezone and does not promise one reward per billing calendar day. Without a valid HTTP Date, automatic claims stay unavailable. Manual claims use an explicit action nonce and the same rolling guard.

每次先查询服务端状态。发送领取前先持久化「结果未知」的占位记录。自动领取将响应的 HTTP Date 换算为 UTC 日期，明确标成「保守边界」，并对同一账号所有尝试施加至少 24 小时的滚动间隔。这不是推测账单时区，也不保证每个账单日恰好领取一次。没有有效 HTTP Date 时不自动领取；手动领取使用独立操作标识，也受相同间隔保护。

A timeout or lost response remains unknown and is not repeatedly claimed. A restart does not erase admission. A confirmed reward is shown only from the claim response; the feature does not estimate rewards or make extra claims to obtain a confirmation. Review current status before a later explicit action.

超时或响应丢失保留为未知，不反复领取；重启不会清除占位。只有领取响应明确返回的奖励才显示，不估算奖励，也不为了确认而额外领取。后续明确操作前先核对最新状态。

## Images, video and exact task queries / 图片、视频与精确任务查询

Enable images and videos separately in the matching card. Each submit still requires its own host approval. The proposal identifies provider, opaque serving account, declared model, mode, input count and a scrubbed prompt excerpt. Check these before approving an action that may consume credits. The server resolves credentials; tool inputs never accept tokens or temporary keys. Model selection uses the current full product catalog's declared media tags, including media rows outside the chat-model roster; it does not invent model IDs or prices.

在对应卡片分别开启图片和视频。每次提交仍需独立宿主审批，提案列出产品、实际服务账号的匿名 ID、已声明模型、模式、输入数量和去除敏感字串的提示词片段。确认后才允许可能扣积分的操作。凭据由服务端解析，工具参数不接收 token 或临时密钥；模型来自完整产品目录的媒体声明，不受聊天模型列表过滤，也不补造模型或价格。

| Tool / 工具 | Modes and inputs / 模式与输入 |
| --- | --- |
| `workbuddy_cn_image` / `workbuddy_ai_image` | `mode: "text"` with `prompt`; `mode: "edit"` with `prompt` and `images` containing bounded image data URIs. Edits accept 1–4 images, at most 20 MiB each; arbitrary local paths are rejected. / 文生图；或提示词加 1–4 张 data URI 图片编辑，每张不超过 20 MiB，不读取任意本地路径。 |
| `workbuddy_cn_video` / `workbuddy_ai_video` | `mode: "text"`; or `mode: "frame"` with `firstFrame` and optional `lastFrame`, using HTTPS image URLs or image data URIs. Duration/resolution must match declared metadata; missing optional resolution fields use the verified official SDK defaults. / 文生视频，或首帧加可选尾帧；时长、分辨率受目录约束，缺少可选分辨率字段时使用已核对的官方 SDK 默认值。 |
| `workbuddy_cn_media_task` / `workbuddy_ai_media_task` | `{ "taskId": "<id returned by the original operation>" }`; only looks up that saved account-bound task and makes at most one upstream status query. / 只查询原操作返回的、绑定账号的任务，至多一次上游查询。 |

For example, the input shape for an image tool is `{ "mode": "text", "prompt": "A small blue paper boat on a quiet lake" }`. This is an example, not an instruction to generate during setup. Optional `model` must name a currently declared model for that exact mode. Reference-to-video is unsupported by this direct transport and is rejected before billing; it is not redirected to another account, provider or service.

图片工具参数示例为 `{ "mode": "text", "prompt": "平静湖面上的一只蓝色小纸船" }`，只是格式示例，设置时无需执行。可选 `model` 必须是当前目录明确支持该模式的模型。该直连实现不支持参考图模式视频，会在计费请求前拒绝，不转交其他账号、提供方或服务。

Submission is reserved locally before sending and is sent once. Logical calls are deduplicated by the real host session and call ID; replaying that call returns its saved result, while changing its transmitted request/model is rejected. Tool arguments cannot supply these identities. Video IDs are persisted before a later query. A timeout preserves unknown status; repeating a status query never starts another generation. Use the returned exact task ID in the same serving account with the capability enabled. Querying another account's ID is rejected. Synchronous image requests can time out without an upstream task ID; their unknown result cannot be resolved by inventing a video task query. Inspect the provider's actual result before considering a new, separately approved action.

提交前先保留本地记录，只发送一次。按真实宿主会话与调用 ID 去重：重放同一逻辑调用返回已保存结果，改写该调用发送的请求或模型会被拒绝，工具参数不能指定这些身份。视频上游任务 ID 保存后才能继续查询。超时保留未知，重复查状态不会启动新生成。请在相同服务账号、功能仍启用时使用原任务 ID，跨账号查询被拒绝。同步图片请求超时可能没有上游任务 ID，不能编造视频查询来恢复；考虑新的独立审批前，先核对实际结果。

Completed results contain generated local image paths or official HTTPS result URLs. Image bytes are stored in the plugin's own media output area, not in account/settings JSON. Treat generated outputs and expiring result links as delivery artifacts, not proof that another product/platform/model was tested. Disabling a capability cancels its outstanding local work; cancellation does not establish that an upstream action incurred no charge.

完成结果返回生成图片路径或官方 HTTPS 结果链接；图片字节存入插件自有媒体目录，不混入账号、设置 JSON。输出和临时链接只证明该次交付，不能外推其他产品、平台或模型。关闭功能会取消相关本地进行中工作，但取消不能证明上游没有扣费。

## CodeBuddy read-only review / CodeBuddy 只读审阅

Use an existing compatible [official CodeBuddy Code installation](https://cnb.cool/codebuddy/codebuddy-code). Its README documents installation and sign-in. In the card, save an absolute workspace folder, exact model ID, explicit reasoning level, time limit (10–300 seconds) and turn limit (1–4), then enable **CodeBuddy review / CodeBuddy 审阅**. Defaults are 60 seconds and three turns, with no preselected workspace/model/effort. Availability of a configured CLI/model/account still needs separate verification.

复用兼容的[官方 CodeBuddy Code](https://cnb.cool/codebuddy/codebuddy-code)安装，其 README 提供安装、登录说明。在卡片保存绝对工作目录、准确模型 ID、明确推理等级、时间上限 10–300 秒及轮数上限 1–4，再开启审阅。默认时限 60 秒、三轮，不预选目录、模型或推理等级；具体 CLI、模型与账号是否可用仍需单独核验。

The per-region tools are `workbuddy_cn_codebuddy_review` and `workbuddy_ai_codebuddy_review`, with one `prompt` input and separate approval on every call. They invoke the installed CLI with an argument array and no shell, only `Read`, `Glob` and `Grep`, empty strict MCP configuration, hooks disabled and session persistence disabled. There is no permission-bypass flag, automatic permission response, session resume or model/account fallback. Output, lines, turns and time are bounded. Ordinary CLI permissions remain in force; this is **not a filesystem sandbox**, and read/search tools can expose data their normal permissions allow.

两个区域的工具分别为 `workbuddy_cn_codebuddy_review`、`workbuddy_ai_codebuddy_review`，只接收 `prompt`，每次另行审批。启动安装的 CLI 时使用参数数组、不经 shell，只开放 `Read`、`Glob`、`Grep`，MCP 配置为空且严格生效，关闭 hooks 和会话持久化。不使用绕过权限参数，不代答权限请求，不恢复旧会话，不切换模型或账号兜底；输出、单行、轮数和时长均有上限。这不是文件系统沙箱，仍沿用 CLI 的普通权限与读取范围。

The CLI uses **its own signed-in account**, which may differ from the WorkBuddy account selected in the card. Its requests can consume that CLI account's credits. A read-only tool restriction prevents modification tools; it does not make an inference request free or automatically constrain every read to a hard sandbox. The compatible host command manager also provides:

CLI 使用**自身已登录账号**，可能不同于卡片所选 WorkBuddy 账号，并可能消耗该 CLI 账号积分。只读工具限制不表示推理免费，也不构成强制目录隔离。兼容宿主命令管理器另提供人工命令：

```text
/workbuddy-codebuddy cn <review prompt>
/workbuddy-codebuddy ai <review prompt>
```

Use `cn` for the China card's saved configuration and `ai` for the international card's configuration. If exactly one region currently has CLI review enabled, the region operand may be omitted; if both are enabled, choose explicitly. There is no cross-region fallback. Typing this human command explicitly authorizes that bounded review using the current saved workspace/model/effort; it does not open another model-tool approval prompt. Review those settings before sending the command. Model-invoked review tools still require per-call host approval.

`cn` 使用国内卡片保存的配置，`ai` 使用国际卡片配置。当前只有一个区域开启 CLI 时可省略区域；两个都开启时必须明确选择，不跨区兜底。本人输入该命令即授权按当前目录、模型、推理等级和预算执行这一轮审阅，不再追加模型工具的审批弹窗，因此发送前先核对配置。模型调用审阅工具仍需逐次宿主审批。

## Context rescue / 上下文救援

Enable context rescue, then use the read-only `workbuddy_context_preview` tool or type:

开启后，使用只读预览工具或输入：

```text
/workbuddy-rescue preview
```

The preview exports original host events and surface references locally under `<DSH_HOME>/.workbuddy-context-rescue`, returning a preview ID, content/routing revision, effective summary provider/model, opaque serving account, export filename and size, and an estimate when the host can provide one. Inspect the retained original export and that target first. The adapter resolves the verified host's exact-model override before global summary settings and the conversation route. A summary target outside the conversation's WorkBuddy product, or an unverifiable compaction implementation, is unavailable. It cannot promise the exact summary text: the host generates that only during a later model-backed compaction. Previews expire after 15 minutes and are unavailable after restart; original exports are retained. Each export is capped at 4 MiB and the active export directory at 20 originals. Reaching a limit stops further growth instead of deleting recovery material automatically; preserve and review existing originals before managing that directory.

预览将原始宿主事件与界面引用导出至 `<DSH_HOME>/.workbuddy-context-rescue`，返回预览 ID、内容/路由版本、实际摘要提供方/模型、匿名服务账号、导出文件名和大小；宿主能提供时才显示估计 token。先检查原始导出和实际目标。适配器按已核对的宿主规则，先采用精确模型覆盖，再采用全局摘要设置和对话路由；目标不属于当前对话的 WorkBuddy 产品，或压缩实现无法核实时，不开放应用。预览不能承诺精确摘要，因为摘要要在之后的宿主模型压缩阶段生成。预览 15 分钟后过期，重启后也不能继续应用，但原始导出继续保留。每份导出最多 4 MiB，当前导出目录最多保留 20 份；达到上限就停止新增，不自动删除恢复材料，管理目录前先保存并核对需要的原件。

Only after inspecting the export, enter the exact command returned by the preview:

检查后，由本人输入预览返回的准确命令：

```text
/workbuddy-rescue apply <preview-id> <revision>
```

Apply requires the **same idle session and exact previewed content/routing, summary policy and account authorization**. A busy or changed session is rejected; create a fresh preview instead of reusing stale consent. Pending/exhausted account rotation must be resolved before rescue; the rescue itself does not consume a rotation. The actual model-send boundary rechecks the frozen target and account, permits at most one summary send per apply, and aborts a changed target or a retry rather than silently using another account/model. The apply token is consumed before mutation, so an uncertain host outcome is not blindly applied again. The model has no apply tool. The host owns compaction and tool/result linkage; compaction may make a model request and consume credits. The original export remains available and the failed conversation request is never resent.

应用只接受**同一空闲会话，以及与预览一致的内容/路由、摘要策略和账号授权**；忙碌或状态变化会拒绝，应重新预览。先处理待轮换或已耗尽的轮换状态，救援本身不消耗轮换机会。实际模型发送边界再次检查冻结的目标和账号，每次应用至多发送一次摘要请求；目标变化或宿主重试会中止，不静默改用其他账号、模型。应用标识在修改前消耗，宿主结果不明时不会盲目重复压缩。模型没有应用工具；压缩及工具/结果关联由宿主负责，压缩可能调用模型并消耗积分。原始导出继续保留，也不会重发失败对话请求。

## Acceptance without new live charges / 不增加真实扣费的验收

Use fake transports, fixture credentials, fake clocks and isolated host/session/process adapters for the cases below. Do not exhaust real quota, submit media, claim a reward or run actual CLI inference merely to mark a source case passed. The [acceptance record](acceptance.md) still identifies exact source/artifact/host/platform/provider tuples. Full integrated local checks, candidate installation/activation and desktop/mobile visual acceptance must be recorded separately in the delivery evidence.

以下用假传输、模拟凭据与时钟、隔离宿主/会话/子进程适配器执行；不为源码验收耗尽真实额度、生成媒体、领取奖励或运行真实 CLI 推理。按原验收模板记录准确对象，完整集成检查、候选包安装激活及桌面/移动尺寸视觉验收另行记录。

| Case / 用例 | Required observation / 观察点 |
| --- | --- |
| T1 Defaults / 默认关闭 | No media request, CLI child, automatic check-in timer/request or compaction effect while its feature is off; explicit manual check-in has separate owner consent. / 关闭时无对应自动效果，手动签到另行明确授权。 |
| T2 Owner and revisions / 身份与版本 | Anonymous/non-owner/origin/key failures rejected; stale account/settings writes do not take effect. / 身份、来源、控制密钥与过期版本均拒绝。 |
| T3 Account controls / 账号操作 | Save/use/follow/name/remove work through revisions; selected removal and corrupted state fail closed; no desktop-auth rewrite. / 持久化、重命名、移除及损坏状态均有验证。 |
| T4 Availability / 可用性 | Inject known busy/queue responses, observe correct account/model TTL and verified retry timing; expiry returns unknown, with no proactive request. / 到期回到未知。 |
| T5 Promotions / 活动 | Fixed/daily/cross-midnight windows obey verified timezone; malformed dates and missing prices remain unknown. / 无效日期、缺失原价不补造。 |
| T6 Rotation / 轮换 | Inject hard-credit failure; failed request is not replayed; only the next independent request may select one eligible member, within the limit. Other failures do not rotate. / 注入错误验证，不制造真实积分耗尽。 |
| T7 Check-in / 签到 | Fake status/date/claim; enterprise denied; manual owner action works with automation off and an empty pool; automatic claims require selected members and HTTP Date; durable unknown/manual attempts share the rolling guard. / 手动与自动授权分开验证，不真实领取。 |
| T8 Media / 媒体 | Mock full product metadata for both regions; deny unsupported mode, malformed input, mismatched credential, stale approval and missing host approval before submit. / 两区目录、审批、身份及输入验证。 |
| T9 Task recovery / 任务恢复 | Unknown survives timeout/cancel/restart; sessions sharing a call ID get distinct tasks; changed requests in one logical call are rejected; exact query never submits; sibling accounts cannot query it. / 不因未知重生成，不跨会话错误去重。 |
| T10 CLI / CLI 审阅 | Fake child proves Read/Glob/Grep arguments, strict empty MCP, no hooks/persistence, output/time bounds and cancellation on disable/disposal. / 不运行真实推理。 |
| T11 Rescue / 救援 | Fixture export precedes mutation; bind effective summary policy/model/account, reject stale/busy/foreign targets and retries, and test concurrent send admission; model cannot apply; original export retained. / 不调用真实摘要模型，验证发送前冻结与唯一提交。 |
| T12 Host and UI / 宿主与界面 | Missing services stay unavailable; registration/disposal remain bounded; inspect the existing cards in Chinese and English at desktop/mobile widths with features off. / 夹具与真实视觉结果分别记录。 |

Live media, CLI inference, reward claims, cross-region service behavior and macOS/Linux runtime use remain **not-tested unless separately recorded for the exact tuple**. Existing Windows catalog/menu observations and host-registration evidence do not establish those results. A future live acceptance run needs explicit authorization and a small agreed action/credit budget; leave every unexecuted case `not-tested`.

真实媒体、CLI 推理、奖励领取、跨区服务及 macOS/Linux 运行，除非按具体组合另有记录，均保持**未测**。已有 Windows 目录/菜单与注册证据不能替代这些结果。今后的真实验收须有明确授权和小范围操作、积分预算，未执行项仍标记 `not-tested`。

## Interface provenance / 接口来源

The transport and command restrictions were checked against installed official WorkBuddy/CodeBuddy interfaces and exact host contracts. The [official CodeBuddy project and README](https://cnb.cool/codebuddy/codebuddy-code) provide the upstream CLI entry point; they do not certify this community adapter. No private account configuration or vendor bundle is published with this guide. Protocol fixtures establish source behavior, while upstream availability and service acceptance require their own dated evidence.

传输、命令限制依据已安装官方接口与准确宿主合同核对。官方项目链接提供 CLI 来源，不为社区适配器背书；本指南不发布私有账号配置或厂商 bundle。协议夹具证明源码行为，上游可用性与真实服务验收仍需独立、带日期的证据。
