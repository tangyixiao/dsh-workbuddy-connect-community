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

### DSH Desktop and ZCode coexistence

The Electron application manages the `desktop` profile; the standalone `dsh` CLI refuses to modify it. In **Extensions → Plugin Management → Add Plugin**, enter the absolute path of the downloaded `.tgz`, or the Release download URL above when the network certificate chain is trusted. Keep the newly installed package disabled, turn off the original `dsh-workbuddy-connect` in the plugin list, and then enable the community package. Retaining the disabled original package and its configuration makes rollback easier.

This flow was verified with hot loading on Windows Desktop. The community package can run alongside [`dsh-zcode-plan-bridge`](https://github.com/tangyixiao/dsh-zcode-plan-bridge) 0.4.0: it provides `workbuddy` / `workbuddy-ai` using desktop sign-in, while the ZCode plugin provides `zcode-cli` using the signed-in CLI account. The model picker can list all three providers. `doctor` and catalog checks establish local readiness; available account-plan quota must be confirmed by an actual request.

## Compatibility and limits

The plugin reuses the desktop app's sign-in and service interfaces. Model catalogs, requests, and credit displays depend on the third-party service, which can change or become unavailable. Community maintenance does not mean authorization or endorsement by WorkBuddy, Tencent, or DeepSeek. Follow the applicable service terms.

The package contains no account credentials, user sessions, or runtime data. Credentials are read from the local app or a credential copy stored by DSH itself.

## Provenance and license

This repository preserves the original Git history and is based on upstream commit [`c0ed88e3712d3bb2e2deff5fddec1181e6222973`](https://github.com/corrinehu/dsh-workbuddy-connect/commit/c0ed88e3712d3bb2e2deff5fddec1181e6222973). Corrine Hu's original MIT copyright notice remains in place; Tang Yixiao maintains this fork. See [LICENSE](./LICENSE) and [third-party notices](./THIRD_PARTY_NOTICES.txt).
