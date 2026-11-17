# 0.1.23 — Context refresh with host admission protection

Combines the context-window fixes from source `7b2f45f2ce403acaabc9bcd4660c8f65ecf390b1` (PR #42) with the HTTP admission hardening in `0.1.22` (PR #43).

- Every registered HTTP route first checks the host's synchronous `connection.requestRejection`, then requires the owner. Missing, throwing, invalid or asynchronous checks deny access before request-body reads or account/runtime work. The update metadata route keeps the same guard before external fetches. Authenticated Desktop forwarding may omit Origin.
- Keep the CLI model roster and its capabilities authoritative. When a CN personal account lacks context tiers and has no fresh matching desktop snapshot, make one best-effort supplementary configuration read with a five-second timeout. Match exact model IDs and input caps; never add desktop-only models. Enterprise and international behavior is preserved.
- Retain the existing CLI identity token for the supplementary read when desktop discovery has no CLI version. Explicit CLI tiers, including a single tier, take precedence. Supplementary failures preserve the original CLI budget.
- Keep the context budget visible as a disabled row with an unavailable hint when alternatives are missing; selectable tiers retain the existing owner/control-key/account checks.

Local source and mocked regression checks do not establish a current upstream model count, live account authentication, host activation or menu appearance. Earlier reports of 16 CN models and the three Flash tiers describe the earlier local fix; this release requires independent publication/installation/runtime verification.

## 中文

合并 PR #42 的上下文档位修复与 PR #43 的宿主 HTTP 准入保护，避免升级安全版本时回退现有上下文功能。所有 HTTP 入口保留宿主同步检查和主人身份要求，准入失败不读请求体、不执行账号或运行时动作；认证后的 Desktop 转发仍可省略 Origin。

CN 个人账号缺少档位且本地快照不新鲜时，以原 CLI 身份补读一次配置，仅按精确模型 ID 和输入上限合并档位。已有 CLI 档位优先；补读失败保留原预算，企业和国际账号行为保持。无法选择其他档位时，菜单仍显示只读上下文预算与原因。

本地源码和模拟回归不能证明当前上游模型数量、真实认证、宿主加载或实际菜单效果。历史 16 个 CN 模型和 Flash 三档记录属于此前本机修复的验收，发布、安装与当前运行分别验证。
