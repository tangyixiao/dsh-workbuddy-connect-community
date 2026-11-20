# Maintenance, releases and resources

[WorkBuddy Connect Community](../README.md) adopts the [Tangyixiao Open Source Standard](https://github.com/tangyixiao/.github/blob/main/docs/standard.md) with project-specific choices in [.github/toss.json](../.github/toss.json).

## Maintenance path

- Weekly Dependabot updates are grouped for compatible minor/patch changes and limited to two open PRs per ecosystem. Major updates remain reviewable; no automatic merge or inactivity-based issue closure is configured.
- PR triage reads metadata and changed paths through the GitHub API. It does not check out PR code, run package scripts or access release credentials.
- Existing runtime checks remain separate from the repository/documentation checker. Action references are pinned, test jobs have timeouts and stale checks can cancel. Market deployment retains serialized publication.
- Labels, Discussions, private reporting, topics, security settings and branch rules are platform state. Their source files alone do not prove they are enabled or that a bot has run.

## DSH compatibility / DSH 兼容性

[DSH compatibility](../.github/workflows/dsh-compatibility.yml) checks the packaged plugin against the exact npm versions listed in `engines.dsh` on pull requests. Each Web job uses a disposable profile, installs through the official DSH CLI, checks the provider heartbeat and both signed-out status routes, opens the plugin configuration in Chromium, then removes the plugin and restarts the Host to verify that the routes are gone. The run records the package digest and results. Live WorkBuddy inference requires separate acceptance.

The scheduled run polls GitHub tags and releases, npm and Desktop update feeds every six hours. It reuses passing results for the same source revision and upstream artifact. The Desktop report tracks Windows x64, macOS arm64 and macOS x64 separately by channel, artifact URL and feed digest. Absent feeds and versions outside the declared host range are reported explicitly. Eligible builds run on matching OS runners using the downloaded artifact, a verified SHA-512 digest and the packaged Electron Host. The test starts the actual Host with an isolated Desktop profile, checks the provider and both status routes, disables the plugin and verifies the routes are gone after a restart. PRs cover the stable channel, and scheduled runs cover both stable and nightly.

历史 Web 版本先在 Actions 手动运行中填入完整的 `web_version`。对照 npm 的实际产物和对应 GitHub 标签，使用同一份 Community 候选包重跑。若宿主的兼容门槛拒绝该版本，在候选分支临时将该精确版本加到 `engines.dsh` 和所有 DSH peer 声明，再运行完整检查。通过后才将其纳入支持列表。当前优先补齐 `0.2.2` 的正式 RC；再按使用需求验证 `0.2.1` 的缺口。对更早的宿主，先查可用的旧插件发行包和相应功能，再评估给当前插件增加适配的成本。

Desktop window and updater acceptance uses official installers and a disposable Desktop profile. Exercise both a fresh install and an in-app update from the previous build. In each case install the exact Community archive through Plugin Management, verify both configuration cards, then disable, enable and restart the plugin. For the DSH mode-selector regression, open a new conversation with Coding Tools enabled and disabled, and verify that an existing session preserves its chosen mode. Record the shell and Host versions, OS, architecture, channel, archive digest and outcome for each path. Real model calls are a separate check with an authorized test account.

Desktop 验收应保留安装包、渠道、平台架构和路径（全新安装或应用内升级）的证据。Web 通过可以支持提出 Desktop 验收候选，Desktop 结果以实际 Electron 安装包为准。失败时先确认是插件代码、宿主行为，还是产物或环境问题，再准备对应修复 PR。

## Release and distribution

The actual delivery type is **npm**. Keep stable and preview versions distinct. Before publishing, verify the exact source, tests, package file list, runtime entries, version, license and notices. Then independently verify the registry/Release artifact, hashes, installation and activation where applicable. Do not publish an empty GitHub Package, container or application just to fill a feature.

Use existing release credentials and processes; this baseline does not provision new registry credentials or trusted-publisher access. Generated release-note categories are in [release.yml](../.github/release.yml). Describe upgrade, uninstall and recovery limits in the detailed guide. Restoring source or a version does not necessarily restore account/configuration state.

## Storage and cleanup

Reuse checkouts, dependencies and caches. Keep one task-owned scratch namespace, at least 10 GiB free, a 1 GiB growth review point, a 2 GiB ordinary optional-growth budget, one heavy local job and logs below 20 MiB. Explain a legitimate larger task budget before expansion. These are working agreements, not OS quotas.

Stop task-owned servers/watchers at completion. Check ownership, resolved paths, links, active consumers, ignored needed files and unique commits before removal. Do not delete unrelated work or shared caches. Bound CI diagnostic artifacts (normally 7 days); repository Actions retention is intended to be 14 days. Releases are durable deliverables and are not deleted by that policy.

## Documentation, privacy and project identity

The README is the user entry point; detailed guides preserve operational and compatibility detail. Feature cards describe real workflows and are not screenshots or progress measurements. Stars and Star History are external service-generated data and may be cached or unavailable; ordinary repository links remain usable.

Versioned documentation is authoritative; existing Wiki material is preserved rather than duplicated. Open issues and actual releases are the roadmap/status evidence. Do not create invented percentages, deadlines, sponsor destinations, product endorsements or security certifications. Asset licenses and attribution are separate from the original software license.
