# DSH WorkBuddy Connect Community

[English](./README.en.md) | 中文

由 Tang Yixiao 维护的社区分叉，基于 Corrine Hu 的 MIT 项目 [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect)，保留其原有功能与版权。本项目面向 DeepSeek Harness 0.2.1，复用本机已登录的 WorkBuddy（国内版）或 WorkBuddy AI（国际版），并保留 `workbuddy` / `workbuddy-ai` provider ID、现有账号数据和设置。

社区版还对发往服务端的 system/developer 提示词做有限的产品称谓兼容处理，仅替换普通说明文本及已验证的固定 DSH 说明句中的精确称谓。用户、助手和工具消息、工具定义、图片块及文本块元数据保持原样；围栏代码块会跳过处理。普通文本中包含路径分隔符、引号、代码标记或可识别文件扩展名的行也会跳过，唯一额外处理是行首精确匹配已验证的 DSH 固定说明句时替换该句内的称谓，同一行后续内容保持原样。没有任何标记的纯文字文件名无法可靠地与正文区分，建议用反引号标记。这项本地处理不代表官方支持，也不保证上游服务持续可用。

## 安装或替换

声明范围为 DSH **`0.2.1-rc.2 || 0.2.1-rc.3`**，只包含 rc.2 和 rc.3；后续 RC、正式版及 0.2.2 / 0.3 需要另行验证。v0.1.1 将开发依赖更新到 rc.3，并修复 v0.1.0 精确锁定 rc.2 导致的宿主兼容检查拒绝。版本声明与第三方账号、模型的实时可用性分别验证。Windows 是目前唯一完成本机验证的平台。macOS 和 Linux 尚未进行本分叉的实时验证。

**DSH Desktop**：在「扩展 → 插件管理 → 添加插件」中选择下载的 `.tgz` 文件完成安装或更新。Desktop profile 由桌面应用管理；下面的 CLI 示例用于独立 Web profile。原版与社区版只能启用一份，避免重复注册 provider。

从 [GitHub Releases](https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/latest) 下载并按 DSH 支持的插件安装方式安装独立包：

```sh
dsh plugin --profile web add https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/latest/download/dsh-workbuddy-connect-community.tgz
```

如原版插件已安装，先保存当前版本和配置，再通过 DSH 支持的方式替换为社区版。原版与社区版不能同时启用；两者使用相同的 provider ID 和账号登录数据。失败时卸载社区版并恢复先前保存的原版。不要删除 WorkBuddy 登录信息或聊天数据。首版通过 GitHub Release 分发，暂不发布到 npm。

## 兼容性与限制

插件直接复用 WorkBuddy 桌面应用的登录状态与服务接口，模型目录、请求和额度显示依赖第三方服务状态。服务接口可能变化或不可用；社区维护不意味着 WorkBuddy、腾讯或 DeepSeek 的授权或背书。请遵守相关服务条款。

本软件不包含账号凭据、用户会话或运行时数据。凭据只从本机应用或 DSH 自己保存的凭据副本读取。

## 来源与许可

本仓库保留原项目 Git 历史，维护分叉基于上游提交 [`c0ed88e3712d3bb2e2deff5fddec1181e6222973`](https://github.com/corrinehu/dsh-workbuddy-connect/commit/c0ed88e3712d3bb2e2deff5fddec1181e6222973)。原作者 Corrine Hu 的 MIT 版权声明保留；分叉维护者为 Tang Yixiao。详见 [LICENSE](./LICENSE) 与 [第三方声明](./THIRD_PARTY_NOTICES.txt)。
