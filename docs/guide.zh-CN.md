# 详细使用与技术说明

命令均从仓库根目录执行。返回 [README](../README.md)。

<p><img src="../assets/logo.webp" width="96" height="96" alt="dsh-workbuddy-connect-community logo"></p>

# DSH WorkBuddy Connect Community

[English](../README.en.md) | 中文

由 Tang Yixiao 维护的社区分叉，基于 Corrine Hu 的 MIT 项目 [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect)，保留其原有功能与版权。本项目面向已验证的 DeepSeek Harness 版本，复用本机已登录的 WorkBuddy（国内版）或 WorkBuddy AI（国际版），并保留 `workbuddy` / `workbuddy-ai` provider ID、现有账号数据和设置。

社区版还对发往服务端的 system/developer 提示词做有限的产品称谓兼容处理，仅替换普通说明文本及已验证的固定 DSH 说明句中的精确称谓。用户、助手和工具消息、工具定义、图片块及文本块元数据保持原样；围栏代码块会跳过处理。普通文本中包含路径分隔符、引号、代码标记或可识别文件扩展名的行也会跳过，唯一额外处理是行首精确匹配已验证的 DSH 固定说明句时替换该句内的称谓，同一行后续内容保持原样。没有任何标记的纯文字文件名无法可靠地与正文区分，建议用反引号标记。这项本地处理不代表官方支持，也不保证上游服务持续可用。

0.1.14 修复上游流中断时桥接层拼接结束标记，导致误报 JSON 错误或将中断误判为成功的问题。该修复不能证明所有上游格式错误都由同一原因造成。

0.1.16 在助手消息旁显示已观测到的单次上游响应积分消耗：仅使用该响应 SSE 中的 `usage.credit`，并通过响应 ID 关联当前 provider、账号、会话与消息。未知消耗不显示，明确返回的 `0` 会显示；不按 token 价格估算，不把工具调用、多次响应或整个会话合计为单条费用。中断、取消或缺少有效完成及积分信息的响应不会生成费用。记录只保存在有容量上限的内存中；账号切换、退出、插件停止或宿主重启会清空，会话卸载也会移除对应记录，因此旧消息费用可能消失。这是尽力展示的观测结果，不是持久账单。缺少宿主会话或 Web 服务时，相关展示会降级。

模型菜单、状态信息与请求准备共享推理能力解析。上游明确声明的可用等级优先于本地探测记录，探测只用于补充验证；国内版 `onlyReasoning` 继续禁止 Off。上游提供的默认等级只有在当前可用集合中才会采用，菜单和请求使用同一个有效默认值；没有有效声明时保留既有默认行为，不新增 `high` 回退。

### 本次改动：模型默认推理档位

对应候选包在已有「上下文窗口」标签页的各模型行增加「默认推理档位」。可选项只来自当前上游声明或已验证的观测等级；不为设置执行额外生成或探测。选择按产品、账号、模型分别保存，本次会话请求中显式选择的档位优先于保存值。清除偏好时选「上游 / 宿主默认」：依次使用仍有效的上游默认值、宿主原有行为，不新增 `high` 回退。切换账号后请等待该账号的模型行刷新，再设置；过期账号写入会被拒绝。

状态字段 `availableEfforts`、`savedDefaultEffort`、`upstreamDefaultEffort` 和 `defaultEffort` 分别表示可选集合、已保存值、上游默认值与当前有效默认值。现有受认证控制接口的 `set-model-default-effort` 操作接收 `{model, account, effort?}`；省略 `effort` 表示重置。不要把账号字段或控制凭据加入共享日志。该操作不发送模型请求；请求准备捕获当时有效默认值，之后修改偏好不改变已经准备的请求。此段描述本次源码改动，不表示已发布 `0.1.17` 含该功能。

## 安装或替换

