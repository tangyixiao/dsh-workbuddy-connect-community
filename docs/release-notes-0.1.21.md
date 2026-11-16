# dsh-workbuddy-connect-community 0.1.21

## 简体中文

在原有 WorkBuddy / WorkBuddy AI 卡片中增加账号额度和用量记录：

- 明确刷新全部或单个已保存账号的额度，最多同时查询两个账号，不切换账号、不生成回复、不领取签到积分。查询失败保留最近成功值与时间；异常账单响应不会覆盖为零余额。
- 保存本插件实际观测到的已完成响应，提供滚动 1／7／30 天统计、账号／模型汇总与最近请求。缺失积分保持未知，不按价格估算。记录仅覆盖本插件，不是官方总账单。
- 历史分别按产品保留最近 31 天、最多 5,000 条、每文件最多 4 MiB；最近明细最多 100 条。超过保留期的记录在下次本地读取时安全裁剪；损坏历史不会自动重置。
- 按具体账号显示手动／自动签到结果、时间与实际领取积分。重复准入不覆盖未知结果；账号或目标凭据变化后的迟到结果不写回。签到执行和准入规则保持原有边界。
- 面板暂时刷新失败时保留旧信息并暂停写操作，重新验证后恢复。未授权请求清空私有展示；页面隐藏时暂停周期刷新。
- 更新中英文操作说明和旧版本状态，并增加 macOS Intel 的 CI 运行环境。
- 包含此前已合入主分支的 `pi-ai 1.5.2` 运行时依赖维护；宿主兼容范围保持不变。

升级沿用已有账号与设置，不改写原生 WorkBuddy 登录状态。额度快照和最近签到结果属于进程内缓存，重启后需重新观测；持久用量历史和持久签到准入分别处理。卸载或降级包不会自动清除历史文件。媒体、CLI、上下文救援和自动化仍默认关闭；已有明确选择按原设置保留。

兼容范围保持不变。离线测试、包检查与界面夹具不等于真实上游额度查询、签到或模型生成验收；具体证据随对应源码提交、CI、发布与安装记录分别核对。完整范围和恢复说明见[账号与用量指南](accounts-and-usage.md)。

## English

Extend the existing WorkBuddy / WorkBuddy AI cards with account credits and observed usage:

- Explicitly refresh all saved accounts or one account, with at most two concurrent queries and no selection, generation or check-in claim. Failed queries retain the last successful value and time; malformed billing responses cannot replace them with a fabricated zero.
- Retain completed responses observed through this plugin, with rolling 1/7/30-day totals, account/model aggregates and recent requests. Missing credits remain unknown, without price estimates. Coverage excludes other clients and official account-wide billing.
- Bound each product's history to 31 days, 5,000 records and 4 MiB, exposing at most 100 recent details. Local reads safely prune expired durable rows; corrupt history is never silently reset.
- Display account-specific manual/automatic check-in outcomes, timestamps and observed awards. Duplicate admission does not replace unknown results, and late account/credential-changed results are rejected. Existing claim/admission behavior remains intact.
- Preserve stale information read-only after transient refresh failures until revalidation. Unauthorized requests clear private views; hidden pages pause periodic refresh work.
- Reconcile bilingual documentation and previous version status, and add macOS Intel CI coverage.
- Include the previously merged `pi-ai 1.5.2` runtime dependency maintenance, without widening host compatibility.

Upgrade reuses existing accounts/settings without rewriting native WorkBuddy sign-in. Credit snapshots and recent check-in observations are process-local caches; durable usage history and durable check-in admission are separate. Removing or downgrading the package does not automatically delete retained history. Media, CLI, context rescue and automation remain opt-in; existing saved choices are retained.

Compatibility ranges are unchanged. Offline tests, package inspection and UI fixtures do not establish current upstream credit queries, check-in or model generation. Verify source/CI/publication/install evidence separately. See the [account and usage guide](accounts-and-usage.md) for scope and recovery limits.
