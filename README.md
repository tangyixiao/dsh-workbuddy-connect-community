# DSH WorkBuddy Connect Community

[English](./README.en.md) | 中文

由 Tang Yixiao 维护的社区分叉，基于 Corrine Hu 的 MIT 项目 [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect)，保留其原有功能与版权。本项目面向已验证的 DeepSeek Harness 版本，复用本机已登录的 WorkBuddy（国内版）或 WorkBuddy AI（国际版），并保留 `workbuddy` / `workbuddy-ai` provider ID、现有账号数据和设置。

社区版还对发往服务端的 system/developer 提示词做有限的产品称谓兼容处理，仅替换普通说明文本及已验证的固定 DSH 说明句中的精确称谓。用户、助手和工具消息、工具定义、图片块及文本块元数据保持原样；围栏代码块会跳过处理。普通文本中包含路径分隔符、引号、代码标记或可识别文件扩展名的行也会跳过，唯一额外处理是行首精确匹配已验证的 DSH 固定说明句时替换该句内的称谓，同一行后续内容保持原样。没有任何标记的纯文字文件名无法可靠地与正文区分，建议用反引号标记。这项本地处理不代表官方支持，也不保证上游服务持续可用。

0.1.14 修复上游流中断时桥接层拼接结束标记，导致误报 JSON 错误或将中断误判为成功的问题。该修复不能证明所有上游格式错误都由同一原因造成。

## 安装或替换

正式版 **`0.1.14`** 的 DSH 声明范围为 **`0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.5 || 0.2.2-rc.1`**，其他 RC 和正式版需要另行验证。0.2.2-rc.1 的隔离宿主测试验证了 provider 注册；真实模型生成尚未验收。该版本保留 rc.5 兼容声明，并在模型菜单的“模型”和“推理等级”下方及插件上下文标签页提供上游声明的窗口档位选择。选择按版本、账号和模型保存，直接影响 DSH 的上下文预算；模型不提供档位时不显示选择框。国内 CLI 目录缺少档位时，仅使用当前个人账号最近 24 小时内的桌面产品配置，按模型 ID 和最大输入上限精确匹配；无可验证配置时不展示选项。Windows 国内版已通过只读目录核验，返回 16 个模型，用户已确认 DSH 模型列表显示；真实模型生成及 WorkBuddy AI 国际版的实时请求尚未验收。macOS 和 Linux 尚未进行本分叉的实时验证。

**DSH Desktop**：在「扩展 → 插件管理 → 添加插件」中选择下载的 `.tgz` 文件完成安装或更新。Desktop profile 由桌面应用管理；下面的 CLI 示例用于独立 Web profile。安装后先保持社区版禁用，停用原版 `dsh-workbuddy-connect`，再启用社区版；保留原版及配置以便回退。原版与社区版只能启用一份，避免重复注册 provider。

从 [GitHub 正式发布](https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/tag/v0.1.14) 下载并按 DSH 支持的插件安装方式安装独立包：

```sh
dsh plugin --profile web add https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/download/v0.1.14/dsh-workbuddy-connect-community-0.1.14.tgz
```

如原版插件已安装，先保存当前版本和配置，再通过 DSH 支持的方式替换为社区版。原版与社区版不能同时启用；两者使用相同的 provider ID 和账号登录数据。失败时卸载社区版并恢复先前保存的原版。不要删除 WorkBuddy 登录信息或聊天数据。0.1.14 也已发布到 [npm](https://www.npmjs.com/package/dsh-workbuddy-connect-community/v/0.1.14)。

### 与 ZCode 共存

在 Windows Desktop 上，曾验证社区版与 [`dsh-zcode-plan-bridge`](https://github.com/tangyixiao/dsh-zcode-plan-bridge) 0.4.0 热加载共存：前者使用桌面登录并提供 `workbuddy` / `workbuddy-ai`，后者使用已登录的 CLI 账号并提供 `zcode-cli`；模型选择器可列出三个提供方。这是当时的版本和本机验证，不代表所有版本组合均已验证。`doctor` 和模型目录检查反映本机准备状态；账号计划是否有可用额度，需要实际请求确认。

## 兼容性与限制

插件直接复用 WorkBuddy 桌面应用的登录状态与服务接口，模型目录、请求和额度显示依赖第三方服务状态。服务接口可能变化或不可用；社区维护不意味着 WorkBuddy、腾讯或 DeepSeek 的授权或背书。请遵守相关服务条款。

本软件不包含账号凭据、用户会话或运行时数据。凭据只从本机应用或 DSH 自己保存的凭据副本读取。

0.1.12 中的国内版与国际版 Web 状态、控制接口均通过 DSH `connection.admit()` 校验宿主登录身份，仅允许 owner 访问。匿名或登录已失效的请求返回 401，其他身份返回 403；控制请求还需通过 Host/Origin 和 `probeKey` 校验。响应禁止缓存；缺少宿主 `connection` 服务时不挂载这些接口，模型提供方和 CLI 仍可用于无 Web 的 profile。此安全修复从 0.1.12 起提供。

## 诊断与可分享报告

以下 `--share` 功能包含在 0.1.12 中，0.1.10 包不包含该功能。运行 `dsh-workbuddy-connect-community doctor --share` 可生成可复制的 JSON 诊断报告；国际版使用 `dsh-workbuddy-connect-community doctor --share --provider workbuddy-ai`。该报告只包含版本、运行时、平台、架构、provider、登录文件是否存在及格式、登录状态和已知原因码、主机心跳状态、内置模型数，以及安全的应用版本来源标记。报告不含本地路径、账号标识、进程号、时间戳或自由文本错误。`readiness.authentication` 的 `credential-found` 仅表示凭据可被本地解析，不验证访问令牌是否仍有效，也不尝试刷新；`readiness.liveInference` 固定为 `not-tested`，命令不会发送模型请求。若本地诊断读取失败，命令仍会输出仅含固定 `diagnostic-unavailable` 错误码的 JSON。报告不代表服务可用。

普通 `doctor` 输出仍用于本机排查；已知原因码是稳定枚举，可用于判断下一步。`no-credential` 表示没有可用登录凭据；`encrypted-credential-unreadable` 表示加密凭据无法解锁；`electron-binary-not-found`、`electron-binary-ambiguous`、`electron-binary-unavailable`、`electron-path-invalid` 和 `electron-discovery-incomplete` 分别说明辅助程序未找到、候选不唯一、平台未提供自动发现、指定路径无效或发现流程未完成；`credential-region-mismatch` 表示凭据属于另一个 WorkBuddy 产品。未知原因码不会进入共享报告。

| 平台 | 本项目验证情况 |
| --- | --- |
| Windows | 此前已完成本机接受验证 |
| macOS | 未进行本机实时验证 |
| Linux | 未进行本机实时验证 |

跨平台测试中的 Windows、macOS、Linux 输入是模拟夹具，不代表这些系统上的运行接受验证。诊断结果也不保证 WorkBuddy 服务可用。

## 来源与许可

本仓库保留原项目 Git 历史，维护分叉基于上游提交 [`c0ed88e3712d3bb2e2deff5fddec1181e6222973`](https://github.com/corrinehu/dsh-workbuddy-connect/commit/c0ed88e3712d3bb2e2deff5fddec1181e6222973)。原作者 Corrine Hu 的 MIT 版权声明保留；分叉维护者为 Tang Yixiao。详见 [LICENSE](./LICENSE) 与 [第三方声明](./THIRD_PARTY_NOTICES.txt)。
