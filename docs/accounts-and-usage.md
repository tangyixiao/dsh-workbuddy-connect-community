# Accounts, credits and observed usage / 账号、额度与已观测用量

This guide describes the 0.1.21 source scope. Publication, installed version, host activation and real upstream actions require separate evidence. / 本文描述 0.1.21 的源码范围；发布、实际安装、宿主激活与真实上游操作分别核验。

## Saved-account overview / 已保存账号总览

Expand **Accounts and optional features** in the existing WorkBuddy or WorkBuddy AI card. Save accounts through the existing desktop sign-in flow. Account controls affect the plugin's selection; they do not rewrite the desktop client's login state.

展开 WorkBuddy 或 WorkBuddy AI 原有卡片中的「账号与扩展能力」，通过现有桌面登录流程保存账号。选择账号只改变插件使用的账号，不改写桌面客户端登录状态。

Explicit credit refresh reads each saved account's balance and available expiry data without selecting that account, generating a response or claiming check-in credits. Each account keeps its last successful result and timestamp; a failed refresh is shown as stale/unavailable rather than a zero balance. Login expiry and credit-package expiry are different facts. CN and global accounts remain separate. Refresh uses at most two concurrent account queries; opening or reading the toolkit does not automatically query every account.

明确点击额度刷新后，插件读取已保存账号的余额与上游提供的积分到期信息，不会选中该账号、生成回复或执行签到。各账号分别保留最近成功结果与时间；刷新失败标为过期或不可用，不把失败显示成余额为零。登录有效期与积分包到期是两种信息。国内版与国际版分别处理，额度查询最多同时执行两个；仅展开或读取工具面板不会自动查询全部账号。

Credit snapshots and the latest check-in observations are process-local caches. Restarting the plugin clears those views; credit values return after an explicit refresh and check-in results after a later observed attempt. The durable usage history below and existing durable check-in admission are separate. / 额度快照和最近签到结果是本次进程内的缓存，插件重启后清空；额度需明确刷新，签到结果在后续实际观测后出现。下文的持久用量历史、以及原有的持久签到准入记录分别处理。

## Retained observed usage / 已观测用量留存

The history covers completed model responses passing through this plugin from the time this version starts recording. It is not the WorkBuddy account's official total bill. Requests from native clients, other plugins or earlier versions are outside its coverage. Response credits come only from upstream observations; missing credit remains unknown and is counted separately. No token-price estimate fills a missing value.

历史只覆盖本版本开始记录后、经过本插件且收到完成信息的模型响应，不是 WorkBuddy 账号的官方总账单。原生客户端、其他插件或更早版本的请求不在覆盖范围内。积分只使用上游实际返回的观测值；缺失积分保持未知并单独计数，不按 token 单价补算。

The observer runs on completed text/chat streams with a usable response ID. Incomplete streams or responses without that identity are omitted, so unknown-credit counts are not failed-request totals. Separate media jobs, native CLI work and external tool charges are not reconstructed or added from balance changes. / 观测器位于文本／聊天流，需有完成信息与可用响应 ID。中断或缺少响应标识的请求不入表，因此「积分未知」数量不是失败请求总数。独立媒体任务、原生 CLI 和外部工具费用不按余额变化补算或叠加。

History stores opaque account IDs, model IDs, response IDs, observation times and optional credit values. It excludes credentials, raw user IDs, prompts, message content, tools and private diagnostics. A response remains attributed to the account captured when its request started, even if another account is selected before it completes. History and the short-lived per-message credit display have different lifetimes.

历史保存不透明账号标识、模型标识、响应标识、观测时间和可选积分值，不保存凭据、原始用户 ID、提示词、消息正文、工具内容或私有诊断。请求期间切换账号时，完成响应仍归属请求开始时捕获的账号。历史留存与消息旁的短期积分展示具有不同生命周期。

The default files are `<DSH_HOME>/.workbuddy-model-visibility.json.toolkit.usage` and `<DSH_HOME>/.workbuddy-ai-model-visibility.json.toolkit.usage`. Keep these local; response identifiers and usage metadata can still be private. / 默认文件分别为上述 DSH_HOME 下的国内版与国际版 `.toolkit.usage` 文件；应留在本机，响应标识和用量元数据仍可能属于私有信息。

Retention is bounded to the most recent 31 days, at most 5,000 records and a 4 MiB file limit. Views show rolling 1/7/30-day windows and at most 100 recent request details, with account/model aggregates and unknown-credit counts. A retention or size limit can make coverage partial. The windows are elapsed-time windows, not calendar-day or billing-timezone totals.

最多保留最近 31 天、5,000 条记录，历史文件上限为 4 MiB。界面展示滚动 1／7／30 天窗口、账号与模型聚合、未知积分请求数和最多 100 条最近请求。保留天数或容量上限可能使记录不完整。统计窗口按经过时间计算，不代表自然日或账单时区的日总计。

Storage failure never fails the model response. A corrupt or oversized history is reported unavailable and is not silently replaced. Preserve the affected file for recovery before manually moving it aside. Removing or signing out an account changes what the authenticated panel may display; it does not reconstruct or erase an official bill. Uninstalling or downgrading the package does not automatically remove retained state. No automatic import of older client logs is performed.

保存失败不会使模型回复失败。损坏或超限历史会报告不可用，不会静默覆盖；手动移走文件前应保留恢复副本。移除账号或退出登录会改变受认证面板能够显示的范围，不能重建或删除官方账单。卸载或降级插件不会自动删除保留状态。插件不自动导入旧客户端日志。

## Check-in and refresh outcomes / 签到与刷新结果

Each displayed check-in result identifies its saved target account, observation time, manual/automatic source, outcome and observed awarded credits when available. Automatic participation still requires explicit enablement and membership. Unknown outcomes remain unknown; displaying them does not submit another claim. Check-in support depends on the actual product/account/active upstream campaign.

每个签到结果对应具体已保存账号，包含观测时间、手动／自动来源、结果，以及上游确实返回时的领取积分。自动签到仍需明确开启并选择参与账号。不确定结果保持不确定，展示结果不会再次领取。是否支持签到取决于实际产品、账号与上游活动。

A transient panel refresh failure retains the last successful display as stale and read-only until revalidation. Unauthorized access, sign-out or provider changes clear private state. Old revisions never authorize new account mutations. Hidden documents do not start periodic refresh work.

面板遇到暂时刷新失败时保留最近成功结果，标记过期并暂停写操作，重新验证后恢复。未授权、退出登录或产品切换会清空私有展示。过期版本号不能授权新的账号操作。页面隐藏时不启动定时刷新工作。

## Acceptance / 验收

Offline tests and fixtures can establish bounds, account attribution, revision rejection, display behavior and package contents. They cannot establish successful current WorkBuddy billing queries, check-in claims or model generation. Validate those actions separately with the intended account and a small explicit action budget.

离线测试与夹具可验证容量、账号归属、过期写入拒绝、界面行为和包内容；不能证明当前 WorkBuddy 额度接口、签到领取或模型生成真实成功。真实操作需按目标账号和明确的小额操作预算另行验收。
