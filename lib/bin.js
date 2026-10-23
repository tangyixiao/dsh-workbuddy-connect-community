#!/usr/bin/env node
import { A as isWorkBuddySignedOutReasonCode, E as variantFor, S as atRestKeyProviderFor, T as WORKBUDDY_VARIANTS, a as isHeartbeatProcessAlive, c as workbuddyHostHeartbeatPath, d as FALLBACK_WORKBUDDY_AI_MODELS, f as FALLBACK_WORKBUDDY_MODELS, g as WorkBuddyCredentialStore, j as WorkBuddyUpstreamClient, n as versionDriftWarning, s as readHostHeartbeat, t as versionDrift, tt as resolveAppVersion, u as WORKBUDDY_CONNECT_VERSION, w as CN_VARIANT } from "./version-resolve-up1drHMy.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/shareable-doctor.ts
/** A copy-safe report built only from explicitly selected, low-risk fields. */
function shareableDoctorReport(input) {
	const reasonCode = isWorkBuddySignedOutReasonCode(input.reasonCode) ? input.reasonCode : void 0;
	const appVersionSource = input.appVersionSource === "installed" || input.appVersionSource === "saved" || input.appVersionSource === "fallback" ? input.appVersionSource : void 0;
	const desktopFormat = [
		"absent",
		"plaintext",
		"encrypted",
		"unrecognized"
	].includes(input.desktopAuthFile.format) ? input.desktopAuthFile.format : "unrecognized";
	const authReadiness = input.signIn === "signed-in" ? "credential-found" : reasonCode !== void 0 || !input.desktopAuthFile.present ? "needs-attention" : "unknown";
	return {
		schemaVersion: 1,
		package: "dsh-workbuddy-connect-community",
		version: input.version,
		runtime: input.runtime,
		platform: input.platform,
		architecture: input.architecture,
		provider: input.provider,
		desktopAuthFile: {
			present: input.desktopAuthFile.present,
			format: desktopFormat
		},
		signIn: input.signIn,
		...reasonCode === void 0 ? {} : { reasonCode },
		hostHeartbeat: {
			present: input.hostHeartbeat.present,
			processAlive: input.hostHeartbeat.processAlive
		},
		fallbackModels: input.fallbackModels,
		...appVersionSource === void 0 ? {} : { appVersionSource },
		readiness: {
			authentication: authReadiness,
			host: input.hostHeartbeat.processAlive ? "running" : input.hostHeartbeat.present ? "stale" : "not-started",
			liveInference: "not-tested"
		}
	};
}
/** Safe fallback when doctor cannot finish reading local diagnostics. */
function shareableDoctorFailureReport(input) {
	return {
		schemaVersion: 1,
		package: "dsh-workbuddy-connect-community",
		version: input.version,
		runtime: input.runtime,
		platform: input.platform,
		architecture: input.architecture,
		provider: input.provider,
		errorCode: "diagnostic-unavailable",
		readiness: {
			authentication: "unknown",
			host: "unknown",
			liveInference: "not-tested"
		}
	};
}
//#endregion
//#region src/bin.ts
/** Standalone status/diagnostics CLI for the dsh-workbuddy-connect-community bundle. */
const JSON_SCHEMA_VERSION = 1;
/** Remove token-like strings from an unexpected diagnostic message. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]");
}
function printHelp() {
	process.stdout.write([
		"Usage: dsh-workbuddy-connect-community <doctor|status|logout> [--provider <id>] [--json]",
		"",
		"  doctor   secret-free sign-in and environment diagnostics",
		"  status   sign-in state, remaining WorkBuddy credit, and host-bundle health",
		"  logout   remove the plugin-owned credential copy (the desktop app keeps its sign-in)",
		"",
		"  --provider  which product to inspect; defaults to workbuddy",
		`              one of: ${WORKBUDDY_VARIANTS.map((variant) => variant.id).join(", ")}`,
		"  --json      emit one secret-free JSON document (doctor/status only)",
		"  --share     emit a copy-safe JSON doctor report (doctor only)",
		""
	].join("\n"));
}
function printJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
/**
* One variant's store plus the client that performs its refreshes.
*
* The key provider is built by the same shared helper the plugin host uses,
* so the CLI's `doctor`/`status` and the browser card can never disagree
* about which product's Electron a variant resolves.
*/
function makeStore(variant) {
	const client = new WorkBuddyUpstreamClient();
	return new WorkBuddyCredentialStore({
		variant,
		refresh: (credential) => client.refreshToken(credential),
		keyProvider: atRestKeyProviderFor(variant)
	});
}
/** The plugin-owned credential copy for one variant, for display. */
function ownAuthPath(variant) {
	return makeStore(variant).ownAuthPath();
}
/** Fallback roster size for one variant. */
function fallbackCount(variant) {
	return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS.length : FALLBACK_WORKBUDDY_AI_MODELS.length;
}
async function doctor(jsonOutput, share, variant) {
	const store = makeStore(variant);
	const status = await store.status();
	const desktopPresent = await store.desktopFilePresent();
	const desktopFormat = await store.desktopAuthFormat();
	const desktopPath = await store.resolvedDesktopAuthPath() ?? store.desktopAuthPath();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const appVersion = variant.region === "global" ? await resolveAppVersion() : void 0;
	const decryptionNote = status.state === "signed-out" && desktopFormat === "encrypted" && status.reason !== void 0 ? `Encrypted desktop credential could not be used: ${status.reason}` : void 0;
	const drift = versionDrift();
	const driftWarning = versionDriftWarning(drift);
	const report = {
		schemaVersion: JSON_SCHEMA_VERSION,
		package: "dsh-workbuddy-connect-community",
		version: WORKBUDDY_CONNECT_VERSION,
		node: process.version,
		provider: variant.id,
		displayName: variant.displayName,
		desktopAuthFile: {
			path: desktopPath ?? `(no platform default; set ${variant.env})`,
			present: desktopPresent,
			format: desktopFormat
		},
		ownAuthFile: ownAuthPath(variant),
		...appVersion === void 0 ? {} : { catalogUserAgent: {
			version: appVersion.version,
			source: appVersion.source,
			...appVersion.bundle === void 0 ? {} : { bundle: appVersion.bundle }
		} },
		hostHeartbeat: {
			path: workbuddyHostHeartbeatPath(),
			present: heartbeat !== void 0,
			...heartbeat === void 0 ? {} : {
				registeredAt: heartbeat.registeredAt,
				pid: heartbeat.pid
			},
			processAlive: hostAlive
		},
		signIn: status.state,
		fallbackModels: fallbackCount(variant),
		...drift === void 0 ? {} : { manifestVersion: drift.manifest },
		hints: [
			...decryptionNote !== void 0 ? [decryptionNote] : status.state === "signed-out" ? [`Sign in once in the ${variant.appName} desktop app, then run status again.`] : [],
			...desktopPresent ? [] : [`No ${variant.appName} desktop auth file at the expected path; set ${variant.env} if it lives elsewhere.`],
			...hostAlive ? [] : ["Host bundle not running in this DSH profile (or the process exited). The browser card and provider are unavailable until DSH starts the plugin."],
			...driftWarning === void 0 ? [] : [driftWarning]
		]
	};
	if (share) printJson(shareableDoctorReport({
		version: WORKBUDDY_CONNECT_VERSION,
		runtime: process.version,
		platform: process.platform,
		architecture: process.arch,
		provider: variant.id,
		desktopAuthFile: {
			present: desktopPresent,
			format: desktopFormat
		},
		signIn: status.state,
		reasonCode: status.reasonCode,
		hostHeartbeat: {
			present: heartbeat !== void 0,
			processAlive: hostAlive
		},
		fallbackModels: fallbackCount(variant),
		...appVersion === void 0 ? {} : { appVersionSource: appVersion.source }
	}));
	else if (jsonOutput) printJson({
		...report,
		...status.reasonCode === void 0 ? {} : { reasonCode: status.reasonCode },
		...decryptionNote === void 0 ? {} : { decryptionNote }
	});
	else process.stdout.write([
		`${variant.displayName} Connect ${WORKBUDDY_CONNECT_VERSION} on ${process.version}`,
		`Desktop auth file: ${report.desktopAuthFile.present ? "present" : "missing"} — ${desktopFormat} (${report.desktopAuthFile.path})`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : heartbeat !== void 0 ? "stale heartbeat (process exited)" : "not started"}`,
		`Sign-in state: ${report.signIn}`,
		...status.reasonCode === void 0 ? [] : [`Sign-in reason code: ${status.reasonCode}`],
		`Static fallback models: ${report.fallbackModels}`,
		...drift === void 0 ? [] : [`Manifest version: ${drift.manifest} (loaded build is ${drift.build})`],
		...appVersion === void 0 ? [] : [`Catalog User-Agent version: ${appVersion.version} (${appVersion.source})`],
		...report.hints.map((hint) => `Hint: ${hint}`),
		""
	].join("\n"));
	return status.state === "signed-in" && desktopPresent ? 0 : 1;
}
async function status(jsonOutput, variant) {
	const store = makeStore(variant);
	const client = new WorkBuddyUpstreamClient();
	const authStatus = await store.status();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const hostState = hostAlive ? "running" : heartbeat !== void 0 ? "stale" : "not-started";
	if (authStatus.state !== "signed-in") {
		if (jsonOutput) printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect-community",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "signed-out",
			...authStatus.reasonCode === void 0 ? {} : { reasonCode: authStatus.reasonCode },
			hostBundle: hostState
		});
		else process.stdout.write(`${variant.displayName} Connect: signed out\nHost bundle: ${hostState}\n`);
		return 1;
	}
	let credits;
	try {
		const credential = await store.current();
		if (credential !== void 0) {
			const fetched = await client.fetchCredits(credential);
			credits = {
				total: fetched.total,
				...fetched.unlimited === true ? { unlimited: true } : {}
			};
		}
	} catch (error) {
		credits = {
			total: 0,
			error: safeMessage(error)
		};
	}
	const expiresAt = authStatus.expiresAtMs !== void 0 ? new Date(authStatus.expiresAtMs).toISOString() : void 0;
	if (jsonOutput) {
		printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect-community",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "signed-in",
			...expiresAt === void 0 ? {} : { accessTokenExpires: expiresAt },
			...authStatus.nickname === void 0 ? {} : { nickname: authStatus.nickname },
			...authStatus.domain === void 0 || authStatus.domain === "" ? {} : { domain: authStatus.domain },
			source: authStatus.source,
			credits: credits?.total,
			...credits?.unlimited === true ? { creditsUnlimited: true } : {},
			...credits?.error === void 0 ? {} : { creditsError: credits.error },
			hostBundle: hostState
		});
		return 0;
	}
	process.stdout.write([
		`${variant.displayName} Connect: signed in${authStatus.nickname === void 0 ? "" : ` as ${authStatus.nickname}`}`,
		...expiresAt === void 0 ? [] : [`Access token expires ${expiresAt} (refresh is automatic)`],
		credits?.error !== void 0 ? `Remaining credit: unavailable (${credits.error})` : credits?.unlimited === true ? "Remaining credit: unlimited" : `Remaining credit: ${credits?.total ?? "unknown"}`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : hostState === "stale" ? "stale heartbeat (DSH process exited)" : "not started in this profile"}`,
		"Client card: load failures are logged to the browser console only; the host provider is unaffected.",
		""
	].join("\n"));
	return 0;
}
/** Execute one boot-free command. */
async function run(argv) {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return 0;
	}
	const [rawAction, ...flags] = argv;
	if (![
		"doctor",
		"logout",
		"status"
	].includes(rawAction)) {
		process.stderr.write(`dsh-workbuddy-connect-community: expected doctor, logout, or status; got ${JSON.stringify(rawAction)}\n`);
		return 1;
	}
	const action = rawAction;
	const jsonOutput = flags.includes("--json");
	const share = flags.includes("--share");
	let providerId;
	const rest = [];
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index];
		if (flag === "--provider") {
			providerId = flags[index + 1];
			index += 1;
			continue;
		}
		if (flag.startsWith("--provider=")) {
			providerId = flag.slice(11);
			continue;
		}
		rest.push(flag);
	}
	const variant = providerId === void 0 ? CN_VARIANT : variantFor(providerId);
	if (variant === void 0) {
		process.stderr.write(`dsh-workbuddy-connect-community: unknown provider ${JSON.stringify(providerId)}; expected one of ${WORKBUDDY_VARIANTS.map((v) => v.id).join(", ")}\n`);
		return 1;
	}
	if (rest.filter((flag) => flag !== "--json" && flag !== "--share").length > 0 || jsonOutput && action === "logout" || share && action !== "doctor") {
		process.stderr.write(`dsh-workbuddy-connect-community: invalid options for ${action}: ${flags.join(" ")}\n`);
		return 1;
	}
	try {
		switch (action) {
			case "doctor": return await doctor(jsonOutput, share, variant);
			case "status": return await status(jsonOutput, variant);
			case "logout": {
				const store = makeStore(variant);
				await store.logout();
				process.stdout.write(`${variant.displayName} Connect: removed ${store.ownAuthPath()}; the desktop app's sign-in is untouched\n`);
				return 0;
			}
		}
	} catch (error) {
		if (action === "doctor" && share) {
			printJson(shareableDoctorFailureReport({
				version: WORKBUDDY_CONNECT_VERSION,
				runtime: process.version,
				platform: process.platform,
				architecture: process.arch,
				provider: variant.id
			}));
			return 1;
		}
		process.stderr.write(`dsh-workbuddy-connect-community: ${action} failed: ${safeMessage(error)}\n`);
		return 1;
	}
}
if (process.argv[1] !== void 0 && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = await run(process.argv.slice(2));
//#endregion
export { run };
