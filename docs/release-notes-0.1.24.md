# 0.1.24 — Account-scope headers on older DSH hosts

Fixes [#46](https://github.com/tangyixiao/dsh-workbuddy-connect-community/issues/46).

- DSH `0.2.1-rc.5` reads `profile.headers` without invoking `prepareHeaders`. Capture `x-workbuddy-account-scope` in each prepared call's profile headers so valid requests pass the local shim's account check on these hosts.
- Retain existing profile headers and the newer host callback. The shared profile stays unchanged, and calls prepared for an account that is no longer selected still fail before forwarding upstream.
- Preserve the context refresh and host HTTP admission protections from `0.1.23`. No credential, account-file or settings migration is required.

Regression coverage exercises both the current callback and a profile-headers-only adapter against the real loopback shim. The published `0.2.1-rc.5` adapter was also checked locally with the development dependency graph: before the fix normal requests were rejected; after the fix they forwarded, while stale account calls remained blocked. This is not a full WSL host or live WorkBuddy inference test.

## 中文

修复 DSH `0.2.1-rc.5` 等旧版宿主不调用 `prepareHeaders` 时，请求缺少账号标记而被本地 shim 误报为 `account_changed` 的问题。将 `x-workbuddy-account-scope` 合并到每次准备请求时捕获的 profile 请求头中，同时保留已有请求头和新版宿主回调。

共享 profile 不变，账号切换前准备的旧请求仍在转发上游前被拒绝。保留 `0.1.23` 的上下文刷新和宿主 HTTP 准入保护，无需迁移凭据、账号文件或设置。

回归测试覆盖新版回调和仅转发 profile 请求头的适配器，并经过真实本地 shim。另使用 rc.5 的实际发布适配器配合开发依赖验证了修复前失败、修复后成功及账号切换保护；这不代表完整 WSL 宿主或真实上游推理已验收。