当前安装基线为正式版 **`0.1.17`**，DSH 声明范围为 **`0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.5 || 0.2.2-rc.1`**，其他 RC 和正式版需要另行验证。0.1.17 的依赖修复见 [发布说明](release-notes-0.1.17.md)；本次源码改动不代表已有新版本发布。0.2.2-rc.1 的隔离宿主测试验证了 provider 注册；真实模型生成尚未验收。插件保留 rc.5 兼容声明，并在模型菜单的“模型”和“推理等级”下方及插件上下文标签页提供上游声明的窗口档位选择。选择按版本、账号和模型保存，直接影响 DSH 的上下文预算；模型不提供档位时不显示选择框。国内 CLI 目录缺少档位时，仅使用当前个人账号最近 24 小时内的桌面产品配置，按模型 ID 和最大输入上限精确匹配；无可验证配置时不展示选项。Windows 国内版已通过只读目录核验，返回 16 个模型，用户已确认 DSH 模型列表显示；真实模型生成及 WorkBuddy AI 国际版的实时请求尚未验收。macOS 和 Linux 尚未进行本分叉的实时验证。按 [验收指南](acceptance.md) 为具体版本、平台和产品补充记录。

**DSH Desktop**：在「扩展 → 插件管理 → 添加插件」中选择下载的 `.tgz` 文件完成安装或更新。Desktop profile 由桌面应用管理；下面的 CLI 示例用于独立 Web profile。安装后先保持社区版禁用，停用原版 `dsh-workbuddy-connect`，再启用社区版；保留原版及配置以便回退。原版与社区版只能启用一份，避免重复注册 provider。

从 [GitHub 正式发布](https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/tag/v0.1.17) 下载并按 DSH 支持的插件安装方式安装独立包：

```sh
dsh plugin --profile web add https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/download/v0.1.17/dsh-workbuddy-connect-community-0.1.17.tgz
```

