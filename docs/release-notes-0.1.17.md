# 0.1.17

Adds an explicit patched Zod runtime dependency (>=4.6.6) and qualifies its actual resolution from the plugin and the OpenAI/Anthropic SDKs loaded by pi-ai. Refreshes the source lock and the Vitest 4.1.12 development patch for the mocker advisories. No package-manager-only override or host app archive patch is used.

The published dependency contract and real profile installations are checked separately: source lock qualification alone does not prove a pre-existing host graph changed. Host-owned app.asar dependencies remain outside this plugin update.

The development lock still contains Zod 4.4.3 from the exact dependencies of DSH 0.2.2-rc.1 host packages (`dsh-client-connection`, `dsh-client-ui-plugin-manager`, and `dsh-llm`). Those host packages need their own upstream update; this release does not claim that the entire host dependency graph or all repository alerts are clear.
