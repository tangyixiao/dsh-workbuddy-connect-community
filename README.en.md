# DSH WorkBuddy Connect Community

[中文](./README.md) | English

A community-maintained fork by Tang Yixiao of Corrine Hu's MIT-licensed [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect). It targets DeepSeek Harness 0.2.1-rc.2 and reuses a locally signed-in WorkBuddy (China) or WorkBuddy AI (international) desktop app. The existing `workbuddy` and `workbuddy-ai` provider IDs, account data, and settings are retained.

The community fork also applies a narrow, exact product-name transform to plain system/developer prose and one verified fixed DSH explanatory sentence. User, assistant, and tool messages, tool definitions, image blocks, and text-block metadata remain unchanged. Fenced code blocks are skipped. Ordinary lines containing path separators, quotes, code markers, or recognizable filename extensions are also skipped. The sole additional rule matches the verified complete DSH sentence at the start of a line and changes its product name while preserving the rest of that line. Unmarked plain-word filenames cannot reliably be distinguished from prose; mark these literals with backticks. This local transform does not imply official support or guarantee upstream availability.

## Install or replace

Supported DSH version: **0.2.1-rc.2**. Windows is the only platform verified locally so far. macOS and Linux have not been live-verified for this fork.

Download the package from [GitHub Releases](https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/latest) and install it through a DSH-supported plugin method:

```sh
dsh plugin --profile web add https://github.com/tangyixiao/dsh-workbuddy-connect-community/releases/latest/download/dsh-workbuddy-connect-community.tgz
```

If the original plugin is installed, save its current version and configuration, then replace it through a DSH-supported method. The original and community plugins must not be enabled together: they use the same provider IDs and account login data. If replacement fails, remove the community package and restore the saved original. Do not delete WorkBuddy sign-in data or chat data. The first release is distributed through GitHub Releases; it is not published to npm.

## Compatibility and limits

The plugin reuses the desktop app's sign-in and service interfaces. Model catalogs, requests, and credit displays depend on the third-party service, which can change or become unavailable. Community maintenance does not mean authorization or endorsement by WorkBuddy, Tencent, or DeepSeek. Follow the applicable service terms.

The package contains no account credentials, user sessions, or runtime data. Credentials are read from the local app or a credential copy stored by DSH itself.

## Diagnostics and shareable reports

Run `dsh-workbuddy-connect-community doctor --share` to print copyable JSON. For the international app, use `dsh-workbuddy-connect-community doctor --share --provider workbuddy-ai`. The report is limited to package/runtime/platform/architecture versions, provider, auth-file presence and format, sign-in state and a known reason code, host heartbeat state, fallback model count, and a safe app-version source label. It omits local paths, account identifiers, process IDs, timestamps, and free-text errors. `readiness.authentication: credential-found` means the local credential parsed; it does not validate token freshness or attempt a refresh. `readiness.liveInference` is always `not-tested`: the command sends no model request. If a local diagnostic read fails, the command still prints JSON with only the fixed `diagnostic-unavailable` error code. The report does not establish service availability.

Use ordinary `doctor` output for local troubleshooting. Known reason codes are stable diagnostic categories: `no-credential` means there is no usable sign-in; `encrypted-credential-unreadable` means an encrypted credential could not be opened; `electron-binary-not-found`, `electron-binary-ambiguous`, `electron-binary-unavailable`, `electron-path-invalid`, and `electron-discovery-incomplete` describe a missing or ambiguous helper, unsupported automatic discovery, an invalid configured path, or an incomplete discovery attempt; `credential-region-mismatch` means the credential belongs to the other WorkBuddy product. Unknown reason codes are omitted from the shareable report.

| Platform | Validation evidence |
| --- | --- |
| Windows | Previously accepted in a local run |
| macOS | No live local validation |
| Linux | No live local validation |

Windows, macOS, and Linux inputs in cross-platform tests are simulated fixtures; they do not establish runtime acceptance on those systems. Diagnostics do not guarantee WorkBuddy service availability.

## Provenance and license

This repository preserves the original Git history and is based on upstream commit [`c0ed88e3712d3bb2e2deff5fddec1181e6222973`](https://github.com/corrinehu/dsh-workbuddy-connect/commit/c0ed88e3712d3bb2e2deff5fddec1181e6222973). Corrine Hu's original MIT copyright notice remains in place; Tang Yixiao maintains this fork. See [LICENSE](./LICENSE) and [third-party notices](./THIRD_PARTY_NOTICES.txt).