如原版插件已安装，先保存当前版本和配置，再通过 DSH 支持的方式替换为社区版。原版与社区版不能同时启用；两者使用相同的 provider ID 和账号登录数据。失败时卸载社区版并恢复先前保存的原版。不要删除 WorkBuddy 登录信息或聊天数据。npm 包页面：[0.1.17](https://www.npmjs.com/package/dsh-workbuddy-connect-community/v/0.1.17)。

### 与 ZCode 共存

在 Windows Desktop 上，曾验证社区版与 [`dsh-zcode-plan-bridge`](https://github.com/tangyixiao/dsh-zcode-plan-bridge) 0.4.0 热加载共存：前者使用桌面登录并提供 `workbuddy` / `workbuddy-ai`，后者使用已登录的 CLI 账号并提供 `zcode-cli`；模型选择器可列出三个提供方。这是当时的版本和本机验证，不代表所有版本组合均已验证。`doctor` 和模型目录检查反映本机准备状态；账号计划是否有可用额度，需要实际请求确认。

## 兼容性与限制

### 本次改动：手动保存与选择账号

以下命令属于本次源码改动，需使用对应已构建并安装的候选包；不能据此认为已发布的 `0.1.17` 包包含这些命令。命令默认针对国内版，国际版显式加 `--provider workbuddy-ai`。所有账号操作输出脱敏 JSON，不调用网络；`--json` 可显式标记输出格式。

```sh
dsh-workbuddy-connect-community accounts list --provider workbuddy --json
dsh-workbuddy-connect-community accounts save-current --provider workbuddy
dsh-workbuddy-connect-community accounts select <id> --provider workbuddy
dsh-workbuddy-connect-community accounts follow-desktop --provider workbuddy
```

要保存多个账号，先在对应桌面产品登录账号 A 并 `save-current`，再登录账号 B 并保存，然后从 `list` 的脱敏结果中取 ID 显式 `select`。保存当前有效账号只创建或更新快照，不会自动选中它；若当前已选择保存账号，`save-current` 保存的是该有效账号，应先 `follow-desktop` 再抓取新的桌面登录。选择按产品持久保存，恢复 `follow-desktop` 后沿用原有桌面登录跟随规则。没有自动轮换，也不会修改桌面认证文件。

插件自有账号快照包含凭据，应按凭据文件保护，不能上传或作为验收附件；CLI 输出脱敏不代表该文件已脱敏。已有 `logout` 只移除原有插件刷新副本，不删除保存的账号快照，也不撤销手动选择；退出保存账号选择请用 `accounts follow-desktop`。保存状态损坏或选中记录丢失时拒绝静默回退。跨账号请求、刷新隔离与持久化应按 [验收指南](acceptance.md) 记录。

插件直接复用 WorkBuddy 桌面应用的登录状态与服务接口，模型目录、请求和额度显示依赖第三方服务状态。服务接口可能变化或不可用；社区维护不意味着 WorkBuddy、腾讯或 DeepSeek 的授权或背书。请遵守相关服务条款。

分发包不包含账号凭据、用户会话或运行时数据。凭据来自本机应用、插件的刷新副本；本次改动在用户显式保存后，也可读取插件自有账号快照。

0.1.12 中的国内版与国际版 Web 状态、控制接口均通过 DSH `connection.admit()` 校验宿主登录身份，仅允许 owner 访问。匿名或登录已失效的请求返回 401，其他身份返回 403；控制请求还需通过 Host/Origin 和 `probeKey` 校验。响应禁止缓存；缺少宿主 `connection` 服务时不挂载这些接口，模型提供方和 CLI 仍可用于无 Web 的 profile。此安全修复从 0.1.12 起提供。

## 诊断与可分享报告

以下 `--share` 功能从正式版 0.1.11 起提供，当前已发布的 0.1.17 也包含；0.1.10 包不包含该功能。运行 `dsh-workbuddy-connect-community doctor --share` 可生成可复制的 JSON 诊断报告；国际版使用 `dsh-workbuddy-connect-community doctor --share --provider workbuddy-ai`。该报告只包含版本、运行时、平台、架构、provider、登录文件是否存在及格式、登录状态和已知原因码、主机心跳状态、内置模型数，以及安全的应用版本来源标记。报告不含本地路径、账号标识、进程号、时间戳或自由文本错误。`readiness.authentication` 的 `credential-found` 仅表示凭据可被本地解析，不验证访问令牌是否仍有效，也不尝试刷新；`readiness.liveInference` 固定为 `not-tested`，命令不会发送模型请求。若本地诊断读取失败，命令仍会输出仅含固定 `diagnostic-unavailable` 错误码的 JSON。报告不代表服务可用。

普通 `doctor` 输出仍用于本机排查；已知原因码是稳定枚举，可用于判断下一步。`no-credential` 表示没有可用登录凭据；`encrypted-credential-unreadable` 表示加密凭据无法解锁；`electron-binary-not-found`、`electron-binary-ambiguous`、`electron-binary-unavailable`、`electron-path-invalid` 和 `electron-discovery-incomplete` 分别说明辅助程序未找到、候选不唯一、平台未提供自动发现、指定路径无效或发现流程未完成；`credential-region-mismatch` 表示凭据属于另一个 WorkBuddy 产品。未知原因码不会进入共享报告。

| 平台 | 本项目验证情况 |
| --- | --- |
| Windows | 已有国内目录、模型菜单与特定宿主注册证据；真实生成仍待逐项验收 |
| macOS | 未进行本机实时验证 |
| Linux | 未进行本机实时验证 |

跨平台测试中的 Windows、macOS、Linux 输入是模拟夹具，不代表这些系统上的运行接受验证。诊断结果也不保证 WorkBuddy 服务可用。

参见 [验收步骤与证据模板](acceptance.md) 和 [功能边界与后续路线](roadmap.md)。

## 来源与许可

本仓库保留原项目 Git 历史，维护分叉基于上游提交 [`c0ed88e3712d3bb2e2deff5fddec1181e6222973`](https://github.com/corrinehu/dsh-workbuddy-connect/commit/c0ed88e3712d3bb2e2deff5fddec1181e6222973)。原作者 Corrine Hu 的 MIT 版权声明保留；分叉维护者为 Tang Yixiao。详见 [LICENSE](../LICENSE) 与 [第三方声明](../THIRD_PARTY_NOTICES.txt)。
