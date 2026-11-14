import { A as prepareChatBody, B as chatUserAgent, C as workbuddySavedAccountId, D as modelWithCurrentPromotion, E as extractDisplayErrorMessage, F as PROBE_EFFORT_CANDIDATES, G as atRestKeyProviderFor, H as readCliVersion, I as probeModel, J as WORKBUDDY_VARIANTS, K as AI_VARIANT, L as randomSentinel, M as prepareInternationalChatBody, N as regionOf, O as normalizeCredits, P as upstreamBusinessCode, R as CN_APP_VERSION_FILENAME, S as WorkBuddyAccountError, T as classifyUpstreamError, U as resolveChatIdentity, V as fallbackChatIdentity, W as validCliVersion, X as WORKBUDDY_AI_CREDITS_PATH, Y as variantFor, Z as WORKBUDDY_CREDITS_PATH, _ as defaultDesktopAuthCandidates, a as isHeartbeatProcessAlive, at as readBundleVersion, b as parseWorkBuddyAuth, c as workbuddyHostHeartbeatPath, ct as withFileLock, d as FALLBACK_WORKBUDDY_AI_MODELS, dt as validSavedPromotionMetadata, et as WORKBUDDY_UPDATE_PATH, f as FALLBACK_WORKBUDDY_MODELS, ft as WorkBuddyAvailabilityStore, g as WorkBuddyCredentialStore, h as WORKBUDDY_AUTH_FILE_ENV, i as clearHostHeartbeat, it as installedAppVersion, j as prepareCnChatBody, k as parseModelCatalog, l as writeHostHeartbeat, lt as writeFileAtomic, m as WORKBUDDY_AUTH_FILENAME, nt as WORKBUDDY_APP_VERSION_FILENAME, o as processStartTimeMs, ot as resolveAppVersion, p as WorkBuddyCatalog, q as CN_VARIANT, r as WORKBUDDY_HOST_HEARTBEAT_FILENAME, rt as appUserAgent, s as readHostHeartbeat, st as validAppVersion, t as versionDrift, u as WORKBUDDY_CONNECT_VERSION, ut as promotionFacts, v as defaultDesktopAuthPath, w as WorkBuddyUpstreamClient, x as workbuddyOwnAuthPath, y as desktopAuthCandidatesFor, z as FALLBACK_CN_APP_VERSION } from "./version-resolve-BWvHtrog.js";
import { constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { access, mkdir, open, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { execFile, spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import z from "@deepseek-ai/schemastery";
import { ReasoningEffortId, RetryPolicySchema, resolveImageAttachmentAccess, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
// src/context-window-store.ts
/** Per-variant, per-account context choices. Persist before changing memory. */
var ContextWindowStore = class {
	path;
	accounts = Object.create(null);
	constructor(path) {
		this.path = path;
		try {
			const data = JSON.parse(readFileSync(path, "utf8"));
			if (typeof data !== "object" || data === null || Array.isArray(data)) return;
			for (const [account, value] of Object.entries(data)) {
				if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
				const valid = Object.create(null);
				for (const [model, window] of Object.entries(value)) if (Number.isSafeInteger(window) && window > 0) valid[model] = window;
				this.accounts[account] = valid;
			}
		} catch {}
	}
	get(account) {
		return { ...this.accounts[account] };
	}
	set(account, model, window) {
		const next = {
			...this.accounts,
			[account]: {
				...this.accounts[account],
				[model]: window
			}
		};
		const dir = dirname(this.path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const temp = `${this.path}.tmp`;
		writeFileSync(temp, JSON.stringify(next), { mode: 384 });
		renameSync(temp, this.path);
		this.accounts = next;
	}
};
// src/reasoning-default-store.ts
const EFFORTS$2 = /* @__PURE__ */ new Set([
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
]);
function isWorkBuddyEffort(value) {
	return typeof value === "string" && EFFORTS$2.has(value);
}
/** Per-variant file, per-account/model choices. Durable writes precede memory. */
var ReasoningDefaultStore = class {
	path;
	accounts = Object.create(null);
	constructor(path) {
		this.path = path;
		try {
			const data = JSON.parse(readFileSync(path, "utf8"));
			if (typeof data !== "object" || data === null || Array.isArray(data)) return;
			for (const [account, models] of Object.entries(data)) {
				if (typeof models !== "object" || models === null || Array.isArray(models)) continue;
				const valid = Object.create(null);
				for (const [model, effort] of Object.entries(models)) if (isWorkBuddyEffort(effort)) valid[model] = effort;
				this.accounts[account] = valid;
			}
		} catch {}
	}
	get(account, model) {
		return this.accounts[account]?.[model];
	}
	set(account, model, effort) {
		if (!account.trim() || !model.trim() || effort !== void 0 && !isWorkBuddyEffort(effort)) throw new Error("invalid reasoning default");
		const models = { ...this.accounts[account] };
		if (effort === void 0) delete models[model];
		else models[model] = effort;
		const next = {
			...this.accounts,
			[account]: models
		};
		if (Object.keys(models).length === 0) delete next[account];
		mkdirSync(dirname(this.path), { recursive: true });
		const temp = `${this.path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temp, JSON.stringify(next), {
				mode: 384,
				flag: "wx"
			});
			renameSync(temp, this.path);
		} finally {
			rmSync(temp, { force: true });
		}
		this.accounts = next;
	}
};
// src/efforts.ts
/** Declarations win; only validating observations may fill an undeclared set. */
function resolveEfforts(info, observed, region = "cn") {
	const reasoning = info.reasoning;
	if (reasoning?.supports !== true) return {
		efforts: [],
		off: false,
		probeEligible: false
	};
	if ((reasoning.supportedEfforts?.length ?? 0) > 0) return {
		efforts: reasoning.supportedEfforts,
		source: "declared",
		off: reasoning.canDisableThinking === true && (region !== "cn" || reasoning.onlyReasoning !== true),
		probeEligible: false
	};
	return {
		efforts: observed?.validation === "validating" ? observed.efforts : [],
		...observed?.validation === "validating" && observed.efforts.length > 0 ? { source: "observed" } : {},
		off: false,
		probeEligible: true
	};
}
/** Honor only an upstream default among the offered levels; never invent one. */
function resolveDefaultEffort(info, offered, preferred) {
	if (preferred !== void 0 && offered.includes(preferred)) return preferred;
	const effort = info.reasoning?.defaultEffort;
	return effort !== void 0 && offered.includes(effort) ? effort : void 0;
}
// src/reasoning-control.ts
async function updateModelDefaultEffort(deps, modelId, effort, expectedAccount) {
	const account = await deps.currentAccount();
	if (!account || account !== expectedAccount || account !== deps.activeAccount()) return {
		state: "stale-account",
		reason: "the signed-in account changed"
	};
	const model = deps.models().find((candidate) => candidate.id === modelId);
	if (model === void 0) return {
		state: "failed",
		reason: "the model is not in the current catalog"
	};
	const offered = resolveEfforts(model, deps.observe(modelId), deps.region).efforts;
	if (effort !== void 0 && (!isWorkBuddyEffort(effort) || !offered.includes(effort))) return {
		state: "failed",
		reason: "the model does not offer this reasoning level"
	};
	try {
		deps.store.set(account, modelId, effort);
	} catch {
		return {
			state: "failed",
			reason: "the reasoning preference could not be saved"
		};
	}
	deps.invalidate();
	return { state: "updated" };
}
// src/account-scope.ts
const WORKBUDDY_ACCOUNT_SCOPE_HEADER = "x-workbuddy-account-scope";
/** A routing guard for the loopback hop. Contains no tokens or raw identifiers. */
function workBuddyRequestScope(credential) {
	return createHash("sha256").update(JSON.stringify([
		regionOf(credential.domain),
		credential.uid,
		credential.enterpriseId ?? ""
	])).digest("hex");
}
// src/visibility-store.ts
/**
* Per-account model-visibility preferences: which models the signed-in account
* has hidden from the DSH model picker (issue #36).
*
* A disabled *list*, deliberately not an enabled whitelist: a new account and a
* model the upstream adds both start visible, and an id that temporarily
* disappears from the catalog is kept — when the model returns it stays hidden
* until this account says otherwise. Entries are also kept across sign-outs, so
* returning to an account restores exactly what it left.
*
* One file per variant (the two endpoints share model ids but never
* preferences), keyed by the same `uid:enterpriseId` identity the saved
* catalogs and probe records use. Not a place for secrets: model-id strings
* only, never a token, and never written into the desktop auth file or the
* plugin-owned credential copy — hiding a model is a picker preference, not
* credential state.
*
* Why a plugin-owned file rather than a settings section: the settings sections
* are statically-typed schemastery objects, and `settings.yaml` is account-global
* — a per-uid dynamic map fits neither without weakening the schema or mixing
* one account's preferences into another's config. The saved-catalog and probe
* stores already persist per-account data this way, so this store follows them:
* version-tagged document, atomic write with `0o600`, and a malformed file that
* reads as "nothing saved" rather than throwing.
*
* @module dsh-workbuddy-connect/visibility-store
*/
/** On-disk format this reader accepts; other versions are discarded. */
const VISIBILITY_FORMAT_VERSION = 1;
/** Basename of the CN variant's visibility file inside the Harness home. */
const WORKBUDDY_VISIBILITY_FILENAME = ".workbuddy-model-visibility.json";
/** Plugin-owned visibility-file path inside the Harness home. */
function workbuddyVisibilityPath(filename = WORKBUDDY_VISIBILITY_FILENAME) {
	return join(resolveDshHome(), filename);
}
/** Whether a parsed value is a saved preference entry this reader can trust. */
function isSaved$1(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const entry = value;
	if (typeof entry["account"] !== "string" || entry["account"] === "") return false;
	if (typeof entry["updatedAtMs"] !== "number" || !Number.isFinite(entry["updatedAtMs"])) return false;
	const disabled = entry["disabled"];
	if (!Array.isArray(disabled)) return false;
	return disabled.every((id) => typeof id === "string" && id !== "");
}
/**
* The per-account hidden-model lists, read once and written atomically.
*
* Unlike the saved-catalog store, a failed *write* propagates: the caller
* reports it to the user rather than answering "hidden" for a preference that
* did not persist. Reads stay forgiving — a corrupt or unreadable file is
* "nothing hidden", which only ever shows models the account can still pick.
*/
var WorkBuddyVisibilityStore = class {
	path;
	accounts;
	constructor(options = {}) {
		this.path = typeof options === "string" ? options : options.path ?? workbuddyVisibilityPath();
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.accounts !== void 0) return this.accounts;
		const accounts = {};
		if (existsSync(this.path)) try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8"));
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				const document = parsed;
				const raw = document["version"] === VISIBILITY_FORMAT_VERSION ? document["accounts"] : void 0;
				if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
					for (const [key, value] of Object.entries(raw)) if (isSaved$1(value)) accounts[key] = value;
				}
			}
		} catch {}
		this.accounts = accounts;
		return accounts;
	}
	/** The model ids one account has hidden; empty when it never hid any. */
	disabled(account) {
		return this.load()[account]?.disabled ?? [];
	}
	/**
	* Show or hide one model for one account, persisting before committing.
	*
	* Re-enabling (showing) the last hidden model removes the account's entry
	* entirely — an absent entry and an empty list mean the same thing
	* (everything visible), and the file should not accumulate empty buckets.
	* Throws when the write fails, leaving the in-memory state untouched so a
	* re-read cannot lie about what was persisted.
	*/
	setVisible(account, model, visible) {
		const current = this.load()[account]?.disabled ?? [];
		const next = visible ? current.filter((id) => id !== model) : [.../* @__PURE__ */ new Set([...current, model])];
		const accounts = { ...this.load() };
		if (next.length === 0) delete accounts[account];
		else accounts[account] = {
			account,
			disabled: next,
			updatedAtMs: Date.now()
		};
		this.persist(accounts);
		this.accounts = accounts;
	}
	persist(accounts) {
		const directory = dirname(this.path);
		if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
		const document = {
			version: VISIBILITY_FORMAT_VERSION,
			accounts
		};
		const temporary = resolve(`${this.path}.tmp`);
		writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 384 });
		renameSync(temporary, this.path);
	}
};
// src/toolkit-settings.ts
/** Owner-configured per-provider/account capabilities. Missing settings always disable effects. */
var ToolkitSettingsError = class extends Error {
	code;
	constructor(code) {
		super(code);
		this.code = code;
	}
};
const MAX_BYTES$1 = 1048576;
const MAX_ACCOUNTS = 100;
const EFFORTS$1 = [
	"",
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function record$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keys(value, allowed) {
	return Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.includes(key));
}
function toolkitAccountIdValid(id, region) {
	return typeof id === "string" && new RegExp(`^${region}-[a-f0-9]{32}$`, "u").test(id);
}
function defaultToolkitSettings() {
	return {
		revision: "initial",
		features: {
			images: false,
			videos: false,
			cli: false,
			contextRescue: false
		},
		automation: {
			rotate: false,
			checkin: false,
			members: [],
			maxSwitches: 1
		},
		cli: {
			workspace: "",
			model: "",
			effort: "",
			timeoutMs: 6e4,
			maxTurns: 3
		}
	};
}
function validSettings(value, region) {
	if (!record$3(value) || !keys(value, [
		"revision",
		"features",
		"automation",
		"cli"
	]) || typeof value["revision"] !== "string" || !/^(initial|[a-f0-9-]{36})$/u.test(value["revision"])) return false;
	const features = value["features"];
	const automation = value["automation"];
	const cli = value["cli"];
	if (!record$3(features) || !keys(features, [
		"images",
		"videos",
		"cli",
		"contextRescue"
	]) || ![
		"images",
		"videos",
		"cli",
		"contextRescue"
	].every((key) => typeof features[key] === "boolean")) return false;
	if (!record$3(automation) || !keys(automation, [
		"rotate",
		"checkin",
		"members",
		"maxSwitches"
	]) || typeof automation["rotate"] !== "boolean" || typeof automation["checkin"] !== "boolean" || !Number.isInteger(automation["maxSwitches"]) || automation["maxSwitches"] < 1 || automation["maxSwitches"] > 3 || !Array.isArray(automation["members"]) || automation["members"].length > 16 || !automation["members"].every((id) => toolkitAccountIdValid(id, region)) || new Set(automation["members"]).size !== automation["members"].length) return false;
	if (!record$3(cli) || !keys(cli, [
		"workspace",
		"model",
		"effort",
		"timeoutMs",
		"maxTurns"
	]) || typeof cli["workspace"] !== "string" || cli["workspace"].length > 4096 || /[\u0000-\u001f\u007f]/u.test(cli["workspace"]) || cli["workspace"] !== "" && !isAbsolute(cli["workspace"]) && !win32.isAbsolute(cli["workspace"]) || typeof cli["model"] !== "string" || cli["model"].length > 128 || cli["model"] !== "" && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(cli["model"]) || typeof cli["effort"] !== "string" || !EFFORTS$1.includes(cli["effort"]) || !Number.isInteger(cli["timeoutMs"]) || cli["timeoutMs"] < 1e4 || cli["timeoutMs"] > 3e5 || !Number.isInteger(cli["maxTurns"]) || cli["maxTurns"] < 1 || cli["maxTurns"] > 4) return false;
	return !features["cli"] || cli["workspace"] !== "" && cli["model"] !== "" && cli["effort"] !== "" && cli["effort"] !== "off";
}
/** Reads are authoritative; no enabled in-memory state can outrun the durable commit. */
var ToolkitSettingsStore = class {
	path;
	region;
	constructor(path, region) {
		this.path = path;
		this.region = region;
	}
	account(account) {
		if (!toolkitAccountIdValid(account, this.region)) throw new ToolkitSettingsError("toolkit-account-invalid");
	}
	async read() {
		try {
			const handle = await open(this.path, "r");
			let text;
			try {
				const size = (await handle.stat()).size;
				if (size > MAX_BYTES$1) throw new ToolkitSettingsError("toolkit-state-invalid");
				const bytes = Buffer.alloc(size + 1);
				const read = await handle.read(bytes, 0, bytes.length, 0);
				if (read.bytesRead > size) throw new ToolkitSettingsError("toolkit-state-invalid");
				text = bytes.subarray(0, read.bytesRead).toString("utf8");
			} finally {
				await handle.close();
			}
			const value = JSON.parse(text);
			if (!record$3(value) || !keys(value, [
				"version",
				"region",
				"accounts"
			]) || value["version"] !== 1 || value["region"] !== this.region || !record$3(value["accounts"]) || Object.keys(value["accounts"]).length > MAX_ACCOUNTS || !Object.entries(value["accounts"]).every(([id, settings]) => toolkitAccountIdValid(id, this.region) && validSettings(settings, this.region))) throw new ToolkitSettingsError("toolkit-state-invalid");
			return value;
		} catch (error) {
			if (error?.code === "ENOENT") return {
				version: 1,
				region: this.region,
				accounts: {}
			};
			throw error instanceof ToolkitSettingsError ? error : new ToolkitSettingsError("toolkit-state-invalid");
		}
	}
	async get(account) {
		this.account(account);
		return structuredClone((await this.read()).accounts[account] ?? defaultToolkitSettings());
	}
	async update(account, patch, expectedRevision) {
		this.account(account);
		if (!record$3(patch) || !keys(patch, [
			"features",
			"automation",
			"cli"
		]) || Object.keys(patch).length === 0) throw new ToolkitSettingsError("toolkit-settings-invalid");
		for (const [name, allowed] of [
			["features", [
				"images",
				"videos",
				"cli",
				"contextRescue"
			]],
			["automation", [
				"rotate",
				"checkin",
				"members",
				"maxSwitches"
			]],
			["cli", [
				"workspace",
				"model",
				"effort",
				"timeoutMs",
				"maxTurns"
			]]
		]) {
			const group = patch[name];
			if (Object.hasOwn(patch, name) && (!record$3(group) || !keys(group, [...allowed]))) throw new ToolkitSettingsError("toolkit-settings-invalid");
		}
		try {
			await mkdir(dirname(this.path), {
				recursive: true,
				mode: 448
			});
			return await withFileLock(this.path, async () => {
				const document = await this.read();
				const previous = document.accounts[account] ?? defaultToolkitSettings();
				if (previous.revision !== expectedRevision) throw new ToolkitSettingsError("toolkit-revision-changed");
				const next = {
					revision: randomUUID(),
					features: {
						...previous.features,
						...patch["features"]
					},
					automation: {
						...previous.automation,
						...patch["automation"]
					},
					cli: {
						...previous.cli,
						...patch["cli"]
					}
				};
				if (!validSettings(next, this.region)) throw new ToolkitSettingsError("toolkit-settings-invalid");
				if (document.accounts[account] === void 0 && Object.keys(document.accounts).length >= MAX_ACCOUNTS) throw new ToolkitSettingsError("toolkit-settings-invalid");
				document.accounts[account] = structuredClone(next);
				const text = `${JSON.stringify(document)}\n`;
				if (Buffer.byteLength(text) > MAX_BYTES$1) throw new ToolkitSettingsError("toolkit-settings-invalid");
				await writeFileAtomic(this.path, text, {
					mode: 384,
					dirMode: 448
				});
				return structuredClone(next);
			});
		} catch (error) {
			throw error instanceof ToolkitSettingsError ? error : new ToolkitSettingsError("toolkit-storage-unavailable");
		}
	}
};
// src/account-policy.ts
/** Consent-bound next-request account selection. Never retries or replays a request. */
function tokenScope(credential) {
	return createHash("sha256").update(JSON.stringify([
		credential.uid,
		credential.enterpriseId,
		credential.domain,
		credential.accessToken,
		credential.refreshToken
	])).digest("hex");
}
var WorkBuddyAccountPolicy = class {
	options;
	contextKey = "";
	enabled = false;
	effectiveId;
	primaryAccountId = "";
	effectiveTokenScope = "";
	tried = /* @__PURE__ */ new Set();
	switches = 0;
	pending = false;
	exhausted = false;
	serial = Promise.resolve();
	view;
	constructor(options) {
		this.options = options;
	}
	locked(operation) {
		const result = this.serial.then(operation, operation);
		this.serial = result.then(() => void 0, () => void 0);
		return result;
	}
	reset() {
		this.enabled = false;
		this.effectiveId = void 0;
		this.primaryAccountId = "";
		this.effectiveTokenScope = "";
		this.tried.clear();
		this.switches = 0;
		this.pending = false;
		this.exhausted = false;
	}
	primaryId(credential) {
		return credential.uid.trim() === "" ? "" : this.options.base.accountId(credential);
	}
	async context() {
		const snapshot = await this.options.base.accountSnapshot();
		const primary = snapshot.credential;
		if (primary === void 0) {
			this.contextKey = "";
			this.reset();
			return;
		}
		if (regionOf(primary.domain) !== this.options.region) throw new WorkBuddyAccountError("account-region-mismatch");
		const primaryId = this.primaryId(primary);
		const settings = primaryId === "" ? defaultToolkitSettings() : await this.options.settings(primary);
		const key = JSON.stringify([
			primaryId,
			snapshot.revision,
			snapshot.selectedId,
			snapshot.controlRevision,
			settings.revision
		]);
		if (key !== this.contextKey) {
			this.reset();
			this.contextKey = key;
			this.enabled = primaryId !== "" && settings.automation.rotate;
			this.tried.add(primaryId);
		}
		this.primaryAccountId = primaryId;
		return {
			snapshot,
			primary,
			primaryId,
			settings
		};
	}
	async assertContext(context) {
		const after = await this.options.base.accountSnapshot();
		if (after.revision !== context.snapshot.revision || after.selectedId !== context.snapshot.selectedId || after.controlRevision !== context.snapshot.controlRevision || after.credential === void 0 || this.primaryId(after.credential) !== context.primaryId || context.primaryId !== "" && (await this.options.settings(after.credential)).revision !== context.settings.revision) {
			this.contextKey = "";
			this.reset();
			throw new WorkBuddyAccountError("account-selection-changed");
		}
	}
	async readEffective(context) {
		return this.enabled && this.effectiveId !== void 0 ? await this.options.base.currentSavedAccount(this.effectiveId, context.snapshot) : context.primary;
	}
	/** A status/catalog read does not consume an armed rotation. */
	async current() {
		return await this.locked(async () => {
			const context = await this.context();
			if (context === void 0) return void 0;
			const credential = await this.readEffective(context);
			await this.assertContext(context);
			return credential;
		});
	}
	/** Called before freezing a new independent request's account scope. */
	async beginRequest() {
		return await this.resolve();
	}
	/** Refresh the already chosen account; a prepared in-flight request cannot consume another rotation. */
	async resolveCurrent() {
		return await this.locked(async () => {
			const context = await this.context();
			if (context === void 0) return await this.options.base.resolve();
			const credential = this.enabled && this.effectiveId !== void 0 ? await this.options.base.resolveSavedAccount(this.effectiveId, context.snapshot) : await this.options.base.resolve();
			await this.assertContext(context);
			this.effectiveTokenScope = tokenScope(credential);
			return credential;
		});
	}
	async resolve() {
		return await this.locked(async () => {
			const context = await this.context();
			if (context === void 0) return await this.options.base.resolve();
			if (this.exhausted) throw new Error("account-rotation-exhausted");
			let credential;
			if (this.enabled && this.pending) {
				if (this.switches >= context.settings.automation.maxSwitches) {
					this.exhausted = true;
					throw new Error("account-rotation-exhausted");
				}
				let next;
				for (const id of context.settings.automation.members) {
					if (this.tried.has(id) || id === context.primaryId) continue;
					try {
						const candidate = await this.options.base.currentSavedAccount(id, context.snapshot);
						if (regionOf(candidate.domain) !== this.options.region) continue;
						if (candidate.expiresAtMs <= Date.now() + 3e4 && (candidate.refreshToken === "" || candidate.refreshExpiresAtMs !== void 0 && candidate.refreshExpiresAtMs <= Date.now())) continue;
						next = id;
						break;
					} catch (error) {
						if (error instanceof WorkBuddyAccountError && error.code === "account-not-found") continue;
						throw error;
					}
				}
				if (next === void 0) {
					this.exhausted = true;
					throw new Error("account-rotation-exhausted");
				}
				credential = await this.options.base.resolveSavedAccount(next, context.snapshot);
				await this.assertContext(context);
				this.effectiveId = next;
				this.tried.add(next);
				this.switches += 1;
				this.pending = false;
			} else {
				credential = this.enabled && this.effectiveId !== void 0 ? await this.options.base.resolveSavedAccount(this.effectiveId, context.snapshot) : await this.options.base.resolve();
				await this.assertContext(context);
			}
			this.effectiveTokenScope = tokenScope(credential);
			return credential;
		});
	}
	/** Observations do no I/O and cannot send another request. Old in-flight failures are ignored. */
	observeFailure(kind, credential) {
		if (kind !== "hard_credit" || !this.enabled || this.exhausted || this.effectiveTokenScope === "" || tokenScope(credential) !== this.effectiveTokenScope) return;
		this.pending = true;
	}
	decision() {
		const serving = this.effectiveId ?? this.primaryAccountId;
		return {
			state: !this.enabled ? "disabled" : this.exhausted ? "exhausted" : this.pending ? "pending" : this.effectiveId === void 0 ? "primary" : "serving",
			switches: this.switches,
			...this.enabled && serving !== "" ? { servingAccount: serving } : {}
		};
	}
	async status() {
		try {
			const credential = await this.current();
			if (credential === void 0) return {
				state: "signed-out",
				reasonCode: "no-credential"
			};
			return {
				state: "signed-in",
				expiresAtMs: credential.expiresAtMs,
				source: credential.source,
				...credential.nickname === void 0 ? {} : { nickname: credential.nickname },
				...credential.domain === "" ? {} : { domain: credential.domain },
				...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs }
			};
		} catch {
			return { state: "signed-out" };
		}
	}
	/** Retains base controls/diagnostics; only the effective credential view is overridden. */
	credentialView() {
		if (this.view !== void 0) return this.view;
		const methods = {
			current: this.current.bind(this),
			resolve: this.resolveCurrent.bind(this),
			status: this.status.bind(this)
		};
		this.view = new Proxy(this.options.base, { get(target, property) {
			if (property === "current" || property === "resolve" || property === "status") return methods[property];
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		} });
		return this.view;
	}
};
// src/checkin-admission.ts
/** Durable admission before a non-idempotent check-in write; never schedules or sends requests. */
var CheckinAdmissionError = class extends Error {
	code;
	constructor(code) {
		super(code);
		this.code = code;
	}
};
const DAY_MS = 864e5;
const MAX_BYTES = 1048576;
function record$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validDay(day) {
	return /^\d{4}-\d{2}-\d{2}$/u.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00.000Z`)) && (/* @__PURE__ */ new Date(`${day}T00:00:00.000Z`)).toISOString().slice(0, 10) === day;
}
function validNonce(nonce) {
	return /^[a-zA-Z0-9_-]{16,128}$/u.test(nonce);
}
/** The caller labels HTTP Date UTC boundaries conservatively; they are not a claimed billing timezone. */
var CheckinAdmissionStore = class {
	path;
	region;
	now;
	constructor(path, region, options = {}) {
		this.path = path;
		this.region = region;
		this.now = options.now ?? Date.now;
	}
	key(account, boundary, manual) {
		if (!toolkitAccountIdValid(account, this.region) || !(manual ? validNonce(boundary) : validDay(boundary))) throw new CheckinAdmissionError("checkin-input-invalid");
		return `${account}:${manual ? "manual" : "day"}:${boundary}`;
	}
	async read() {
		try {
			const handle = await open(this.path, "r");
			let text;
			try {
				const size = (await handle.stat()).size;
				if (size > MAX_BYTES) throw new CheckinAdmissionError("checkin-state-invalid");
				const bytes = Buffer.alloc(size + 1);
				const read = await handle.read(bytes, 0, bytes.length, 0);
				if (read.bytesRead > size) throw new CheckinAdmissionError("checkin-state-invalid");
				text = bytes.subarray(0, read.bytesRead).toString("utf8");
			} finally {
				await handle.close();
			}
			const value = JSON.parse(text);
			if (!record$2(value) || value["version"] !== 1 || value["region"] !== this.region || !record$2(value["admissions"]) || Object.keys(value["admissions"]).length > 4096) throw new CheckinAdmissionError("checkin-state-invalid");
			for (const [key, admission] of Object.entries(value["admissions"])) {
				const [account, kind, boundary, extra] = key.split(":");
				if (extra !== void 0 || account === void 0 || boundary === void 0 || !toolkitAccountIdValid(account, this.region) || !(kind === "day" ? validDay(boundary) : kind === "manual" && validNonce(boundary)) || !record$2(admission) || ![
					"unknown",
					"succeeded",
					"failed"
				].includes(admission["outcome"]) || typeof admission["admittedAtMs"] !== "number" || !Number.isSafeInteger(admission["admittedAtMs"]) || admission["admittedAtMs"] < 0) throw new CheckinAdmissionError("checkin-state-invalid");
			}
			return value;
		} catch (error) {
			if (error?.code === "ENOENT") return {
				version: 1,
				region: this.region,
				admissions: {}
			};
			throw error instanceof CheckinAdmissionError ? error : new CheckinAdmissionError("checkin-state-invalid");
		}
	}
	async mutate(operation) {
		try {
			await mkdir(dirname(this.path), {
				recursive: true,
				mode: 448
			});
			return await withFileLock(this.path, async () => {
				const document = await this.read();
				const result = operation(document);
				const text = `${JSON.stringify(document)}\n`;
				if (Buffer.byteLength(text) > MAX_BYTES || Object.keys(document.admissions).length > 4096) throw new CheckinAdmissionError("checkin-state-invalid");
				await writeFileAtomic(this.path, text, {
					mode: 384,
					dirMode: 448
				});
				return result;
			});
		} catch (error) {
			throw error instanceof CheckinAdmissionError ? error : new CheckinAdmissionError("checkin-storage-unavailable");
		}
	}
	async admitKey(account, key) {
		return await this.mutate((document) => {
			if (document.admissions[key] !== void 0) return false;
			const now = this.now();
			if (!Number.isSafeInteger(now) || now < 0) throw new CheckinAdmissionError("checkin-input-invalid");
			if (Object.entries(document.admissions).some(([previousKey, admission]) => previousKey.startsWith(`${account}:`) && now - admission.admittedAtMs < DAY_MS)) return false;
			document.admissions[key] = {
				outcome: "unknown",
				admittedAtMs: now
			};
			return true;
		});
	}
	async admit(account, day) {
		return await this.admitKey(account, this.key(account, day, false));
	}
	async admitManual(account, nonce) {
		return await this.admitKey(account, this.key(account, nonce, true));
	}
	async completeKey(key, outcome) {
		if (![
			"unknown",
			"succeeded",
			"failed"
		].includes(outcome)) throw new CheckinAdmissionError("checkin-input-invalid");
		await this.mutate((document) => {
			const previous = document.admissions[key];
			if (previous === void 0) throw new CheckinAdmissionError("checkin-not-admitted");
			if (previous.outcome !== "succeeded") previous.outcome = outcome;
		});
	}
	async complete(account, day, outcome) {
		await this.completeKey(this.key(account, day, false), outcome);
	}
	async completeManual(account, nonce, outcome) {
		await this.completeKey(this.key(account, nonce, true), outcome);
	}
	async get(account, day) {
		const key = this.key(account, day, false);
		const value = (await this.read()).admissions[key];
		return value === void 0 ? void 0 : { outcome: value.outcome };
	}
	async getManual(account, nonce) {
		const key = this.key(account, nonce, true);
		const value = (await this.read()).admissions[key];
		return value === void 0 ? void 0 : { outcome: value.outcome };
	}
};
// src/host-tools.ts
/** Fixed diagnostics prevent child-process, credential and host internals leaking to tools. */
var ToolkitToolError = class extends Error {
	code;
	constructor(code) {
		super(`workbuddy: ${code}`);
		this.code = code;
	}
};
function toolkitThrowIfCancelled(signal) {
	if (signal.aborted) throw new ToolkitToolError("cancelled");
}
/** Approval is action-specific; a setting enabling a feature is not a grant to execute it. */
async function requireToolkitApproval(approval, execution, toolName, reason) {
	toolkitThrowIfCancelled(execution.signal);
	if (approval === void 0) throw new ToolkitToolError("approval-unavailable");
	let outcome;
	try {
		outcome = await approval.request({
			agent: execution.agent,
			toolName,
			reason,
			signal: execution.signal,
			...execution.callId === void 0 ? {} : { callId: execution.callId }
		});
	} catch {
		toolkitThrowIfCancelled(execution.signal);
		throw new ToolkitToolError("approval-unavailable");
	}
	toolkitThrowIfCancelled(execution.signal);
	if (outcome !== "allowed-once") throw new ToolkitToolError(`approval-${[
		"rejected",
		"cancelled",
		"unavailable"
	].includes(outcome) ? outcome : "unavailable"}`);
}
/** Raw JSON Schema `{}` is the host's supported arbitrary lossless-JSON output contract. */
function toolkitJsonOutput() {
	return {
		schema: {},
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value)
		}]
	};
}
/** Reject unknown keys before any side effect, including direct calls bypassing host validation. */
function toolkitObject(args, allowed, required = []) {
	if (typeof args !== "object" || args === null || Array.isArray(args) || Object.keys(args).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(args, key))) throw new ToolkitToolError("invalid-input");
	return args;
}
/** Transactional optional-host registration; teardown is idempotent and reverse ordered. */
function registerToolkitTools(registry, definitions) {
	const disposers = [];
	const dispose = () => {
		for (const release of disposers.splice(0).reverse()) try {
			release();
		} catch {}
	};
	try {
		for (const definition of definitions) disposers.push(registry.register(definition));
	} catch (error) {
		dispose();
		throw error;
	}
	return dispose;
}
// src/media-client.ts
const REQUEST_KEYS = [
	"kind",
	"mode",
	"prompt",
	"model",
	"images",
	"firstFrame",
	"lastFrame",
	"size",
	"quality",
	"duration",
	"resolution",
	"aspectRatio",
	"negativePrompt",
	"audio"
];
const MAX_IMAGE_BYTES = 20971520;
function invalid() {
	throw new ToolkitToolError("invalid-media-input");
}
function imageInput(value, allowUrl) {
	if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100) return false;
	if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) return true;
	if (!allowUrl || value.length > 8192) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !url.username && !url.password && publicHost(url.hostname);
	} catch {
		return false;
	}
}
function publicHost(host) {
	return !/^(?:localhost|.*\.localhost|.*\.local|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|::)/iu.test(host);
}
/** Reject invalid/unsupported shapes before approval, credential resolution or billing. */
function validateMediaRequest(value) {
	const a = toolkitObject(value, REQUEST_KEYS, [
		"kind",
		"mode",
		"prompt"
	]);
	if (a["mode"] === "reference") throw new ToolkitToolError("media-mode-unsupported");
	if (a["kind"] !== "image" && a["kind"] !== "video") invalid();
	const image = a["kind"] === "image";
	if (image ? !["text", "edit"].includes(String(a["mode"])) : !["text", "frame"].includes(String(a["mode"]))) invalid();
	if (typeof a["prompt"] !== "string" || a["prompt"].length > (image ? 16e3 : 2500) || a["mode"] !== "frame" && a["prompt"].trim() === "") invalid();
	const allowed = image ? [
		"kind",
		"mode",
		"prompt",
		"model",
		"size",
		"quality",
		...a["mode"] === "edit" ? ["images"] : []
	] : [
		"kind",
		"mode",
		"prompt",
		"model",
		"duration",
		"resolution",
		"aspectRatio",
		"negativePrompt",
		"audio",
		...a["mode"] === "frame" ? ["firstFrame", "lastFrame"] : []
	];
	if (Object.keys(a).some((k) => !allowed.includes(k))) invalid();
	for (const key of [
		"model",
		"size",
		"quality",
		"resolution",
		"aspectRatio",
		"negativePrompt"
	]) if (a[key] !== void 0 && (typeof a[key] !== "string" || a[key].length > (key === "negativePrompt" ? 2500 : 128))) invalid();
	if (a["model"] !== void 0 && !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/u.test(String(a["model"]))) invalid();
	if (a["size"] !== void 0 && !/^\d{2,5}x\d{2,5}$/u.test(String(a["size"]))) invalid();
	if (a["duration"] !== void 0 && (typeof a["duration"] !== "number" || !Number.isFinite(a["duration"]) || a["duration"] <= 0 || a["duration"] > 120)) invalid();
	if (a["audio"] !== void 0 && typeof a["audio"] !== "boolean") invalid();
	if (a["aspectRatio"] !== void 0 && ![
		"16:9",
		"9:16",
		"1:1"
	].includes(String(a["aspectRatio"]))) invalid();
	if (a["mode"] === "edit" && (!Array.isArray(a["images"]) || a["images"].length < 1 || a["images"].length > 4 || !a["images"].every((v) => imageInput(v, false)))) invalid();
	if (a["mode"] === "frame" && (!imageInput(a["firstFrame"], true) || a["lastFrame"] !== void 0 && !imageInput(a["lastFrame"], true))) invalid();
	return structuredClone(a);
}
/** Build a billed request only when the account's current official catalog declares its mode. */
function mediaRequestBody(access, request) {
	const mode = request.kind === "image" ? request.mode === "edit" ? "image-to-image" : "text-to-image" : request.mode === "frame" ? "image-to-video" : "text-to-video";
	if (access.model === void 0 || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/u.test(access.model.id) || !Array.isArray(access.model.tags) || !access.model.tags.includes(mode) || request.model !== void 0 && request.model !== access.model.id) throw new ToolkitToolError("media-model-unavailable");
	const model = access.model.id;
	if (request.kind === "image") {
		const body = {
			model,
			prompt: request.prompt,
			size: request.size || "1024x1024"
		};
		if (model.startsWith("hunyuan-")) body["n"] = 1;
		else if (!model.startsWith("gemini-")) {
			body["response_format"] = "b64_json";
			if (request.quality !== void 0) body["quality"] = request.quality;
		}
		if (request.mode === "edit") body["image"] = request.images;
		return body;
	}
	const v = access.model.videoGeneration;
	const resolutions = v?.resolutions ?? ["720P", "1080P"];
	const defaultResolution = v?.defaultResolution ?? "1080P";
	if (v === void 0 || v.defaultSeconds === void 0 || !resolutions.includes(defaultResolution)) throw new ToolkitToolError("media-model-metadata-unavailable");
	const seconds = request.duration ?? v.defaultSeconds;
	if (!Number.isFinite(seconds) || seconds <= 0 || request.duration !== void 0 && (v.minSeconds === void 0 || v.maxSeconds === void 0) || v.minSeconds !== void 0 && seconds < v.minSeconds || v.maxSeconds !== void 0 && seconds > v.maxSeconds) invalid();
	const resolution = request.resolution ?? defaultResolution;
	if (!resolutions.includes(resolution)) invalid();
	return {
		model,
		prompt: request.prompt,
		seconds,
		negative_prompt: request.negativePrompt ?? "",
		watermark: true,
		...request.mode === "frame" ? {
			image_url: request.firstFrame,
			...request.lastFrame === void 0 ? {} : { last_image_url: request.lastFrame }
		} : {},
		extra_parameters: {
			resolution,
			enable_audio: request.audio ?? true,
			...request.mode === "text" ? { aspect_ratio: request.aspectRatio ?? "16:9" } : {}
		}
	};
}
var WorkBuddyMediaClient = class {
	fetcher;
	timeoutMs;
	constructor(options = {}) {
		this.fetcher = options.fetch ?? fetch;
		this.timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 3e4, 6e4));
	}
	async submit(access, request, signal) {
		const valid = validateMediaRequest(request);
		const body = mediaRequestBody(access, valid);
		const path = valid.kind === "video" ? "/v2/videos/generations" : valid.mode === "edit" ? "/v2/images/edits" : "/v2/images/generations";
		const result = await this.post(access, path, body, signal);
		if (valid.kind === "video") {
			if (typeof result["id"] !== "string" || !/^[a-zA-Z0-9_.:-]{1,256}$/u.test(result["id"])) throw new ToolkitToolError("media-outcome-unknown");
			return {
				upstreamTaskId: result["id"],
				status: "pending",
				files: []
			};
		}
		return {
			status: "completed",
			files: filesOf(result["data"])
		};
	}
	/** One request, no polling loop, no submit fallback. */
	async query(access, kind, id, signal) {
		if (kind !== "video") throw new ToolkitToolError("media-query-unsupported");
		if (!/^[a-zA-Z0-9_.:-]{1,256}$/u.test(id)) invalid();
		const result = await this.post(access, "/v2/videos/tasks", { task_id: id }, signal);
		const status = result["status"];
		return {
			status: status === "completed" || status === "failed" ? status : typeof status === "string" ? "pending" : "unknown",
			files: status === "completed" ? filesOf(result["data"]) : []
		};
	}
	async post(access, path, body, signal) {
		toolkitThrowIfCancelled(signal);
		const c = access.credential;
		const base = access.endpoint ?? (regionOf(c.domain) === "global" ? "https://www.workbuddy.ai" : "https://www.workbuddy.cn");
		if (regionOf(c.domain) === "global" ? base !== "https://www.workbuddy.ai" : base !== "https://www.workbuddy.cn" && base !== "https://copilot.tencent.com") throw new ToolkitToolError("media-region-mismatch");
		const timeout = AbortSignal.timeout(this.timeoutMs);
		const active = AbortSignal.any([signal, timeout]);
		let response;
		try {
			response = await abortable(this.fetcher(`${base}${path}`, {
				method: "POST",
				redirect: "error",
				signal: active,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${c.accessToken}`,
					...c.uid ? { "X-User-Id": c.uid } : {},
					...c.enterpriseId ? { "X-Enterprise-Id": c.enterpriseId } : {},
					...c.domain ? { "X-Domain": c.domain } : {}
				},
				body: JSON.stringify(body)
			}), active);
		} catch {
			throw new ToolkitToolError("media-outcome-unknown");
		}
		if (!response.ok) throw new ToolkitToolError("media-outcome-unknown");
		try {
			const reader = response.body?.getReader();
			if (reader === void 0) throw new Error();
			let text = "";
			let bytes = 0;
			const decoder = new TextDecoder();
			try {
				for (;;) {
					const chunk = await abortable(reader.read(), active);
					if (chunk.done) break;
					bytes += chunk.value.byteLength;
					if (bytes > 33554432) throw new Error();
					text += decoder.decode(chunk.value, { stream: true });
				}
				text += decoder.decode();
			} finally {
				reader.cancel().catch(() => {});
			}
			const envelope = JSON.parse(text);
			if (envelope["code"] !== 0) throw new ToolkitToolError("media-upstream-rejected");
			if (typeof envelope["data"] !== "object" || envelope["data"] === null || Array.isArray(envelope["data"])) throw new Error();
			return envelope["data"];
		} catch (e) {
			if (e instanceof ToolkitToolError) throw e;
			throw new ToolkitToolError("media-outcome-unknown");
		}
	}
};
/** Also bounds injected transports/readers that do not implement AbortSignal themselves. */
function abortable(operation, signal) {
	return new Promise((resolve, reject) => {
		const abort = () => reject(new ToolkitToolError("cancelled"));
		if (signal.aborted) {
			operation.catch(() => {});
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)).catch(() => {});
	});
}
function filesOf(raw) {
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) throw new ToolkitToolError("media-outcome-unknown");
	return raw.map((file) => {
		if (typeof file !== "object" || file === null) throw new ToolkitToolError("media-outcome-unknown");
		const f = file;
		if (typeof f["b64_json"] === "string" && f["b64_json"].length > 0 && f["b64_json"].length <= Math.ceil(MAX_IMAGE_BYTES * 4 / 3) && /^[A-Za-z0-9+/]+={0,2}$/u.test(f["b64_json"])) return { base64: f["b64_json"] };
		if (typeof f["url"] === "string" && imageInput(f["url"], true) && f["url"].startsWith("https:")) return { url: f["url"] };
		throw new ToolkitToolError("media-outcome-unknown");
	});
}
// src/checkin-client.ts
/** Exact installed DesktopAccountRepo protocol; injected fetch is the only network boundary. */
var WorkBuddyCheckinClient = class {
	fetcher;
	timeoutMs;
	constructor(options = {}) {
		this.fetcher = options.fetch ?? fetch;
		this.timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 15e3, 3e4));
	}
	async query(access, signal) {
		const { data, day } = await this.post(access, "/v2/billing/meter/checkin-activity-status", signal);
		if (typeof data["active"] !== "boolean" || typeof data["today_checked_in"] !== "boolean") throw new ToolkitToolError("checkin-status-unavailable");
		const status = {
			active: data["active"],
			todayCheckedIn: data["today_checked_in"],
			...day === void 0 ? {} : {
				serverUtcDay: day,
				daySource: "http-date-utc-conservative"
			}
		};
		for (const [wire, key] of [
			["streak_days", "streakDays"],
			["today_credit", "todayCredit"],
			["daily_credit", "dailyCredit"],
			["next_streak_day", "nextStreakDay"]
		]) {
			const number = data[wire];
			if (typeof number === "number" && Number.isFinite(number) && number >= 0) status[key] = number;
		}
		if (typeof data["is_streak_day"] === "boolean") status.isStreakDay = data["is_streak_day"];
		return status;
	}
	async claim(access, signal) {
		if (access.credential.enterpriseId) throw new ToolkitToolError("checkin-personal-only");
		const { data } = await this.post(access, "/v2/billing/meter/daily-checkin", signal);
		const credit = data["credit"];
		if (typeof credit !== "number" || !Number.isFinite(credit) || credit < 0) return { outcome: "unknown" };
		return {
			outcome: "succeeded",
			credit,
			...typeof data["streak_days"] === "number" && Number.isFinite(data["streak_days"]) && data["streak_days"] >= 0 ? { streakDays: data["streak_days"] } : {},
			...typeof data["is_streak_day"] === "boolean" ? { isStreakDay: data["is_streak_day"] } : {}
		};
	}
	async post(access, path, signal) {
		toolkitThrowIfCancelled(signal);
		const c = access.credential;
		const global = regionOf(c.domain) === "global";
		const endpoint = access.endpoint ?? (global ? "https://www.workbuddy.ai" : "https://www.workbuddy.cn");
		if (global ? endpoint !== "https://www.workbuddy.ai" : endpoint !== "https://www.workbuddy.cn" && endpoint !== "https://copilot.tencent.com") throw new ToolkitToolError("checkin-region-mismatch");
		const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
		try {
			const response = await abortable(this.fetcher(`${endpoint}${path}`, {
				method: "POST",
				redirect: "error",
				signal: requestSignal,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${c.accessToken}`,
					...c.uid ? { "X-User-Id": c.uid } : {},
					...c.domain ? { "X-Domain": c.domain } : {},
					...access.deviceToken === void 0 ? {} : { "X-Device-Token": access.deviceToken }
				},
				body: "{}"
			}), requestSignal);
			if (!response.ok) throw new ToolkitToolError("checkin-outcome-unknown");
			const reader = response.body?.getReader();
			if (reader === void 0) throw new ToolkitToolError("checkin-outcome-unknown");
			let text = "";
			const decoder = new TextDecoder();
			try {
				for (;;) {
					requestSignal.throwIfAborted();
					const chunk = await abortable(reader.read(), requestSignal);
					if (chunk.done) break;
					text += decoder.decode(chunk.value, { stream: true });
					if (text.length > 65536) throw new ToolkitToolError("checkin-outcome-unknown");
				}
				text += decoder.decode();
			} finally {
				reader.cancel().catch(() => {});
			}
			const envelope = JSON.parse(text);
			if (envelope["code"] !== 0) throw new ToolkitToolError("checkin-upstream-rejected");
			const raw = envelope["data"] ?? envelope;
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ToolkitToolError("checkin-outcome-unknown");
			const date = response.headers.get("date");
			const stamp = date !== null && /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(date) ? Date.parse(date) : NaN;
			return {
				data: raw,
				...Number.isFinite(stamp) ? { day: new Date(stamp).toISOString().slice(0, 10) } : {}
			};
		} catch (error) {
			if (error instanceof ToolkitToolError) throw error;
			throw new ToolkitToolError("checkin-outcome-unknown");
		}
	}
};
// src/checkin-service.ts
/** Bounded opt-in scheduler; manual action uses the same durable unknown-before-write guard. */
var WorkBuddyCheckinService = class {
	options;
	timer;
	controller = new AbortController();
	disposed = false;
	configurationRevision = 0;
	running;
	claims = /* @__PURE__ */ new Map();
	constructor(options) {
		this.options = options;
	}
	async query(scope, signal) {
		const active = AbortSignal.any([signal, this.controller.signal]);
		const access = await this.access(scope, active);
		return this.options.client.query(access, active);
	}
	/** Owner route must explicitly invoke manual mode with a fresh opaque nonce; no model credentials. */
	async claim(scope, action, signal) {
		if (typeof toolkitObject(action, ["automatic", "nonce"], ["automatic"])["automatic"] !== "boolean" || action.automatic && action.nonce !== void 0 || !action.automatic && (typeof action.nonce !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/u.test(action.nonce))) throw new ToolkitToolError("invalid-checkin-nonce");
		const key = `${scope.region}:${scope.account}`;
		if (this.claims.has(key)) return { outcome: "already-admitted" };
		const operation = this.performClaim(scope, action, signal);
		this.claims.set(key, operation);
		try {
			return await operation;
		} finally {
			this.claims.delete(key);
		}
	}
	async performClaim(scope, action, signal) {
		if (this.disposed) return { outcome: "disabled" };
		const config = await this.options.settings();
		if (action.automatic && !config.enabled) return { outcome: "disabled" };
		if (action.automatic && !config.members.includes(scope.account)) return { outcome: "not-eligible" };
		const active = AbortSignal.any([signal, this.controller.signal]);
		const access = await this.access(scope, active);
		if (access.credential.enterpriseId) return { outcome: "not-eligible" };
		const status = await this.options.client.query(access, active);
		if (!status.active) return { outcome: "not-eligible" };
		if (status.todayCheckedIn) return { outcome: "already-checked-in" };
		if (action.automatic && status.serverUtcDay === void 0) return { outcome: "day-unavailable" };
		const day = status.serverUtcDay;
		const nonce = action.nonce;
		if (!(action.automatic ? await this.options.admission.admit(scope.account, day) : await this.options.admission.admitManual(scope.account, nonce))) return { outcome: "already-admitted" };
		let result = { outcome: "unknown" };
		try {
			toolkitThrowIfCancelled(active);
			const latest = await this.options.settings();
			if (action.automatic && (!latest.enabled || !latest.members.includes(scope.account)) || !await this.options.current(scope)) result = { outcome: "failed" };
			else result = await this.options.client.claim(access, active);
		} catch (error) {
			result = { outcome: error instanceof ToolkitToolError && error.code === "checkin-upstream-rejected" ? "failed" : "unknown" };
		}
		try {
			if (action.automatic) await this.options.admission.complete(scope.account, day, result.outcome);
			else await this.options.admission.completeManual(scope.account, nonce, result.outcome);
		} catch {
			return { outcome: "unknown" };
		}
		return result;
	}
	/** Reconfiguration cancels old timers/in-flight work; when disabled it creates neither timer nor request. */
	async configure() {
		const revision = ++this.configurationRevision;
		if (this.timer !== void 0) {
			clearTimeout(this.timer);
			this.timer = void 0;
		}
		this.controller.abort();
		this.controller = new AbortController();
		if (this.disposed || !(await this.options.settings()).enabled || revision !== this.configurationRevision) return;
		const delay = Math.max(6e4, Math.min(this.options.intervalMs ?? 9e5, 864e5));
		this.timer = setTimeout(() => {
			this.timer = void 0;
			this.tick().catch(() => {}).finally(() => {
				if (!this.disposed) this.configure().catch(() => {});
			});
		}, delay);
		this.timer.unref?.();
	}
	async tick() {
		if (this.running !== void 0) return this.running;
		const run = async () => {
			const signal = this.controller.signal;
			if (this.disposed || !(await this.options.settings()).enabled) return;
			const scopes = (await this.options.scopes()).slice(0, 16);
			for (const scope of scopes) {
				if (this.disposed || signal.aborted || !(await this.options.settings()).enabled) break;
				try {
					await this.claim(scope, { automatic: true }, signal);
				} catch {}
			}
		};
		this.running = run();
		try {
			await this.running;
		} finally {
			this.running = void 0;
		}
	}
	dispose() {
		this.disposed = true;
		if (this.timer !== void 0) clearTimeout(this.timer);
		this.timer = void 0;
		this.controller.abort();
	}
	async access(scope, signal) {
		toolkitThrowIfCancelled(signal);
		if (this.disposed || !await this.options.current(scope)) throw new ToolkitToolError("checkin-account-changed");
		const access = await this.options.resolveAccess(scope, signal);
		toolkitThrowIfCancelled(signal);
		if (!await this.options.current(scope)) throw new ToolkitToolError("checkin-account-changed");
		if (regionOf(access.credential.domain) !== scope.region) throw new ToolkitToolError("checkin-region-mismatch");
		if (workbuddySavedAccountId(scope.region, access.credential) !== scope.account) throw new ToolkitToolError("checkin-account-changed");
		return access;
	}
};
// src/media-task-store.ts
const MAX_TASKS = 256;
const MAX_STATE_BYTES = 2097152;
function sameAccount(a, b) {
	return a.region === b.region && a.account === b.account;
}
function dto(task) {
	return {
		id: task.id,
		kind: task.kind,
		status: task.status,
		files: structuredClone(task.files),
		...task.upstreamTaskId === void 0 ? {} : { upstreamTaskId: task.upstreamTaskId }
	};
}
function validScope(scope) {
	return scope !== null && typeof scope === "object" && ["cn", "global"].includes(scope.region) && toolkitAccountIdValid(scope.account, scope.region) && typeof scope.revision === "string" && scope.revision.length > 0 && scope.revision.length <= 512;
}
/** Durable unknown-before-submit admission. Corruption and exhausted storage fail closed. */
var MediaTaskStore = class {
	path;
	constructor(path) {
		this.path = resolve(path);
	}
	async prepare(scope, operation, kind, requestFingerprint) {
		if (!validScope(scope) || !operation || operation.length > 256 || !["image", "video"].includes(kind) || requestFingerprint !== void 0 && !/^[a-f0-9]{64}$/u.test(requestFingerprint)) throw new ToolkitToolError("invalid-media-scope");
		await mkdir(dirname(this.path), {
			recursive: true,
			mode: 448
		});
		return withFileLock(this.path, async () => {
			const document = await this.read();
			const existing = document.tasks.find((t) => sameAccount(t.scope, scope) && t.operation === operation);
			if (existing !== void 0) {
				if (existing.kind !== kind || existing.requestFingerprint !== requestFingerprint) throw new ToolkitToolError("media-operation-changed");
				return {
					task: dto(existing),
					fresh: false
				};
			}
			if (document.tasks.length >= MAX_TASKS) throw new ToolkitToolError("media-task-capacity");
			const task = {
				id: createHash("sha256").update(JSON.stringify([
					scope.region,
					scope.account,
					operation
				])).digest("hex"),
				kind,
				status: "unknown",
				files: [],
				scope: { ...scope },
				operation,
				...requestFingerprint === void 0 ? {} : { requestFingerprint },
				updatedAtMs: Date.now()
			};
			document.tasks.push(task);
			await this.save(document);
			return {
				task: dto(task),
				fresh: true
			};
		});
	}
	/** Inspect a logical call without reserving an unapproved new operation. */
	async findOperation(scope, operation, kind, requestFingerprint) {
		if (!validScope(scope) || !operation || operation.length > 256 || !/^[a-f0-9]{64}$/u.test(requestFingerprint)) throw new ToolkitToolError("invalid-media-scope");
		const existing = (await this.read()).tasks.find((t) => sameAccount(t.scope, scope) && t.operation === operation);
		if (existing === void 0) return void 0;
		if (existing.kind !== kind || existing.requestFingerprint !== requestFingerprint) throw new ToolkitToolError("media-operation-changed");
		return dto(existing);
	}
	async get(scope, id) {
		if (!validScope(scope) || !/^[a-f0-9]{64}$/u.test(id)) return void 0;
		const found = (await this.read()).tasks.find((t) => t.id === id && sameAccount(scope, t.scope));
		return found === void 0 ? void 0 : dto(found);
	}
	async list(scope) {
		if (!validScope(scope)) return [];
		return (await this.read()).tasks.filter((t) => sameAccount(scope, t.scope)).map(dto);
	}
	async record(scope, id, result) {
		if (!validScope(scope) || ![
			"pending",
			"completed",
			"failed",
			"unknown"
		].includes(result.status) || !Array.isArray(result.files) || result.files.length > 4 || result.upstreamTaskId !== void 0 && !/^[a-zA-Z0-9_.:-]{1,256}$/u.test(result.upstreamTaskId) || result.files.some((f) => typeof f !== "object" || f === null || (f.base64 !== void 0 ? typeof f.base64 !== "string" || f.base64.length > 29360128 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(f.base64) : !validResultUrl(f.url)))) throw new ToolkitToolError("media-state-unavailable");
		return withFileLock(this.path, async () => {
			const document = await this.read();
			const task = document.tasks.find((t) => t.id === id && sameAccount(scope, t.scope));
			if (task === void 0) throw new ToolkitToolError("media-task-not-found");
			if (task.status === "completed" || task.status === "failed") return dto(task);
			const files = [];
			for (const [i, file] of result.files.entries()) if (file.base64 !== void 0) {
				const directory = join(dirname(this.path), "workbuddy-media", id);
				await mkdir(directory, {
					recursive: true,
					mode: 448
				});
				const path = join(directory, `${i}.png`);
				await writeFile(path, Buffer.from(file.base64, "base64"), {
					mode: 384,
					flag: "wx"
				}).catch((error) => {
					if (error.code !== "EEXIST") throw error;
				});
				files.push({ localPath: path });
			} else if (file.url !== void 0) files.push({ url: file.url });
			task.status = result.status;
			task.files = files;
			if (result.upstreamTaskId !== void 0) task.upstreamTaskId = result.upstreamTaskId;
			task.updatedAtMs = Date.now();
			await this.save(document);
			return dto(task);
		});
	}
	async read() {
		let text;
		try {
			const handle = await open(this.path, "r");
			try {
				const size = (await handle.stat()).size;
				if (size > MAX_STATE_BYTES) throw new ToolkitToolError("media-state-unavailable");
				const bytes = Buffer.alloc(size + 1);
				const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
				if (bytesRead > size) throw new ToolkitToolError("media-state-unavailable");
				text = bytes.subarray(0, bytesRead).toString("utf8");
			} finally {
				await handle.close();
			}
		} catch (e) {
			if (e.code === "ENOENT") return {
				version: 1,
				tasks: []
			};
			throw new ToolkitToolError("media-state-unavailable");
		}
		try {
			if (text.length > MAX_STATE_BYTES) throw new Error();
			const d = JSON.parse(text);
			if (d.version !== 1 || !Array.isArray(d.tasks) || d.tasks.length > MAX_TASKS) throw new Error();
			const ids = /* @__PURE__ */ new Set();
			for (const t of d.tasks) {
				if (!t || !validScope(t.scope) || !/^[a-f0-9]{64}$/u.test(t.id) || ids.has(t.id) || typeof t.operation !== "string" || t.operation.length > 256 || !["image", "video"].includes(t.kind) || ![
					"pending",
					"completed",
					"failed",
					"unknown"
				].includes(t.status) || !Array.isArray(t.files) || t.files.length > 4 || t.files.some((f, index) => typeof f !== "object" || f === null || f.base64 !== void 0 || (f.url !== void 0 ? !validResultUrl(f.url) : f.localPath !== join(dirname(this.path), "workbuddy-media", t.id, `${index}.png`))) || t.requestFingerprint !== void 0 && !/^[a-f0-9]{64}$/u.test(t.requestFingerprint) || t.upstreamTaskId !== void 0 && !/^[a-zA-Z0-9_.:-]{1,256}$/u.test(t.upstreamTaskId)) throw new Error();
				ids.add(t.id);
			}
			return d;
		} catch {
			throw new ToolkitToolError("media-state-unavailable");
		}
	}
	async save(document) {
		const text = JSON.stringify(document);
		if (text.length > MAX_STATE_BYTES) throw new ToolkitToolError("media-task-capacity");
		try {
			await writeFileAtomic(this.path, text, {
				mode: 384,
				dirMode: 448
			});
		} catch {
			throw new ToolkitToolError("media-state-unavailable");
		}
	}
};
function validResultUrl(value) {
	if (typeof value !== "string" || value.length > 8192) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname !== "" && !url.username && !url.password;
	} catch {
		return false;
	}
}
// src/media-tools.ts
function sameScope$1(a, b) {
	return b !== void 0 && a.account === b.account && a.region === b.region && a.revision === b.revision;
}
var WorkBuddyMediaService = class {
	options;
	controllers = {
		image: new AbortController(),
		video: new AbortController()
	};
	disposed = false;
	constructor(options) {
		this.options = options;
	}
	/** Disabling or unloading the integration cancels outstanding work without a replacement submission. */
	dispose() {
		this.disposed = true;
		this.cancel();
	}
	/** A settings change may cancel one capability without permanently disabling later explicit actions. */
	cancel(kind) {
		for (const key of kind === void 0 ? ["image", "video"] : [kind]) {
			this.controllers[key].abort();
			this.controllers[key] = new AbortController();
		}
	}
	async submit(kind, args, execution) {
		const request = validateMediaRequest({
			...toolkitObject(args, [
				"mode",
				"prompt",
				"model",
				"images",
				"firstFrame",
				"lastFrame",
				"size",
				"quality",
				"duration",
				"resolution",
				"aspectRatio",
				"negativePrompt",
				"audio"
			], ["mode", "prompt"]),
			kind
		});
		const scope = await this.scope(kind);
		if (!execution.callId || execution.callId.length > 256) throw new ToolkitToolError("media-call-id-unavailable");
		const sessionId = hostSessionId(execution.agent);
		const operation = createHash("sha256").update(JSON.stringify([sessionId, execution.callId])).digest("hex");
		const signal = AbortSignal.any([execution.signal, this.controllers[kind].signal]);
		toolkitThrowIfCancelled(signal);
		const access = await this.options.resolveAccess(scope, request, signal);
		await this.assertCurrent(scope, kind, signal);
		this.assertIdentity(scope, access);
		const body = mediaRequestBody(access, request);
		const requestFingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
		const previous = await this.options.tasks.findOperation(scope, operation, kind, requestFingerprint);
		if (previous !== void 0) return previous;
		const inputCount = request.images?.length ?? (request.firstFrame === void 0 ? 0 : request.lastFrame === void 0 ? 1 : 2);
		const reason = `Provider ${scope.region === "cn" ? "workbuddy" : "workbuddy-ai"}; account ${scope.account}; model ${access.model.id}; ${kind}/${request.mode}; ${inputCount} image inputs; prompt ${JSON.stringify(approvalPrompt(request.prompt))}. This action may consume account credits.`;
		await requireToolkitApproval(this.options.approval, {
			...execution,
			signal
		}, `${this.options.prefix ?? "workbuddy"}_${kind}`, reason);
		await this.assertCurrent(scope, kind, signal);
		this.assertIdentity(scope, access);
		const admission = await this.options.tasks.prepare(scope, operation, kind, requestFingerprint);
		if (!admission.fresh) return admission.task;
		try {
			await this.assertCurrent(scope, kind, signal);
			const result = await this.options.client.submit(access, request, signal);
			return await this.options.tasks.record(scope, admission.task.id, result);
		} catch (error) {
			return this.options.tasks.record(scope, admission.task.id, {
				status: error instanceof ToolkitToolError && error.code === "media-upstream-rejected" ? "failed" : "unknown",
				files: []
			});
		}
	}
	async query(args, execution) {
		const a = toolkitObject(args, ["taskId"], ["taskId"]);
		if (typeof a["taskId"] !== "string" || !/^[a-f0-9]{64}$/u.test(a["taskId"])) throw new ToolkitToolError("invalid-media-task");
		const scope = await this.options.scope();
		if (scope === void 0) throw new ToolkitToolError("media-account-unavailable");
		const task = await this.options.tasks.get(scope, a["taskId"]);
		if (task === void 0) throw new ToolkitToolError("media-task-not-found");
		const signal = AbortSignal.any([execution.signal, this.controllers[task.kind].signal]);
		await this.assertCurrent(scope, task.kind, signal);
		if (task.status === "completed" || task.status === "failed" || task.upstreamTaskId === void 0) return task;
		const access = await this.options.resolveAccess(scope, void 0, signal);
		await this.assertCurrent(scope, task.kind, signal);
		this.assertIdentity(scope, access);
		try {
			const result = await this.options.client.query(access, task.kind, task.upstreamTaskId, signal);
			return await this.options.tasks.record(scope, task.id, result);
		} catch {
			return this.options.tasks.record(scope, task.id, {
				status: "unknown",
				files: []
			});
		}
	}
	async scope(kind) {
		if (this.disposed) throw new ToolkitToolError("media-disabled");
		const scope = await this.options.scope();
		if (scope === void 0) throw new ToolkitToolError("media-account-unavailable");
		if (!await this.options.enabled(kind, scope)) throw new ToolkitToolError("media-disabled");
		return scope;
	}
	assertIdentity(scope, access) {
		if (regionOf(access.credential.domain) !== scope.region) throw new ToolkitToolError("media-region-mismatch");
		if (workbuddySavedAccountId(scope.region, access.credential) !== scope.account) throw new ToolkitToolError("media-account-changed");
	}
	async assertCurrent(scope, kind, signal) {
		toolkitThrowIfCancelled(signal);
		if (this.disposed) throw new ToolkitToolError("media-disabled");
		if (!sameScope$1(scope, await this.options.scope())) throw new ToolkitToolError("media-account-changed");
		if (!await this.options.enabled(kind, scope)) throw new ToolkitToolError("media-disabled");
		toolkitThrowIfCancelled(signal);
	}
};
function approvalPrompt(prompt) {
	return prompt.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/(?:https?:\/\/\S+|[a-z]:[\\/]\S+|(?:^|\s)\/[\w.-]+\/\S*|data:image\/\S+)/giu, "[input]").replace(/(?:Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b[A-Za-z0-9_-]{24,}\b)/gu, "[redacted]").slice(0, 160);
}
function hostSessionId(agent) {
	try {
		if (typeof agent !== "object" || agent === null) throw new Error();
		const session = agent.session;
		if (typeof session !== "object" || session === null) throw new Error();
		const id = session.id;
		if (typeof id !== "string" || id === "" || id.length > 256 || /[\u0000-\u001f\u007f]/u.test(id)) throw new Error();
		return id;
	} catch {
		throw new ToolkitToolError("media-session-unavailable");
	}
}
/** Separate tools keep image/video approvals and activation independent; task lookup cannot submit. */
function createMediaTools(options, service = new WorkBuddyMediaService(options)) {
	const prefix = options.prefix ?? "workbuddy";
	if (!/^[a-z][a-z0-9_]{0,63}$/u.test(prefix)) throw new ToolkitToolError("invalid-tool-prefix");
	const text = { type: "string" };
	const properties = {
		mode: {
			type: "string",
			enum: [
				"text",
				"edit",
				"frame"
			]
		},
		prompt: text,
		model: text,
		images: {
			type: "array",
			items: text,
			minItems: 1,
			maxItems: 4
		},
		firstFrame: text,
		lastFrame: text,
		size: text,
		quality: text,
		duration: {
			type: "number",
			minimum: 1,
			maximum: 120
		},
		resolution: text,
		aspectRatio: {
			type: "string",
			enum: [
				"16:9",
				"9:16",
				"1:1"
			]
		},
		negativePrompt: text,
		audio: { type: "boolean" }
	};
	return [...["image", "video"].map((kind) => ({
		name: `${prefix}_${kind}`,
		description: `Submit one approved ${kind} generation${kind === "image" ? " or edit" : " from text or frames"} using the active account. Disabled by default. May consume credits. Unknown outcomes must be queried; never regenerate because a timeout occurred. Image edits accept bounded image data URIs; frame video accepts HTTPS image URLs or data URIs.`,
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				...properties,
				mode: {
					type: "string",
					enum: kind === "image" ? ["text", "edit"] : ["text", "frame"]
				}
			},
			required: ["mode", "prompt"]
		},
		output: toolkitJsonOutput(),
		execute: (args, execution) => safe(() => service.submit(kind, args, execution))
	})), {
		name: `${prefix}_media_task`,
		description: "Query one previously saved media task for the active account. Makes at most one status request, never submits a new generation.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: { taskId: text },
			required: ["taskId"]
		},
		output: toolkitJsonOutput(),
		execute: (args, execution) => safe(() => service.query(args, execution))
	}];
}
async function safe(operation) {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof ToolkitToolError) throw error;
		throw new ToolkitToolError("media-unavailable");
	}
}
// src/codebuddy-cli.ts
/** Bounded read-only CodeBuddy print process. No shell, fallback, resume or credential arguments. */
const MAX_OUTPUT_BYTES = 1048576;
const MAX_LINE_BYTES = 262144;
const EFFORTS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function validateCodeBuddyConfiguration(configuration) {
	if (![
		configuration.nodeExecutable,
		configuration.cliEntry,
		configuration.workspace
	].every((value) => typeof value === "string" && isAbsolute(value) && !value.includes("\0")) || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(configuration.model) || !EFFORTS.includes(configuration.effort) || !Number.isSafeInteger(configuration.timeoutMs) || configuration.timeoutMs < 100 || configuration.timeoutMs > 3e5 || !Number.isSafeInteger(configuration.maxTurns) || configuration.maxTurns < 1 || configuration.maxTurns > 4) throw new ToolkitToolError("cli-configuration-invalid");
}
function buildCodeBuddyArguments(request) {
	validateCodeBuddyConfiguration(request);
	if (typeof request.prompt !== "string" || request.prompt.trim() === "" || request.prompt.length > 32e3) throw new ToolkitToolError("invalid-input");
	return [
		request.cliEntry,
		"--print",
		"--output-format",
		"stream-json",
		"--verbose",
		"--tools",
		"Read,Glob,Grep",
		"--strict-mcp-config",
		"--mcp-config",
		"{\"mcpServers\":{}}",
		"--setting-sources",
		"",
		"--settings",
		"{\"disableAllHooks\":true}",
		"--no-session-persistence",
		"--max-turns",
		String(request.maxTurns),
		"--model",
		request.model,
		"--effort",
		request.effort,
		"--",
		request.prompt
	];
}
/** Only ordinary OS/home/certificate variables reach the child, never host provider keys. */
function childEnvironment() {
	const allowed = /* @__PURE__ */ new Set([
		"path",
		"pathext",
		"systemroot",
		"windir",
		"comspec",
		"temp",
		"tmp",
		"userprofile",
		"home",
		"appdata",
		"localappdata",
		"programdata",
		"lang",
		"lc_all",
		"node_extra_ca_certs",
		"ssl_cert_file"
	]);
	return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
}
/** Kill this process tree only. The settled close event remains the completion boundary. */
function terminateTree(pid) {
	if (pid === void 0) return;
	if (process.platform === "win32") {
		const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
		execFile(`${systemRoot}\\System32\\taskkill.exe`, [
			"/PID",
			String(pid),
			"/T",
			"/F"
		], {
			windowsHide: true,
			timeout: 5e3
		}, () => {});
	} else try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
}
/** Stream JSON contains only a bounded final result; debug/stderr text is never returned. */
async function runCodeBuddy(request) {
	const args = buildCodeBuddyArguments(request);
	toolkitThrowIfCancelled(request.signal);
	let workspace;
	try {
		const [workspaceInfo, entry] = await Promise.all([stat(request.workspace), stat(request.cliEntry)]);
		if (!workspaceInfo.isDirectory() || !entry.isFile()) throw new Error("invalid path");
		await access(request.nodeExecutable, constants.X_OK);
		workspace = await realpath(request.workspace);
	} catch {
		throw new ToolkitToolError("cli-unavailable");
	}
	toolkitThrowIfCancelled(request.signal);
	return await new Promise((resolve, reject) => {
		const child = spawn(request.nodeExecutable, args, {
			cwd: workspace,
			shell: false,
			windowsHide: true,
			detached: process.platform !== "win32",
			env: childEnvironment(),
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let bytes = 0;
		let pending = "";
		let result;
		let failure;
		let completed = false;
		const stop = (code) => {
			if (failure !== void 0) return;
			failure = code;
			if (!completed) terminateTree(child.pid);
		};
		const timer = setTimeout(() => {
			stop("cli-timeout");
		}, request.timeoutMs);
		const onAbort = () => {
			stop("cancelled");
		};
		request.signal.addEventListener("abort", onAbort, { once: true });
		if (request.signal.aborted) onAbort();
		const parseLine = (line) => {
			if (line.trim() === "") return;
			let value;
			try {
				value = JSON.parse(line);
			} catch {
				stop("cli-invalid-output");
				return;
			}
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				stop("cli-invalid-output");
				return;
			}
			const record = value;
			if (record["type"] !== "result") return;
			if (Array.isArray(record["permission_denials"]) && record["permission_denials"].length > 0) {
				stop("cli-permission-denied");
				return;
			}
			if (result !== void 0 || record["is_error"] !== false || record["subtype"] !== "success" || typeof record["result"] !== "string") {
				stop("cli-failed");
				return;
			}
			const turns = record["num_turns"];
			if (!Number.isSafeInteger(turns) || turns < 0 || turns > 1e5) {
				stop("cli-invalid-output");
				return;
			}
			result = {
				status: "completed",
				text: record["result"],
				turns
			};
		};
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			bytes += Buffer.byteLength(chunk);
			if (bytes > MAX_OUTPUT_BYTES) {
				stop("cli-output-limit");
				return;
			}
			pending += chunk;
			let newline;
			while ((newline = pending.indexOf("\n")) >= 0) {
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
					stop("cli-output-limit");
					return;
				}
				parseLine(line);
			}
			if (Buffer.byteLength(pending) > MAX_LINE_BYTES) stop("cli-output-limit");
		});
		child.stderr.on("data", (chunk) => {
			bytes += chunk.length;
			if (bytes > MAX_OUTPUT_BYTES) stop("cli-output-limit");
		});
		const finish = (code) => {
			if (completed) return;
			completed = true;
			clearTimeout(timer);
			request.signal.removeEventListener("abort", onAbort);
			if (pending.trim() !== "" && failure === void 0) parseLine(pending);
			if (failure !== void 0) reject(new ToolkitToolError(failure));
			else if (code !== 0 || result === void 0) reject(new ToolkitToolError("cli-failed"));
			else resolve(result);
		};
		child.on("error", () => {
			failure ??= "cli-unavailable";
		});
		child.on("close", finish);
	});
}
// src/codebuddy-tools.ts
function createCodeBuddyTools(deps) {
	const prefix = deps.prefix ?? "workbuddy";
	if (!/^workbuddy(?:_(?:cn|ai))?$/u.test(prefix)) throw new ToolkitToolError("tool-prefix-invalid");
	const name = `${prefix}_codebuddy_review`;
	return [{
		name,
		description: "Ask the explicitly configured CodeBuddy model for a bounded workspace review. Only Read/Glob/Grep are available; ordinary CLI permissions still apply. MCP, hooks and modifying tools are disabled. Requires separate host approval for every call and may consume WorkBuddy credit. No filesystem sandbox is implied.",
		parameters: {
			type: "object",
			properties: { prompt: {
				type: "string",
				minLength: 1,
				maxLength: 32e3
			} },
			required: ["prompt"],
			additionalProperties: false
		},
		output: toolkitJsonOutput(),
		execute: async (args, exec) => {
			const input = toolkitObject(args, ["prompt"], ["prompt"]);
			if (typeof input["prompt"] !== "string" || input["prompt"].trim() === "" || input["prompt"].length > 32e3) throw new ToolkitToolError("invalid-input");
			if (!await deps.enabled()) throw new ToolkitToolError("feature-disabled");
			const configuration = { ...await deps.configuration() };
			const signal = deps.lifetime === void 0 ? exec.signal : AbortSignal.any([exec.signal, deps.lifetime]);
			const request = {
				...configuration,
				prompt: input["prompt"],
				signal
			};
			buildCodeBuddyArguments(request);
			await requireToolkitApproval(deps.approval, {
				...exec,
				signal
			}, name, `Run a read-only CodeBuddy review in ${configuration.workspace} using ${configuration.model} (${configuration.effort}), at most ${configuration.maxTurns} turns and ${configuration.timeoutMs} ms. Only Read/Glob/Grep; ordinary CLI permissions apply. May consume CodeBuddy account credit.`);
			if (!await deps.enabled()) throw new ToolkitToolError("feature-disabled");
			if (JSON.stringify(await deps.configuration()) !== JSON.stringify(configuration)) throw new ToolkitToolError("configuration-changed");
			return await (deps.run ?? runCodeBuddy)(request);
		}
	}];
}
// src/toolkit-runtime.ts
function sameScope(a, b) {
	return a?.account === b.account && a.region === b.region && a.revision === b.revision;
}
function executable(name) {
	for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
		if (!dir) continue;
		const file = join(dir.replace(/^"|"$/gu, ""), `${name}${process.platform === "win32" ? ".exe" : ""}`);
		try {
			if (existsSync(file)) return realpathSync(file);
		} catch {}
	}
}
function codeBuddyInstallation() {
	const nodeExecutable = executable("node");
	if (nodeExecutable === void 0) return void 0;
	const candidates = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean).flatMap((dir) => [join(dir, "node_modules/@tencent-ai/codebuddy-code/bin/codebuddy"), join(dir, "../lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy")]);
	for (const file of candidates) try {
		if (existsSync(file)) return {
			nodeExecutable,
			cliEntry: realpathSync(file)
		};
	} catch {}
}
/** One region's owner state and effect services; primary consent and serving identity stay separate. */
var WorkBuddyToolkitRuntime = class {
	base;
	variant;
	client;
	settings;
	policy;
	view;
	media;
	checkin;
	cached;
	owner;
	onChange = () => {};
	key = "";
	refreshRun;
	approval;
	capabilities = {
		tools: false,
		approval: false,
		context: false
	};
	stopped = false;
	lifetime = new AbortController();
	cliLifetime = new AbortController();
	mediaOptions;
	lastCheckin;
	models;
	constructor(base, variant, client) {
		this.base = base;
		this.variant = variant;
		this.client = client;
		const statePath = workbuddyVisibilityPath(`${variant.visibilityFilename}.toolkit`);
		this.settings = new ToolkitSettingsStore(statePath, variant.region);
		this.policy = new WorkBuddyAccountPolicy({
			base,
			region: variant.region,
			settings: (primary) => this.settings.get(base.accountId(primary))
		});
		this.view = this.policy.credentialView();
		const approval = { request: (request) => this.approval?.request(request) ?? Promise.resolve("unavailable") };
		this.mediaOptions = {
			tasks: new MediaTaskStore(`${statePath}.media`),
			client: new WorkBuddyMediaClient(),
			scope: () => this.scope(),
			enabled: async (kind, scope) => sameScope(await this.scope(), scope) && (await this.primary())?.config.features[kind === "image" ? "images" : "videos"] === true,
			resolveAccess: (scope, request, signal) => this.mediaAccess(scope, request, signal),
			approval,
			prefix: variant.region === "cn" ? "workbuddy_cn" : "workbuddy_ai"
		};
		this.media = new WorkBuddyMediaService(this.mediaOptions);
		this.checkin = new WorkBuddyCheckinService({
			client: new WorkBuddyCheckinClient(),
			admission: new CheckinAdmissionStore(`${statePath}.checkin`, variant.region),
			settings: async () => {
				const p = await this.primary();
				return {
					enabled: p?.config.automation.checkin === true,
					members: p?.config.automation.members ?? []
				};
			},
			scopes: async () => {
				const p = await this.primary();
				if (p === void 0) return [];
				return p.config.automation.members.map((account) => ({
					region: variant.region,
					account,
					revision: p.revision
				}));
			},
			current: async (scope) => {
				const p = await this.primary();
				if (p === void 0 || scope.region !== variant.region || p.revision !== scope.revision) return false;
				return (await base.listAccounts()).accounts.some((account) => account.id === scope.account);
			},
			resolveAccess: async (scope, signal) => {
				if (signal.aborted) throw new ToolkitToolError("cancelled");
				const p = await this.primary();
				if (p === void 0 || p.revision !== scope.revision) throw new ToolkitToolError("checkin-account-changed");
				return { credential: await base.resolveSavedAccount(scope.account, p.snapshot) };
			}
		});
	}
	async primary() {
		const snapshot = await this.base.accountSnapshot();
		const credential = snapshot.credential;
		if (credential === void 0 || credential.uid.trim() === "") return void 0;
		const account = this.base.accountId(credential);
		const config = await this.settings.get(account);
		return {
			credential,
			account,
			config,
			snapshot,
			revision: `${account}:${snapshot.revision}:${snapshot.controlRevision}:${config.revision}`
		};
	}
	async scope() {
		const p = await this.primary();
		const credential = await this.policy.current();
		return p === void 0 || credential === void 0 || credential.uid.trim() === "" ? void 0 : {
			region: this.variant.region,
			account: this.base.accountId(credential),
			revision: p.revision
		};
	}
	async refresh() {
		if (this.stopped) return;
		if (this.refreshRun !== void 0) return this.refreshRun;
		const run = async () => {
			const p = await this.primary();
			const key = p?.revision ?? "";
			if (key === this.key) return;
			this.cached = p?.config;
			this.owner = p?.account;
			this.cliLifetime.abort();
			this.cliLifetime = new AbortController();
			this.media.cancel();
			this.onChange();
			await this.checkin.configure();
			this.key = key;
		};
		this.refreshRun = run().finally(() => {
			this.refreshRun = void 0;
		});
		return this.refreshRun;
	}
	attach(capabilities, approval) {
		this.capabilities = capabilities;
		this.approval = approval;
	}
	definitions() {
		if (this.stopped || this.cached === void 0 || !this.capabilities.tools) return [];
		const definitions = createMediaTools(this.mediaOptions, this.media).filter((tool) => tool.name.endsWith("_media_task") ? this.cached.features.images || this.cached.features.videos : tool.name.endsWith("_image") ? this.cached.features.images : this.cached.features.videos);
		if (this.cached.features.cli) definitions.push(...createCodeBuddyTools({
			prefix: this.variant.region === "cn" ? "workbuddy_cn" : "workbuddy_ai",
			enabled: async () => (await this.primary())?.config.features.cli === true,
			configuration: async () => {
				const p = await this.primary();
				const installation = codeBuddyInstallation();
				if (p === void 0 || !p.config.features.cli || installation === void 0) throw new ToolkitToolError("cli-unavailable");
				return {
					...installation,
					...p.config.cli
				};
			},
			approval: { request: (request) => this.approval?.request(request) ?? Promise.resolve("unavailable") },
			lifetime: this.cliLifetime.signal
		}));
		return definitions;
	}
	async mediaAccess(scope, request, signal) {
		if (!sameScope(await this.scope(), scope)) throw new ToolkitToolError("media-account-changed");
		const credential = await this.view.resolve();
		if (!sameScope(await this.scope(), scope)) throw new ToolkitToolError("media-account-changed");
		if (request === void 0) return { credential };
		let rows = this.models?.account === scope.account && Date.now() - this.models.at < 3e5 ? this.models.rows : void 0;
		if (rows === void 0) {
			rows = await this.client.fetchMediaModels(credential, signal);
			this.models = {
				account: scope.account,
				at: Date.now(),
				rows
			};
		}
		const tag = request.kind === "image" ? request.mode === "edit" ? "image-to-image" : "text-to-image" : request.mode === "frame" ? "image-to-video" : "text-to-video";
		const model = rows.find((model) => (request.model === void 0 || model.id === request.model) && model.tags.includes(tag));
		if (model === void 0) throw new ToolkitToolError("media-model-unavailable");
		return {
			credential,
			model
		};
	}
	async state(controlKey) {
		await this.refresh();
		const decision = await this.policy.current().then(() => this.policy.decision(), () => void 0);
		const accounts = await this.base.listAccounts();
		return {
			provider: this.variant.id,
			key: controlKey,
			accounts,
			...this.owner === void 0 ? {} : { account: this.owner },
			...this.cached === void 0 ? {} : { settings: structuredClone(this.cached) },
			capabilities: {
				...this.capabilities,
				cli: codeBuddyInstallation() !== void 0,
				media: true,
				checkin: true
			},
			...decision === void 0 ? {} : { decision },
			...this.lastCheckin === void 0 || this.lastCheckin.owner !== this.owner ? {} : { checkin: this.lastCheckin.value }
		};
	}
	async action(action) {
		if (this.stopped) throw new ToolkitToolError("disposed");
		switch (action.action) {
			case "save-account":
				await this.base.saveCurrentAccount(action.revision);
				break;
			case "select-account":
				await this.base.selectAccount(action.id, action.revision);
				break;
			case "follow-desktop":
				await this.base.followDesktop(action.revision);
				break;
			case "rename-account":
				await this.base.renameAccount(action.id, action.label, action.revision);
				break;
			case "remove-account":
				await this.base.removeAccount(action.id, action.revision);
				break;
			case "update-settings": {
				const p = await this.primary();
				if (p === void 0 || p.account !== action.account) throw Object.assign(/* @__PURE__ */ new Error("stale-state"), { code: "account-selection-changed" });
				if ((action.patch.features?.images || action.patch.features?.videos || action.patch.features?.cli) && (!this.capabilities.tools || !this.capabilities.approval)) throw new ToolkitToolError("toolkit-host-unavailable");
				if (action.patch.features?.contextRescue && !this.capabilities.context) throw new ToolkitToolError("rescue-host-unavailable");
				const saved = await this.base.listAccounts();
				if (action.patch.automation?.members?.some((id) => !saved.accounts.some((account) => account.id === id))) throw new ToolkitToolError("account-not-found");
				await withFileLock(`${this.base.ownAuthPath()}.accounts.json`, async () => {
					const latest = await this.primary();
					if (latest === void 0 || latest.account !== p.account || latest.revision !== p.revision) throw Object.assign(/* @__PURE__ */ new Error("stale-state"), { code: "account-selection-changed" });
					await this.settings.update(p.account, action.patch, action.revision);
				});
				break;
			}
			case "checkin": {
				const accounts = await this.base.listAccounts();
				const p = await this.primary();
				if (accounts.revision !== action.revision || p === void 0 || p.account !== action.account || p.snapshot.controlRevision !== action.revision || !accounts.accounts.some((account) => account.id === action.id)) throw Object.assign(/* @__PURE__ */ new Error("stale-state"), { code: "account-selection-changed" });
				const result = await this.checkin.claim({
					region: this.variant.region,
					account: action.id,
					revision: p.revision
				}, {
					automatic: false,
					nonce: randomUUID()
				}, this.lifetime.signal);
				this.lastCheckin = {
					owner: p.account,
					value: {
						state: result.outcome,
						..."credit" in result && result.credit !== void 0 ? { credits: result.credit } : {}
					}
				};
				break;
			}
		}
		await this.refresh();
		return { state: "updated" };
	}
	dispose() {
		this.stopped = true;
		this.lifetime.abort();
		this.cliLifetime.abort();
		this.media.dispose();
		this.checkin.dispose();
	}
};
// src/context-rescue.ts
/** Preview/export before an explicit idle-session command; no model-triggered compaction. */
const MAX_EXPORT_BYTES = 4194304;
const MAX_EXPORTS = 20;
const PREVIEW_TTL_MS = 9e5;
const EXPORT_PREFIX = "workbuddy-rescue-";
var ContextRescueService = class {
	deps;
	previews = /* @__PURE__ */ new Map();
	lifecycle = new AbortController();
	stopped = false;
	previewBusy = false;
	constructor(deps) {
		this.deps = deps;
	}
	async admitted(signal) {
		if (this.stopped) throw new ToolkitToolError("disposed");
		toolkitThrowIfCancelled(signal);
		if (!await this.deps.enabled()) throw new ToolkitToolError("feature-disabled");
		toolkitThrowIfCancelled(signal);
		if (this.stopped) throw new ToolkitToolError("disposed");
	}
	async preview(agent, signal) {
		if (this.previewBusy) throw new ToolkitToolError("rescue-preview-busy");
		this.previewBusy = true;
		try {
			return await this.exportPreview(agent, AbortSignal.any([signal, this.lifecycle.signal]));
		} finally {
			this.previewBusy = false;
		}
	}
	async exportPreview(agent, signal) {
		await this.admitted(signal);
		const snapshot = { ...await this.deps.readSnapshot(agent, signal) };
		await this.admitted(signal);
		if (typeof snapshot.sessionId !== "string" || snapshot.sessionId.length === 0 || snapshot.sessionId.length > 256 || typeof snapshot.revision !== "string" || snapshot.revision.length === 0 || snapshot.revision.length > 512 || !Array.isArray(snapshot.events) || snapshot.events.length > 2e4 || !Array.isArray(snapshot.surfaceNodes) || snapshot.surfaceNodes.some((seq) => !Number.isSafeInteger(seq) || seq < 0)) throw new ToolkitToolError("rescue-snapshot-invalid");
		let text;
		if (snapshot.summaryTarget !== void 0 && (!["workbuddy", "workbuddy-ai"].includes(snapshot.summaryTarget.provider) || typeof snapshot.summaryTarget.model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(snapshot.summaryTarget.model))) throw new ToolkitToolError("rescue-snapshot-invalid");
		if (snapshot.servingAccount !== void 0 && !/^(cn|global)-[a-f0-9]{32}$/u.test(snapshot.servingAccount)) throw new ToolkitToolError("rescue-snapshot-invalid");
		try {
			text = JSON.stringify({
				version: 1,
				sessionId: snapshot.sessionId,
				revision: snapshot.revision,
				events: snapshot.events,
				surfaceNodes: snapshot.surfaceNodes,
				...snapshot.summaryTarget === void 0 ? {} : { summaryTarget: snapshot.summaryTarget },
				...snapshot.servingAccount === void 0 ? {} : { servingAccount: snapshot.servingAccount }
			});
		} catch {
			throw new ToolkitToolError("rescue-snapshot-invalid");
		}
		const bytes = Buffer.byteLength(text);
		if (bytes > MAX_EXPORT_BYTES) throw new ToolkitToolError("rescue-export-limit");
		const id = randomBytes(16).toString("hex");
		const file = `${EXPORT_PREFIX}${id}.json`;
		try {
			if (!isAbsolute(this.deps.exportDirectory)) throw new Error("invalid directory");
			await mkdir(this.deps.exportDirectory, {
				recursive: true,
				mode: 448
			});
			const directory = await realpath(this.deps.exportDirectory);
			if ((await readdir(directory)).filter((name) => name.startsWith(EXPORT_PREFIX) && name.endsWith(".json")).length >= MAX_EXPORTS) throw new ToolkitToolError("rescue-export-limit");
			const handle = await open(join(directory, file), "wx", 384);
			try {
				await handle.writeFile(text, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
		} catch (error) {
			throw error instanceof ToolkitToolError ? error : new ToolkitToolError("rescue-export-failed");
		}
		await this.admitted(signal);
		const preview = {
			id,
			revision: snapshot.revision,
			sessionId: snapshot.sessionId,
			exportFile: file,
			exportedBytes: bytes,
			surfaceItems: snapshot.surfaceNodes.length,
			...typeof snapshot.estimatedTokens === "number" && Number.isFinite(snapshot.estimatedTokens) && snapshot.estimatedTokens >= 0 ? { estimatedTokens: snapshot.estimatedTokens } : {},
			...snapshot.summaryTarget === void 0 ? {} : { summaryTarget: { ...snapshot.summaryTarget } },
			...snapshot.servingAccount === void 0 ? {} : { servingAccount: snapshot.servingAccount },
			summaryText: "Generated by the host only after explicit apply; exact retained text cannot be previewed."
		};
		const now = (this.deps.now ?? Date.now)();
		for (const [key, record] of this.previews) if (record.expiresAt <= now) this.previews.delete(key);
		if (this.previews.size >= MAX_EXPORTS) throw new ToolkitToolError("rescue-preview-limit");
		this.previews.set(id, {
			preview,
			snapshot,
			expiresAt: now + PREVIEW_TTL_MS
		});
		return { ...preview };
	}
	/** Called only by the explicitly invoked human command, never from a model tool. */
	async apply(agent, id, revision, signal) {
		signal = AbortSignal.any([signal, this.lifecycle.signal]);
		await this.admitted(signal);
		const pending = this.previews.get(id);
		if (pending === void 0 || pending.expiresAt <= (this.deps.now ?? Date.now)()) {
			this.previews.delete(id);
			throw new ToolkitToolError("rescue-preview-unavailable");
		}
		if (revision !== pending.preview.revision) throw new ToolkitToolError("rescue-preview-changed");
		const current = await this.deps.readSnapshot(agent, signal);
		await this.admitted(signal);
		if (!current.idle) throw new ToolkitToolError("rescue-session-busy");
		if (current.sessionId !== pending.snapshot.sessionId || current.revision !== pending.snapshot.revision) throw new ToolkitToolError("rescue-preview-changed");
		if (this.previews.get(id) !== pending) throw new ToolkitToolError("rescue-preview-unavailable");
		this.previews.delete(id);
		let result;
		try {
			result = await this.deps.compact(agent, signal, current);
		} catch {
			toolkitThrowIfCancelled(signal);
			throw new ToolkitToolError("rescue-apply-failed-inspect-session");
		}
		return { status: result === null ? "unchanged" : "applied" };
	}
	dispose() {
		this.stopped = true;
		this.previews.clear();
		this.lifecycle.abort();
	}
};
function createContextRescueTools(deps) {
	return [{
		name: "workbuddy_context_preview",
		description: "Export the current session locally and preview context-rescue scope. Does not compact or resend requests. Apply only through the explicit human /workbuddy-rescue apply command while idle.",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		output: toolkitJsonOutput(),
		execute: async (args, execution) => {
			toolkitObject(args, []);
			return await deps.service.preview(execution.agent, execution.signal);
		}
	}];
}
// src/context-rescue-command.ts
/** Human command consent is explicit. Host approval.request cannot audit outside an open turn. */
function registerContextRescueCommand(registry, service) {
	return registry.register({
		name: "workbuddy-rescue",
		description: "Preview/export context, then explicitly compact the same idle session revision",
		handler: async (invocation) => {
			const operands = invocation.rawInput.trim().split(/\s+/u);
			try {
				if (operands.length === 1 && operands[0] === "preview") {
					const preview = await service.preview(invocation.agent, invocation.signal);
					const target = preview.summaryTarget === void 0 ? "" : `\nSummary target: ${preview.summaryTarget.provider}/${preview.summaryTarget.model}. Applying may consume this account's credits.`;
					return {
						kind: "success",
						text: `${JSON.stringify(preview)}${target}\nInspect the retained original export. To authorize host compaction of this revision: /workbuddy-rescue apply ${preview.id} ${preview.revision}`
					};
				}
				if (operands.length === 3 && operands[0] === "apply" && /^[a-f0-9]{32}$/u.test(operands[1]) && /^[A-Za-z0-9._:-]{1,512}$/u.test(operands[2])) return {
					kind: "success",
					text: (await service.apply(invocation.agent, operands[1], operands[2], invocation.signal)).status === "unchanged" ? "No safely compactable history. Original export retained." : "Host compaction completed. Original export retained. No conversation request was resent."
				};
				return {
					kind: "error",
					text: "Usage: /workbuddy-rescue preview | /workbuddy-rescue apply <preview-id> <revision>"
				};
			} catch (error) {
				return {
					kind: "error",
					text: error instanceof ToolkitToolError ? error.message : "workbuddy: rescue-unavailable"
				};
			}
		}
	});
}
// src/context-host.ts
function agentPort(value) {
	const agent = value;
	if (agent === null || typeof agent !== "object" || typeof agent.session?.id !== "string" || !agent.session.surface || !Array.isArray(agent.session.surface.nodes) || !agent.session.surface.nodes.every((seq) => Number.isSafeInteger(seq) && seq >= 0) || new Set(agent.session.surface.nodes).size !== agent.session.surface.nodes.length || !Number.isSafeInteger(agent.session.surface.contentGeneration) || agent.session.surface.contentGeneration < 0 || !Number.isSafeInteger(agent.session.surface.replaceGeneration) || agent.session.surface.replaceGeneration < 0 || typeof agent.options !== "object" || agent.options === null || !["idle", "running"].includes(String(agent.status)) || typeof agent.runMaintenance !== "function") throw new ToolkitToolError("rescue-host-unavailable");
	return agent;
}
function record$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
const POLICY_KEYS = [
	"thresholdRatio",
	"headroomTokens",
	"retainRatio",
	"retainTokens",
	"summarizationProvider",
	"summarizationModel",
	"maxTokens",
	"compactionRetries",
	"maxOverflowRetries"
];
const ENGINE_METHODS = [
	"compactNow",
	"compactRegion",
	"compactIfNeeded",
	"compactPressure",
	"summarize",
	"regionDependencies"
];
function boundedString(value) {
	return typeof value === "string" && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}
function validPolicy(value, defaults) {
	for (const key of ["thresholdRatio", "retainRatio"]) if (defaults && key === "thresholdRatio" || value[key] !== void 0) {
		if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || Number(value[key]) <= 0 || Number(value[key]) > 1) return false;
	}
	if (value["retainTokens"] !== void 0 && (!Number.isSafeInteger(value["retainTokens"]) || Number(value["retainTokens"]) < 0)) return false;
	if ((defaults || value["headroomTokens"] !== void 0) && (!Number.isSafeInteger(value["headroomTokens"]) || Number(value["headroomTokens"]) < 0)) return false;
	if (value["retainTokens"] !== void 0 && value["retainRatio"] !== void 0 || defaults && value["retainTokens"] === void 0 && value["retainRatio"] === void 0) return false;
	for (const key of [
		"maxTokens",
		"compactionRetries",
		"maxOverflowRetries"
	]) if (defaults || value[key] !== void 0) {
		if (!Number.isSafeInteger(value[key]) || Number(value[key]) < (key === "maxTokens" ? 1 : 0)) return false;
	}
	const provider = value["summarizationProvider"];
	const model = value["summarizationModel"];
	if (!defaults && provider === void 0 && model === void 0) return true;
	return boundedString(provider) && boundedString(model) && provider.length === 0 === (model.length === 0);
}
/** Direct known BasicCompactionEngine prototype and frozen resolved policy, not a constructor-name guess. */
function knownConfig(value) {
	try {
		if (!record$1(value)) return void 0;
		const prototype = Object.getPrototypeOf(value);
		const constructor = prototype?.["constructor"];
		if (prototype === null || typeof constructor !== "function" || constructor.name !== "BasicCompactionEngine" || constructor.prototype !== prototype || ENGINE_METHODS.some((name) => Object.hasOwn(value, name) || typeof Object.getOwnPropertyDescriptor(prototype, name)?.value !== "function")) return void 0;
		const config = Object.getOwnPropertyDescriptor(value, "config")?.value;
		if (!record$1(config) || !Object.isFrozen(config) || Object.keys(config).some((key) => ![
			...POLICY_KEYS,
			"modelPolicies",
			"auto"
		].includes(key)) || typeof config["auto"] !== "boolean" || !validPolicy(config, true) || !Array.isArray(config["modelPolicies"]) || !Object.isFrozen(config["modelPolicies"]) || config["modelPolicies"].length > 512) return void 0;
		const seen = /* @__PURE__ */ new Set();
		for (const policy of config["modelPolicies"]) {
			if (!record$1(policy) || !Object.isFrozen(policy) || Object.keys(policy).some((key) => ![
				...POLICY_KEYS,
				"provider",
				"model"
			].includes(key)) || !boundedString(policy["provider"]) || policy["provider"].length === 0 || !boundedString(policy["model"]) || policy["model"].length === 0 || !validPolicy(policy, false)) return void 0;
			const identity = JSON.stringify([policy["provider"], policy["model"]]);
			if (seen.has(identity)) return void 0;
			seen.add(identity);
		}
		return config;
	} catch {
		return;
	}
}
function isKnownToolkitCompaction(value) {
	return knownConfig(value) !== void 0;
}
function route(agent) {
	let header;
	try {
		header = agent.session.requestHeader?.();
	} catch {
		throw new ToolkitToolError("rescue-host-unavailable");
	}
	if (header === void 0) return agent.options;
	if (!record$1(header) || !record$1(header["config"]) || typeof header["config"]["provider"] !== "string" || typeof header["config"]["model"] !== "string") throw new ToolkitToolError("rescue-host-unavailable");
	return {
		provider: header["config"]["provider"],
		model: header["config"]["model"]
	};
}
/** Conversation target used to select the host's exact-model policy. Summary overrides are resolved separately. */
function toolkitContextProvider(value) {
	const target = route(agentPort(value));
	if (!["workbuddy", "workbuddy-ai"].includes(target.provider ?? "") || !target.model) throw new ToolkitToolError("rescue-provider-unavailable");
	return target.provider;
}
function summarySelection(value, compaction) {
	const agent = agentPort(value);
	const conversationProvider = toolkitContextProvider(agent);
	const conversation = route(agent);
	const config = knownConfig(compaction);
	if (config === void 0) throw new ToolkitToolError("rescue-host-unavailable");
	const override = config["modelPolicies"].find((policy) => policy["provider"] === conversation.provider && policy["model"] === conversation.model);
	const configuredProvider = override?.["summarizationProvider"] ?? config["summarizationProvider"];
	const configuredModel = override?.["summarizationModel"] ?? config["summarizationModel"];
	const provider = configuredProvider === "" ? conversation.provider : configuredProvider;
	const model = configuredProvider === "" ? conversation.model : configuredModel;
	if (provider !== conversationProvider || typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(model)) throw new ToolkitToolError("rescue-summary-target-unavailable");
	return {
		target: {
			provider: conversationProvider,
			model
		},
		policy: {
			defaults: POLICY_KEYS.map((key) => config[key]),
			override: override === void 0 ? null : POLICY_KEYS.map((key) => override[key])
		}
	};
}
function resolveToolkitSummaryTarget(value, compaction) {
	return summarySelection(value, compaction).target;
}
/** Model-visible content/routing only: command/approval audit entries cannot invalidate their own apply. */
function contextContentRevision(value, compaction) {
	const agent = agentPort(value);
	const routed = route(agent);
	return createHash("sha256").update(JSON.stringify([
		agent.session.id,
		agent.session.surface.nodes,
		agent.session.surface.contentGeneration,
		agent.session.surface.replaceGeneration,
		agent.options.provider,
		agent.options.model,
		routed.provider,
		routed.model,
		compaction === void 0 ? null : summarySelection(agent, compaction)
	])).digest("hex");
}
async function readToolkitContext(value, query, meter, signal, compaction) {
	if (query === void 0 || signal.aborted) throw new ToolkitToolError("rescue-host-unavailable");
	const agent = agentPort(value);
	const summaryTarget = resolveToolkitSummaryTarget(agent, compaction);
	const revision = contextContentRevision(agent, compaction);
	let lease;
	try {
		lease = await query.observeSession(agent.session.id, {
			signal,
			projectionMode: "all"
		});
		if (lease?.source !== "live" || lease.header?.id !== agent.session.id || typeof lease[Symbol.dispose] !== "function") throw new ToolkitToolError("rescue-host-unavailable");
		if (signal.aborted || contextContentRevision(agent, compaction) !== revision) throw new ToolkitToolError("rescue-preview-changed");
		const events = lease.events;
		if (!Array.isArray(events)) throw new ToolkitToolError("rescue-host-unavailable");
		if (events.length > 2e4) throw new ToolkitToolError("rescue-export-too-large");
		let bytes = 0;
		for (const event of events) {
			bytes += Buffer.byteLength(JSON.stringify(event));
			if (bytes > 4e6) throw new ToolkitToolError("rescue-export-too-large");
		}
		let estimatedTokens;
		try {
			estimatedTokens = meter?.measure(agent.session).totalTokens;
		} catch {}
		const copied = structuredClone(events);
		if (signal.aborted || contextContentRevision(agent, compaction) !== revision) throw new ToolkitToolError("rescue-preview-changed");
		return {
			sessionId: agent.session.id,
			revision,
			idle: agent.status === "idle",
			events: copied,
			surfaceNodes: [...agent.session.surface.nodes],
			summaryTarget,
			...estimatedTokens === void 0 || !Number.isFinite(estimatedTokens) || estimatedTokens < 0 ? {} : { estimatedTokens }
		};
	} catch (error) {
		throw error instanceof ToolkitToolError ? error : new ToolkitToolError("rescue-host-unavailable");
	} finally {
		try {
			if (typeof lease?.[Symbol.dispose] === "function") lease[Symbol.dispose]();
		} catch {
			throw new ToolkitToolError("rescue-host-unavailable");
		}
	}
}
/** No await between revision/idle validation and the host's synchronous maintenance entry. */
function applyToolkitContext(value, compaction, signal, expected) {
	const agent = agentPort(value);
	if (compaction === void 0) throw new ToolkitToolError("rescue-host-unavailable");
	if (signal.aborted) throw new ToolkitToolError("cancelled");
	if (agent.status !== "idle") throw new ToolkitToolError("rescue-session-busy");
	const target = resolveToolkitSummaryTarget(agent, compaction);
	if (agent.session.id !== expected.sessionId || contextContentRevision(agent, compaction) !== expected.revision || expected.summaryTarget?.provider !== target.provider || expected.summaryTarget.model !== target.model) throw new ToolkitToolError("rescue-preview-changed");
	return compaction.compactNow(value, signal);
}
// src/context-rescue-guard.ts
/** Per-rescue auxiliary-call boundary; never rewrites the shared host summarizer or other sessions. */
const storage = new AsyncLocalStorage();
const activeBySession = /* @__PURE__ */ new Map();
function currentToolkitRescueFrame() {
	return storage.getStore();
}
async function withToolkitRescueFrame(plan, operation) {
	toolkitThrowIfCancelled(plan.signal);
	if (activeBySession.has(plan.sessionId) || activeBySession.size >= 16) throw new ToolkitToolError("rescue-session-busy");
	if (!plan.sessionId || plan.sessionId.length > 256 || !["workbuddy", "workbuddy-ai"].includes(plan.provider) || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(plan.model) || !(plan.provider === "workbuddy" ? /^cn-[a-f0-9]{32}$/u : /^global-[a-f0-9]{32}$/u).test(plan.servingAccount)) throw new ToolkitToolError("rescue-host-unavailable");
	const controller = new AbortController();
	const signal = AbortSignal.any([controller.signal, plan.signal]);
	const frame = {
		sessionId: plan.sessionId,
		provider: plan.provider,
		model: plan.model,
		servingAccount: plan.servingAccount,
		signal,
		sends: 0,
		abort: () => {
			controller.abort();
		},
		validate: async () => {
			try {
				toolkitThrowIfCancelled(signal);
				await plan.validate();
				toolkitThrowIfCancelled(signal);
			} catch (error) {
				controller.abort();
				throw error instanceof ToolkitToolError ? error : new ToolkitToolError("rescue-authorization-changed");
			}
		},
		checkScope: async (provider, account) => {
			toolkitThrowIfCancelled(signal);
			if (provider !== frame.provider || account !== frame.servingAccount) {
				controller.abort();
				throw new ToolkitToolError("rescue-serving-account-changed");
			}
			await frame.validate();
		}
	};
	activeBySession.set(plan.sessionId, frame);
	try {
		return await storage.run(frame, () => operation(signal));
	} finally {
		controller.abort();
		if (activeBySession.get(plan.sessionId) === frame) activeBySession.delete(plan.sessionId);
	}
}
/** Every host summary/recovery attempt is checked before the lazy adapter is prepared or dispatched. */
async function* guardToolkitRescueStream(options, next) {
	const frame = storage.getStore() ?? (options.sessionId === void 0 ? void 0 : activeBySession.get(options.sessionId));
	if (frame === void 0) {
		yield* next();
		return;
	}
	try {
		toolkitThrowIfCancelled(frame.signal);
		if (options.sessionId !== frame.sessionId || options.purpose !== "compaction" || options.provider !== frame.provider || options.model !== frame.model) throw new ToolkitToolError("rescue-send-target-changed");
		if (frame.sends !== 0) throw new ToolkitToolError("rescue-summary-retry-disabled");
		if (options.signal?.aborted) throw new ToolkitToolError("cancelled");
		if (options.signal !== frame.signal) {
			if (Object.isFrozen(options)) throw new ToolkitToolError("rescue-send-signal-unavailable");
			const signal = options.signal === void 0 ? frame.signal : AbortSignal.any([frame.signal, options.signal]);
			try {
				Object.defineProperty(options, "signal", {
					value: signal,
					enumerable: true,
					configurable: false,
					writable: false
				});
			} catch {
				throw new ToolkitToolError("rescue-send-signal-unavailable");
			}
		}
		Object.freeze(options);
		frame.sends++;
		await frame.validate();
		toolkitThrowIfCancelled(frame.signal);
		const iterator = storage.run(frame, () => next()[Symbol.asyncIterator]());
		let finished = false;
		try {
			for (;;) {
				toolkitThrowIfCancelled(frame.signal);
				const step = await storage.run(frame, () => iterator.next());
				if (step.done) {
					finished = true;
					break;
				}
				yield step.value;
			}
		} finally {
			if (!finished && iterator.return !== void 0) await storage.run(frame, () => iterator.return());
		}
	} catch (error) {
		frame.abort();
		throw error instanceof ToolkitToolError ? error : new ToolkitToolError("rescue-send-unavailable");
	}
}
// src/toolkit-host.ts
/** Optional active-host adapters. Losing a service or changing consent aborts the retired generation. */
const PORT_METHOD = {
	tools: "register",
	approval: "request",
	commands: "register",
	sessionQuery: "observeSession",
	compaction: "compactNow",
	tokenMeter: "measure",
	llm: "stream"
};
function port(value, method) {
	return typeof value === "object" && value !== null && typeof value[method] === "function";
}
function authorizationRevision(content, owner) {
	return createHash("sha256").update(JSON.stringify([content, owner])).digest("hex");
}
var ToolkitHostManager = class {
	ctx;
	toolkits;
	options;
	ports = /* @__PURE__ */ new Map();
	releases = [];
	callbacks = /* @__PURE__ */ new Map();
	injections = [];
	generation = new AbortController();
	rescue;
	stopped = false;
	releaseSendGuard;
	constructor(ctx, toolkits, options = {}) {
		this.ctx = ctx;
		this.toolkits = toolkits;
		this.options = options;
		for (const name of Object.keys(PORT_METHOD)) try {
			const value = ctx.get(name);
			if (port(value, PORT_METHOD[name])) this.ports.set(name, value);
		} catch {}
		for (const toolkit of toolkits) {
			const previous = toolkit.onChange;
			const own = () => {
				try {
					previous();
				} catch {
					this.warn();
				}
				this.refresh();
			};
			this.callbacks.set(toolkit, {
				previous,
				own
			});
			toolkit.onChange = own;
		}
		for (const name of Object.keys(PORT_METHOD)) try {
			const injection = ctx.inject([name], (scope) => {
				let value;
				try {
					value = scope.get(name);
				} catch {
					return;
				}
				if (!port(value, PORT_METHOD[name])) return;
				if (this.ports.get(name) !== value) {
					this.ports.set(name, value);
					this.refresh();
				}
				scope.effect(() => () => {
					if (this.ports.get(name) === value) {
						this.ports.delete(name);
						this.refresh();
					}
				}, `workbuddy toolkit ${name}`);
			});
			this.injections.push(injection);
		} catch {}
		try {
			this.releaseSendGuard = ctx.on("llm/stream", (options, next) => guardToolkitRescueStream(options, next));
		} catch {}
		try {
			ctx.effect(() => () => this.dispose(), "workbuddy toolkit host lifecycle");
		} catch {
			this.dispose();
			return;
		}
		this.refresh();
	}
	warn() {
		try {
			this.ctx.logger.warn("WorkBuddy optional toolkit integration is unavailable; provider registration remains active.");
		} catch {}
	}
	retire() {
		this.generation.abort();
		this.generation = new AbortController();
		this.rescue?.dispose();
		this.rescue = void 0;
		for (const release of this.releases.splice(0).reverse()) try {
			release();
		} catch {}
	}
	/** Called after cached owner state changes; no polling, provider calls or automatic request replay. */
	refresh() {
		if (this.stopped) return;
		this.retire();
		const tools = this.ports.get("tools");
		const approval = this.ports.get("approval");
		const commands = this.ports.get("commands");
		const query = this.ports.get("sessionQuery");
		const rawCompaction = this.ports.get("compaction");
		const compaction = isKnownToolkitCompaction(rawCompaction) ? rawCompaction : void 0;
		const meter = this.ports.get("tokenMeter");
		const capabilities = {
			tools: tools !== void 0,
			approval: approval !== void 0,
			context: commands !== void 0 && query !== void 0 && compaction !== void 0 && this.ports.has("llm") && this.releaseSendGuard !== void 0
		};
		for (const toolkit of this.toolkits) toolkit.attach(capabilities, approval);
		const signal = this.generation.signal;
		try {
			const definitions = [];
			if (tools !== void 0 && approval !== void 0) for (const toolkit of this.toolkits) {
				const owner = toolkit.owner;
				const revision = toolkit.cached?.revision;
				for (const definition of toolkit.definitions()) definitions.push({
					...definition,
					execute: async (args, execution) => {
						const combined = AbortSignal.any([signal, execution.signal]);
						toolkitThrowIfCancelled(combined);
						await toolkit.refresh();
						toolkitThrowIfCancelled(combined);
						const primary = await toolkit.primary();
						toolkitThrowIfCancelled(combined);
						if (primary === void 0 || primary.account !== owner || primary.config.revision !== revision) throw new ToolkitToolError("toolkit-account-changed");
						return await definition.execute(args, {
							...execution,
							signal: combined
						});
					}
				});
			}
			if (capabilities.context && this.toolkits.some((toolkit) => toolkit.cached?.features.contextRescue === true)) {
				const service = new ContextRescueService({
					enabled: () => this.anyContextEnabled(signal),
					exportDirectory: this.options.exportDirectory ?? workbuddyVisibilityPath(".workbuddy-context-rescue"),
					readSnapshot: async (agent, readSignal) => {
						const primary = await this.contextOwner(agent, readSignal);
						const snapshot = await readToolkitContext(agent, query, meter, readSignal, compaction);
						return {
							...snapshot,
							servingAccount: primary.servingAccount,
							revision: authorizationRevision(snapshot.revision, `${primary.revision}:${primary.servingAccount}`)
						};
					},
					compact: async (agent, applySignal, expected) => {
						const primary = await this.contextOwner(agent, applySignal);
						const revision = contextContentRevision(agent, compaction);
						if (authorizationRevision(revision, `${primary.revision}:${primary.servingAccount}`) !== expected.revision || expected.servingAccount !== primary.servingAccount) throw new ToolkitToolError("rescue-preview-changed");
						const target = resolveToolkitSummaryTarget(agent, compaction);
						return withToolkitRescueFrame({
							sessionId: expected.sessionId,
							...target,
							servingAccount: primary.servingAccount,
							signal: applySignal,
							validate: async () => {
								const current = await this.contextOwner(agent, applySignal);
								if (current.revision !== primary.revision || current.servingAccount !== primary.servingAccount || contextContentRevision(agent, compaction) !== revision) throw new ToolkitToolError("rescue-preview-changed");
							}
						}, (ownedSignal) => applyToolkitContext(agent, compaction, ownedSignal, {
							...expected,
							revision
						}));
					}
				});
				this.rescue = service;
				if (tools !== void 0) definitions.push(...createContextRescueTools({ service }).map((definition) => ({
					...definition,
					execute: (args, execution) => definition.execute(args, {
						...execution,
						signal: AbortSignal.any([signal, execution.signal])
					})
				})));
				this.releases.push(registerContextRescueCommand(commands, service));
			}
			if (commands !== void 0 && this.toolkits.some((toolkit) => toolkit.cached?.features.cli === true)) this.releases.push(commands.register({
				name: "workbuddy-codebuddy",
				description: "Run the configured read-only CodeBuddy review: [cn|ai] <prompt>",
				handler: (invocation) => this.runHumanCodeBuddy(invocation, signal)
			}));
			if (tools !== void 0 && definitions.length > 0) this.releases.push(registerToolkitTools(tools, definitions));
		} catch {
			this.retire();
			for (const toolkit of this.toolkits) toolkit.attach({
				tools: false,
				approval: false,
				context: false
			}, void 0);
			this.warn();
		}
	}
	async anyContextEnabled(signal) {
		if (this.stopped || signal.aborted) return false;
		for (const toolkit of this.toolkits) try {
			if ((await toolkit.primary())?.config.features.contextRescue) return !this.stopped && !signal.aborted;
		} catch {}
		return false;
	}
	async contextOwner(agent, signal) {
		toolkitThrowIfCancelled(signal);
		const provider = toolkitContextProvider(agent);
		const toolkit = this.toolkits.find((item) => item.variant.id === provider);
		const primary = await toolkit?.primary();
		toolkitThrowIfCancelled(signal);
		if (primary === void 0 || !primary.config.features.contextRescue) throw new ToolkitToolError("feature-disabled");
		const scope = await toolkit.scope();
		toolkitThrowIfCancelled(signal);
		const decision = toolkit.policy.decision();
		if (decision.state === "pending" || decision.state === "exhausted") throw new ToolkitToolError("rescue-rotation-unsettled");
		const latest = await toolkit.primary();
		toolkitThrowIfCancelled(signal);
		if (scope === void 0 || scope.revision !== primary.revision || latest?.revision !== primary.revision) throw new ToolkitToolError("rescue-preview-changed");
		return {
			...primary,
			servingAccount: scope.account
		};
	}
	async runHumanCodeBuddy(invocation, lifetime) {
		const signal = AbortSignal.any([lifetime, invocation.signal]);
		try {
			toolkitThrowIfCancelled(signal);
			const raw = invocation.rawInput.trim();
			const match = /^(cn|ai)(?:\s+([\s\S]*))?$/u.exec(raw);
			const prompt = match === null ? raw : (match[2] ?? "").trim();
			if (prompt === "" || prompt.length > 32e3) throw new ToolkitToolError("cli-command-usage");
			const candidates = match === null ? this.toolkits : this.toolkits.filter((toolkit) => toolkit.variant.id === (match[1] === "ai" ? "workbuddy-ai" : "workbuddy"));
			const choices = await Promise.all(candidates.map(async (toolkit) => ({
				toolkit,
				primary: await toolkit.primary()
			})));
			toolkitThrowIfCancelled(signal);
			const enabled = choices.filter((choice) => choice.primary?.config.features.cli);
			if (enabled.length !== 1) throw new ToolkitToolError(match === null && enabled.length > 1 ? "cli-command-region-required" : "feature-disabled");
			const { toolkit, primary } = enabled[0];
			if (primary === void 0 || !primary.config.features.cli) throw new ToolkitToolError("feature-disabled");
			const installation = (this.options.installation ?? codeBuddyInstallation)();
			if (installation === void 0) throw new ToolkitToolError("cli-unavailable");
			const request = {
				...installation,
				...primary.config.cli,
				prompt,
				signal
			};
			buildCodeBuddyArguments(request);
			const latest = await toolkit.primary();
			toolkitThrowIfCancelled(signal);
			if (latest?.revision !== primary.revision) throw new ToolkitToolError("configuration-changed");
			const result = await (this.options.runCodeBuddy ?? runCodeBuddy)(request);
			toolkitThrowIfCancelled(signal);
			return {
				kind: "success",
				text: result.text
			};
		} catch (error) {
			return {
				kind: "error",
				text: error instanceof ToolkitToolError ? error.message : "workbuddy: cli-unavailable"
			};
		}
	}
	dispose() {
		if (this.stopped) return;
		this.stopped = true;
		this.retire();
		this.generation.abort();
		for (const toolkit of this.toolkits) {
			const callback = this.callbacks.get(toolkit);
			if (toolkit.onChange === callback?.own) toolkit.onChange = callback.previous;
			toolkit.attach({
				tools: false,
				approval: false,
				context: false
			}, void 0);
		}
		for (const injection of this.injections.splice(0)) try {
			const result = injection.dispose();
			if (result instanceof Promise) result.catch(() => {});
		} catch {}
		try {
			this.releaseSendGuard?.();
		} catch {}
		this.releaseSendGuard = void 0;
	}
};
// src/loopback.ts
/** Loopback hostnames a local plugin surface may be addressed by. */
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]"
]);
/** Strip the optional :port from a Host header value, IPv6-bracket aware. */
function hostnameOfHost(host) {
	let hostname = host.trim().toLowerCase();
	if (hostname.startsWith("[")) {
		const end = hostname.indexOf("]");
		return end === -1 ? hostname : hostname.slice(0, end + 1);
	}
	const colon = hostname.lastIndexOf(":");
	if (colon !== -1 && !hostname.slice(0, colon).includes(":") && /^\d+$/.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon);
	return hostname;
}
/**
* The request's Host header must name the loopback interface. A DNS-rebinding
* page (attacker domain re-resolved to 127.0.0.1) sends its own domain in
* Host, so this check drops those before any routing happens.
*/
function hostIsLoopback(host) {
	if (host === void 0 || host.trim() === "") return false;
	return LOOPBACK_HOSTS.has(hostnameOfHost(host));
}
/**
* A browser-sent Origin (present header) must be loopback. Non-browser
* clients (the plugin's own fetch calls) send no Origin at all and pass.
*/
function originIsLoopback(origin) {
	if (origin === void 0 || origin.trim() === "") return true;
	try {
		const { hostname } = new URL(origin);
		return LOOPBACK_HOSTS.has(hostname) || hostname === "::1";
	} catch {
		return false;
	}
}
/**
* Ports fetch refuses to connect to, per the fetch standard's port blocking
* table (https://fetch.spec.whatwg.org/#port-blocking). Kept in sync with the
* `badPorts` table undici ships: only the entries a host's ephemeral range can
* actually reach matter, but carrying the whole list costs nothing and keeps
* the check honest on machines with a customised range.
*/
const FETCH_BLOCKED_PORTS = /* @__PURE__ */ new Set([
	1,
	7,
	9,
	11,
	13,
	15,
	17,
	19,
	20,
	21,
	22,
	23,
	25,
	37,
	42,
	43,
	53,
	69,
	77,
	79,
	87,
	95,
	101,
	102,
	103,
	104,
	109,
	110,
	111,
	113,
	115,
	117,
	119,
	123,
	135,
	137,
	139,
	143,
	161,
	179,
	389,
	427,
	465,
	512,
	513,
	514,
	515,
	526,
	530,
	531,
	532,
	540,
	548,
	554,
	556,
	563,
	587,
	601,
	636,
	989,
	990,
	993,
	995,
	1719,
	1720,
	1723,
	2049,
	3659,
	4045,
	4190,
	5060,
	5061,
	6e3,
	6566,
	6665,
	6666,
	6667,
	6668,
	6669,
	6679,
	6697,
	10080
]);
/** Whether fetch (and therefore pi-ai) refuses to connect to `port`. */
function isFetchBlockedPort(port) {
	return FETCH_BLOCKED_PORTS.has(port);
}
/** Bind attempts allowed before giving up, including the first. */
const DEFAULT_MAX_ATTEMPTS = 16;
/**
* Bind `server` to an ephemeral port fetch will actually connect to, and
* resolve with the address it ended up on.
*
* `listen(0)` lets the OS hand out any free ephemeral port, and a handful of
* the ports it can hand out are on the fetch standard's bad-port list: fetch
* refuses to connect to them and fails with `TypeError: fetch failed` before a
* socket is opened. The shim is only ever reached through fetch (pi-ai calls
* it), so settling on one of those ports leaves the plugin with an endpoint
* that answers raw HTTP and rejects every real request. The port is not
* negotiable at request time, so the only fix is to bind again.
*
* A blocked port is closed and rebound; a listen error is fatal, as it was
* before, because nothing about picking another port would fix it.
*/
async function bindToUsablePort(server, options) {
	const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
	const isPortBlocked = options.isPortBlocked ?? isFetchBlockedPort;
	let lastBlockedPort = 0;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const address = await listenOnEphemeralPort(server, options.host);
		if (!isPortBlocked(address.port)) return address;
		lastBlockedPort = address.port;
		options.onBlockedPort?.(address.port, attempt);
		await closeQuietly(server);
	}
	throw new Error(`could not bind a fetch-reachable loopback port after ${maxAttempts} attempts (last blocked port: ${lastBlockedPort})`);
}
/** One `listen(0)` on `host`, resolving with the address the OS handed out. */
function listenOnEphemeralPort(server, host) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			server.off("listening", onListening);
			server.off("error", onError);
		};
		const onListening = () => {
			cleanup();
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(/* @__PURE__ */ new Error("workbuddy shim has no listening address"));
				return;
			}
			resolve(address);
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		server.once("listening", onListening);
		server.once("error", onError);
		server.listen(0, host);
	});
}
/** Close between attempts; a listener that already closed is not an error here. */
function closeQuietly(server) {
	return new Promise((resolve) => {
		server.closeAllConnections();
		server.close(() => resolve());
	});
}
// src/host-route-auth.ts
/** Require the Host's authenticated owner before reading account state or controls. */
function withWorkBuddyHostAuth(ctx, handler) {
	return async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		const admission = ctx.get("connection")?.admit(req) ?? { rejection: 401 };
		const rejection = "rejection" in admission ? admission.rejection : admission.peer.principal.kind === "owner" ? void 0 : 403;
		if (rejection !== void 0) {
			const payload = JSON.stringify({ error: rejection === 401 ? "unauthorized" : "forbidden" });
			res.writeHead(rejection, {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(payload)
			});
			res.end(payload);
			return;
		}
		await handler(req, res);
	};
}
// src/toolkit-route.ts
function json$3(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body),
		"Cache-Control": "no-store"
	});
	res.end(body);
}
const fields = {
	"save-account": ["action", "revision"],
	"follow-desktop": ["action", "revision"],
	"select-account": [
		"action",
		"revision",
		"id"
	],
	"remove-account": [
		"action",
		"revision",
		"id"
	],
	"rename-account": [
		"action",
		"revision",
		"id",
		"label"
	],
	"update-settings": [
		"action",
		"revision",
		"account",
		"patch"
	],
	"checkin": [
		"action",
		"revision",
		"id",
		"account"
	]
};
function closedPatch(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const patch = value;
	const groups = {
		features: [
			"images",
			"videos",
			"cli",
			"contextRescue"
		],
		automation: [
			"rotate",
			"checkin",
			"members",
			"maxSwitches"
		],
		cli: [
			"workspace",
			"model",
			"effort",
			"timeoutMs",
			"maxTurns"
		]
	};
	for (const [group, child] of Object.entries(patch)) {
		if (!Object.hasOwn(groups, group) || typeof child !== "object" || child === null || Array.isArray(child)) return false;
		for (const [key, entry] of Object.entries(child)) {
			if (!groups[group].includes(key)) return false;
			if (group === "features" || key === "rotate" || key === "checkin") {
				if (typeof entry !== "boolean") return false;
			} else if (key === "members") {
				if (!Array.isArray(entry) || entry.length > 16 || !entry.every((id) => typeof id === "string" && /^(cn|global)-[a-f0-9]{32}$/u.test(id)) || new Set(entry).size !== entry.length) return false;
			} else if ([
				"maxSwitches",
				"timeoutMs",
				"maxTurns"
			].includes(key)) {
				if (!Number.isSafeInteger(entry) || entry < 1) return false;
			} else if (typeof entry !== "string" || entry.length > (key === "workspace" ? 4096 : 128) || /[\u0000-\u001f\u007f]/u.test(entry)) return false;
		}
	}
	return true;
}
function parseToolkitAction(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const record = value;
	const action = record["action"];
	if (typeof action !== "string" || !Object.hasOwn(fields, action)) return void 0;
	const keys = fields[action];
	if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(record, key))) return void 0;
	if (typeof record["revision"] !== "string" || record["revision"].length > 80 || !record["revision"]) return void 0;
	for (const key of ["id", "account"]) if (keys.includes(key) && (typeof record[key] !== "string" || !/^(cn|global)-[a-f0-9]{32}$/u.test(record[key]))) return void 0;
	if (keys.includes("label") && (typeof record["label"] !== "string" || !record["label"].trim() || record["label"].length > 80 || /[\u0000-\u001f\u007f]/u.test(record["label"]))) return void 0;
	if (keys.includes("patch") && !closedPatch(record["patch"])) return void 0;
	return record;
}
function toolkitHandler(deps) {
	return async (req, res) => {
		if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
			json$3(res, 403, { error: "request-not-trusted" });
			return;
		}
		if (req.method === "GET") {
			try {
				json$3(res, 200, await deps.state());
			} catch {
				json$3(res, 503, { error: "toolkit-state-unavailable" });
			}
			return;
		}
		if (req.method !== "POST") {
			json$3(res, 405, { error: "method-not-allowed" });
			return;
		}
		const header = req.headers["x-workbuddy-toolkit-key"];
		if (typeof header !== "string" || Buffer.byteLength(header) !== Buffer.byteLength(deps.key) || !timingSafeEqual(Buffer.from(header), Buffer.from(deps.key))) {
			json$3(res, 403, { error: "invalid-control-key" });
			return;
		}
		if (!/^application\/json(?:;|$)/iu.test(req.headers["content-type"] ?? "")) {
			json$3(res, 415, { error: "json-required" });
			return;
		}
		const buffers = [];
		let total = 0;
		try {
			for await (const chunk of req) {
				const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				total += bytes.length;
				if (total > 16384) {
					json$3(res, 413, { error: "body-too-large" });
					return;
				}
				buffers.push(bytes);
			}
		} catch {
			if (!res.destroyed && !res.headersSent) json$3(res, 400, { error: "incomplete-body" });
			return;
		}
		let action;
		try {
			action = parseToolkitAction(JSON.parse(Buffer.concat(buffers).toString("utf8")));
		} catch {}
		if (action === void 0) {
			json$3(res, 400, { error: "invalid-action" });
			return;
		}
		try {
			json$3(res, 200, await deps.action(action));
		} catch (error) {
			const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
			json$3(res, code.endsWith("changed") ? 409 : 400, { error: code.endsWith("changed") ? "stale-state" : "action-failed" });
		}
	};
}
function registerToolkitRoute(ctx, deps) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: deps.path,
		handler: withWorkBuddyHostAuth(ctx, toolkitHandler(deps))
	}), "workbuddy: account and capability controls");
}
// src/toolkit-types.ts
function toolkitPath(provider) {
	return `/plugins/dsh-workbuddy-connect/${provider === "workbuddy-ai" ? "ai/" : ""}toolkit`;
}
// src/catalog-store.ts
/**
* The last catalog that actually loaded, kept per variant and per account.
*
* Both the plan (§4 "降级顺序为同版同来源的最近成功目录 → 本版内置保守目录")
* and the README promise this fallback, and without it a restart always drops
* the user to the built-in roster even when a good catalog was fetched minutes
* earlier. The built-in roster is a snapshot taken once; a fetched catalog is
* what the upstream actually serves to this account.
*
* What it deliberately is *not*:
*
* - not a cache with a freshness policy — it never prevents a fetch, it only
*   answers when a fetch cannot;
* - not shared across accounts (a different account can see a different roster
*   and different promotions), nor across variants (the CN and international
*   endpoints disagree about rates and windows for the same model id);
* - not a place for secrets: model metadata only, never a token. The account
*   key is a `uid:enterpriseId` identity already visible in the status document.
*
* @module dsh-workbuddy-connect/catalog-store
*/
/** On-disk format this reader accepts; other versions are discarded. */
const CATALOG_FORMAT_VERSION = 1;
/** Basename of the CN variant's saved catalog inside the Harness home. */
const WORKBUDDY_CATALOG_FILENAME = ".workbuddy-catalog.json";
/** Plugin-owned saved-catalog path inside the Harness home. */
function workbuddyCatalogPath(filename = WORKBUDDY_CATALOG_FILENAME) {
	return join(resolveDshHome(), filename);
}
/** Whether a parsed value is a model row worth keeping. */
function isModel(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const row = value;
	return typeof row["id"] === "string" && row["id"] !== "" && typeof row["name"] === "string" && typeof row["contextWindow"] === "number" && Number.isFinite(row["contextWindow"]) && typeof row["maxTokens"] === "number" && Number.isFinite(row["maxTokens"]) && typeof row["supportsImages"] === "boolean" && validSavedPromotionMetadata(row);
}
/** Whether a parsed value is a saved catalog this reader can trust. */
function isSaved(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const entry = value;
	if (typeof entry["account"] !== "string" || entry["account"] === "") return false;
	if (typeof entry["source"] !== "string" || entry["source"] === "") return false;
	if (typeof entry["fetchedAtMs"] !== "number" || !Number.isFinite(entry["fetchedAtMs"])) return false;
	const models = entry["models"];
	if (!Array.isArray(models) || models.length === 0) return false;
	return models.every(isModel);
}
/**
* The last successful catalog per account, read once and written atomically.
*
* Malformed content reads as "nothing saved" rather than throwing: this file
* is an optimization for the offline and first-seconds cases, and a corrupt one
* must never be able to stop the plugin from serving models.
*/
var WorkBuddyCatalogStore = class {
	path;
	entries;
	constructor(options = {}) {
		this.path = typeof options === "string" ? options : options.path ?? workbuddyCatalogPath();
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.entries !== void 0) return this.entries;
		const entries = {};
		if (existsSync(this.path)) try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8"));
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				const document = parsed;
				const raw = document["version"] === CATALOG_FORMAT_VERSION ? document["entries"] : void 0;
				if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
					for (const [key, value] of Object.entries(raw)) if (isSaved(value)) entries[key] = value;
				}
			}
		} catch {}
		this.entries = entries;
		return entries;
	}
	/** The saved catalog for one account, or `undefined` when there is none. */
	get(account) {
		const entry = this.load()[account];
		return entry === void 0 ? void 0 : entry;
	}
	/**
	* Remember a catalog for an account, replacing whatever was saved before.
	*
	* A failed write is swallowed: the plugin has already served these models,
	* and losing the *memory* of them is not worth surfacing.
	*/
	set(account, catalog) {
		const entries = this.load();
		entries[account] = {
			account,
			...catalog
		};
		this.persist();
	}
	/** Forget one account's catalog — used when that account signs out. */
	delete(account) {
		const entries = this.load();
		if (!(account in entries)) return;
		delete entries[account];
		this.persist();
	}
	persist() {
		const directory = dirname(this.path);
		try {
			if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
			const document = {
				version: CATALOG_FORMAT_VERSION,
				entries: this.load()
			};
			const temporary = resolve(`${this.path}.tmp`);
			writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 384 });
			renameSync(temporary, this.path);
		} catch {}
	}
};
// src/history.ts
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Mirror pi-ai v2 replay validation before trusting reasoning as native history. */
function nativeReplay(message, provider, model) {
	if (message.role !== "assistant" || message.source.provider !== provider || message.source.model !== model) return false;
	const state = message.source.replayState;
	if (!record(state) || !record(state["response"]) || !Array.isArray(state["blocks"])) return false;
	const response = state["response"];
	if (response["kind"] !== "pi-ai" || response["version"] !== 2 || response["api"] !== "openai-completions" || response["provider"] !== provider || response["model"] !== model || ![
		"stop",
		"length",
		"toolUse",
		"error",
		"aborted"
	].includes(String(response["stopReason"]))) return false;
	for (const key of [
		"responseId",
		"responseModel",
		"providerThinkingLevel"
	]) if (response[key] !== void 0 && typeof response[key] !== "string") return false;
	if (state["blocks"].length !== message.content.length) return false;
	return state["blocks"].every((block, i) => {
		if (!record(block) || block["type"] !== message.content[i]?.type || ![
			"text",
			"reasoning",
			"tool-call"
		].includes(String(block["type"]))) return false;
		for (const key of [
			"textSignature",
			"thinkingSignature",
			"thoughtSignature",
			"namespace"
		]) if (block[key] !== void 0 && typeof block[key] !== "string") return false;
		return block["redacted"] === void 0 || typeof block["redacted"] === "boolean";
	});
}
/**
* Foreign/degraded thinking becomes answer text in pi-ai. Remove only those
* blocks before conversion, keeping durable history and routing untouched.
*/
function sanitizeWorkBuddyHistory(options) {
	let changed = false;
	const messages = options.messages.flatMap((message) => {
		if (message.role !== "assistant" || !message.content.some((block) => block.type === "reasoning") || nativeReplay(message, options.provider, options.model)) return [message];
		changed = true;
		const content = message.content.filter((block) => block.type !== "reasoning");
		if (content.length === 0) return [];
		const { replayState: _replay, ...source } = message.source;
		return [{
			...message,
			source,
			content
		}];
	});
	return changed ? {
		...options,
		messages
	} : options;
}
// src/adapter.ts
/**
* The `workbuddy` pi-ai provider: one loopback-backed adapter registered
* into the Harness LLM seam, assembled from public `dsh-llm-pi-ai`
* extension points the way `dsh-codex-connect` assembles its Codex route.
*
* @module dsh-workbuddy-connect/adapter
*/
/** Provider route this bundle owns. */
const WORKBUDDY_PROVIDER = "workbuddy";
/** Provider idle ceiling while one stream read is outstanding. */
const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* Image-request budgets at the dsh-llm-pi-ai defaults; the profile type made
* them required in 0.1.1-rc.2. They bound requests to models whose catalog
* entry declares `supportsImages`; text-only models never receive images.
*/
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 20971520,
	requestImagePixelBudget: 4194304,
	requestImageMaxBytes: 1048576,
	maxRequestImages: 50,
	imageOffloadCountQuantum: 10
};
/**
* Inert pi-ai auth plane. The workbuddy route authenticates only through the
* shim shared secret resolved per request by `resolveApiKey`, so pi-ai's own
* credential lifecycle and ambient discovery must never manufacture a
* credential for it. `PiAiAdapterOptions.auth` is required since 0.1.1-rc.2;
* every ambient question here answers "nothing stored, nothing set".
*/
const INERT_AUTH = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {
			throw new Error("dsh-workbuddy-connect: the workbuddy route has no pi-ai credential lifecycle");
		},
		async delete() {}
	},
	authContext: {
		async env() {},
		async fileExists() {
			return false;
		}
	}
};
/** No per-token pricing is knowable for a subscription quota; report zero. */
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
/**
* Translate the request-image contract across the two attachment-service
* generations a link-installed plugin can straddle.
*
* A `link:` install resolves its platform imports from the *repository's*
* node_modules (Node follows the symlink's real path), so this adapter always
* runs against the pi-ai it was built with — while the attachment service
* comes from the host. Those two generations disagree on what
* `readImageRequest(ref, policyOrTarget)` receives:
*
* - dsh-attachment-local ≤0.1.5: a route policy `{ maxPixels, maxBytes }`,
*   and `validatePolicy` throws `Image request maxPixels must be a positive
*   integer.` when `maxPixels` is missing.
* - 0.1.6+: a per-image target `{ width, height, maxBytes }` with no
*   `maxPixels` at all, validated by `validateTarget`.
*
* A 0.1.6-built pi-ai on a 0.1.5 host therefore hands the old store a target
* the old store rejects, and every image-bearing request fails before it is
* sent. The wrapper below fills the route's own pixel budget into a target
* that lacks it: the 0.1.5 store then computes the same dimensions pi-ai's
* budget already chose, and a 0.1.6 store ignores the extra key.
*/
function withLegacyImageBudget(store) {
	return new Proxy(store, { get(target, property, receiver) {
		if (property === "imageHostPath") return target.imageHostPath.bind(target);
		if (property !== "readImageRequest") return Reflect.get(target, property, receiver);
		return (...args) => {
			const [ref, policy, signal] = args;
			const present = policy?.maxPixels;
			const withPixels = Number.isSafeInteger(present) && present > 0 ? policy : {
				...policy,
				maxPixels: REQUEST_IMAGE_BUDGETS.requestImagePixelBudget
			};
			return target.readImageRequest(ref, withPixels, signal);
		};
	} });
}
/**
* The suffix appended to a model's display name so its billing rate is visible
* wherever the name is shown.
*
* The separator is a middle dot rather than a hyphen or colon: model names
* already contain hyphens (`GLM-5.3-Flash`, `Deepseek-V4-Flash`), so a hyphen
* separator would be ambiguous about where the name ends and the rate begins.
*/
const RATE_SEPARATOR = " · ";
/**
* Append the billing rate to one model's display name.
*
* The rate AND the declared promo badges ride the *name* alone: since DSH
* 0.1.2 the composer's model seat (`ModelSelect`) renders `model.name` only —
* `description` is no longer read there at all (the 0.1.1-era client rendered
* it, which is why the badges used to be visible in the seat). The `/model`
* popup renders the name too, so a separate `description` copy would either
* duplicate (rate) or vanish (badges) depending on client generation.
*
* This is display-only and cannot affect routing: the wire request is built
* from `model.id` (pi-ai's completions API sets `model: model.id`), the
* selection a picker submits is `{provider, model: id, reasoningEffort}`, and
* `dsh-llm` validates `name` as a non-empty string without comparing its
* contents. Nothing in the host resolves a model *by* name.
*/
/**
* The catalog display suffix: the billing rate followed by the declared promo
* badges (`限时免费`, `夜间折扣`), or undefined when the row carries neither.
* The badge labels are the upstream's own spellings and the host seam has no
* locale service, so non-Chinese UIs see them verbatim — accepted until the
* picker grows a localized badge slot.
*/
function displaySuffix(info) {
	const parts = [normalizeCredits(info.billing?.credits), ...info.billing?.badges ?? []].filter((part) => part !== void 0 && part !== "");
	return parts.length === 0 ? void 0 : parts.join(" · ");
}
/** Append the catalog display suffix to one model's display name. */
function withCatalogDisplay(name, info) {
	const suffix = displaySuffix(info);
	return suffix === void 0 ? name : `${name}${RATE_SEPARATOR}${suffix}`;
}
/**
* Resolve a WorkBuddy model's reasoning capability into pi-ai's
* `thinkingLevelMap` (every level pinned to its wire spelling or `null` for
* unsupported), mirroring `dsh-llm-pi-ai`'s own `resolveModelReasoning`.
*
* Two sources, strictly ordered (`docs/reasoning-effort-probe-plan.md` §5):
*
* 1. **The declared set.** When the upstream declares a non-empty
*    `supportedEfforts`, exactly those values are offered and nothing else.
*    This always wins: an observation never widens or narrows a declared set.
* 2. **A local observation.** Rows without a declared set (the older
*    `{effort, summary}` shape) normally get no control at all — their
*    selectable set is client-side knowledge the catalog does not carry, and
*    the desktop app differs per model there. If the user authorized a probe
*    and it established that the upstream *validates* the parameter, the
*    verified spellings are offered.
*
* A `non-validating` observation deliberately yields no control: the upstream
* accepts values that cannot exist (measured on `glm-5.2`), so every per-level
* acceptance it produced would be a false positive.
*
* `off` is offered only when the upstream declares `canDisableThinking: true`.
* It is never probed — disabling thinking is a separate capability, and the
* per-model acceptance of `off` cannot be inferred from the row's shape.
*
* The CN endpoint vetoes `off` further, on models declaring `onlyReasoning`
* (#87) — see {@link region} below. That rule is deliberately region-scoped:
* the contradiction it resolves was measured on the CN catalog, and applying
* it everywhere would have changed which levels the international picker
* offers, which is outside this issue.
*
* The offered set is described internally as "verified accepted", never as
* "verified effective": acceptance proves the upstream did not reject the
* spelling, not that it changes what the model does.
*
* @param region - the endpoint this descriptor is for. Decides only whether
* the `onlyReasoning` veto applies; every other rule is shared. Passed from
* the variant descriptor, never inferred from a model id or a name.
*/
function reasoningFields(info, observed, region = "cn") {
	const resolved = resolveEfforts(info, observed, region);
	if (resolved.efforts.length === 0) return { reasoning: false };
	return {
		reasoning: true,
		thinkingLevelMap: {
			off: resolved.off ? "off" : null,
			minimal: null,
			low: resolved.efforts.includes("low") ? "low" : null,
			medium: resolved.efforts.includes("medium") ? "medium" : null,
			high: resolved.efforts.includes("high") ? "high" : null,
			xhigh: resolved.efforts.includes("xhigh") ? "xhigh" : null,
			max: resolved.efforts.includes("max") ? "max" : null
		}
	};
}
/** Build one pi-ai model descriptor pointing at the loopback shim. */
function toPiModel(info, baseUrl, observed, providerId, region) {
	return {
		id: info.id,
		name: info.name,
		api: "openai-completions",
		provider: providerId,
		baseUrl,
		input: info.supportsImages === true ? ["text", "image"] : ["text"],
		...reasoningFields(info, observed, region),
		cost: NO_COST,
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
		compat: { maxTokensField: "max_tokens" }
	};
}
/**
* Assemble the adapter. The provider's `getModels` reads the live catalog,
* and every model's `baseUrl` is re-resolved per read so the shim's
* ephemeral port applies from the first snapshot after startup.
*
* The profile is constructed by hand rather than through dsh-llm-pi-ai's
* internal `resolveProfiles()`: that helper is not part of the package's
* public export surface (root entry, `lib/` deep imports blocked by the
* exports map, `src/` not shipped), so hand-assembly is the only supported
* path and every newly required field must be adopted here explicitly —
* `modelErrors` since 0.1.5-alpha.2 (#12).
*/
function createWorkBuddyAdapter(options) {
	const { shim, store, catalog, resolveAttachments, resolveImageAccess, observe, hidden } = options;
	const providerId = options.providerId ?? "workbuddy";
	const displayName = options.displayName ?? "WorkBuddy";
	const region = options.region ?? "cn";
	const buildModels = () => {
		const baseUrl = `${shim.baseUrl()}/v1`;
		return catalog.current().map((info) => toPiModel(info, baseUrl, observe?.(info.id), providerId, region));
	};
	const provider = {
		...createProvider({
			id: providerId,
			name: displayName,
			auth: { apiKey: {
				name: "WorkBuddy OAuth bearer token",
				async resolve({ credential }) {
					const apiKey = credential?.key;
					return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
						auth: { apiKey },
						source: "WorkBuddy"
					};
				}
			} },
			models: buildModels(),
			api: openAICompletionsApi()
		}),
		getModels: () => buildModels()
	};
	const profile = {
		provider: providerId,
		displayName,
		streamIdleTimeoutMs: WORKBUDDY_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: options.retryPolicy ?? resolveRetryPolicy(void 0, "dsh-workbuddy-connect retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		...REQUEST_IMAGE_BUDGETS,
		piProvider: provider
	};
	let profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
	const adapterOptions = {
		profiles: () => profiles,
		auth: INERT_AUTH,
		resolveApiKey: async () => shim.token(),
		...resolveAttachments === void 0 ? {} : { resolveAttachments: () => {
			const store = resolveAttachments();
			return store === void 0 ? void 0 : withLegacyImageBudget(store);
		} },
		...resolveImageAccess === void 0 ? {} : { resolveImageAccess }
	};
	return {
		adapter: new WorkBuddyPiAiAdapter(catalog, hidden ?? (() => []), options.defaultEffort ?? (() => void 0), options.prepareAccount, adapterOptions, (requestedProvider, model, signal, scope) => {
			const models = buildModels().filter((entry) => entry.id === model);
			const capturedProvider = {
				...provider,
				getModels: () => models
			};
			const capturedProfiles = /* @__PURE__ */ new Map([[providerId, {
				...profile,
				piProvider: capturedProvider
			}]]);
			return new PiAiAdapter({
				...adapterOptions,
				profiles: () => capturedProfiles,
				...scope === void 0 ? {} : { prepareHeaders: (_request, headers) => {
					headers.set(WORKBUDDY_ACCOUNT_SCOPE_HEADER, scope);
					return headers;
				} }
			}).prepareCall(requestedProvider, model, signal);
		}),
		invalidate: () => {
			profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
		}
	};
}
/**
* The WorkBuddy route's adapter: `PiAiAdapter` with the billing rate folded
* into the catalog answers it returns to the DSH model pickers.
*
* `PiAiAdapter.listModels()` and `.resolveModel()` build their answers straight
* from the pi-ai descriptors, which carry no billing fact, so the rate is
* layered on here by looking the model up in the live catalog. Resolution and
* preparation also share a valid upstream effort default. Prepared dispatch
* uses a separate pi-ai provider holding one captured model descriptor; DSH
* selects its request effort from the matching returned model metadata.
*
* A model missing from the catalog (an id the shim would serve but the last
* upstream refresh did not list) falls through with its name untouched rather
* than being dropped: catalog membership is advisory, and the seam tolerates
* serving an unlisted id.
*/
var WorkBuddyPiAiAdapter = class extends PiAiAdapter {
	catalog;
	hidden;
	defaultEffort;
	prepareAccount;
	prepareSnapshot;
	constructor(catalog, hidden, defaultEffort, prepareAccount, options, prepareSnapshot) {
		super(options);
		this.catalog = catalog;
		this.hidden = hidden;
		this.defaultEffort = defaultEffort;
		this.prepareAccount = prepareAccount;
		this.prepareSnapshot = prepareSnapshot;
	}
	/** Catalog entry for one model id, or undefined when the catalog omits it. */
	infoFor(model) {
		return this.catalog.current().find((entry) => entry.id === model);
	}
	async listModels(provider) {
		await this.prepareAccount?.("read");
		const models = await super.listModels(provider);
		const hidden = new Set(this.hidden());
		return models.flatMap((model) => {
			if (hidden.has(model.id)) return [];
			const info = this.infoFor(model.id);
			if (info === void 0) return [model];
			return [{
				...model,
				name: withCatalogDisplay(model.name, info)
			}];
		});
	}
	/** Apply catalog display and a valid upstream default to either resolution seam. */
	withCatalogInfo(resolved, info, preferred) {
		if (info === void 0) return resolved;
		const effort = resolveDefaultEffort(info, resolved.reasoning?.efforts.map((entry) => entry.id) ?? [], preferred);
		return {
			...resolved,
			name: withCatalogDisplay(resolved.name, info),
			...effort === void 0 || resolved.reasoning === void 0 ? {} : { reasoning: {
				...resolved.reasoning,
				defaultEffort: ReasoningEffortId(effort)
			} }
		};
	}
	async resolveModel(provider, model, signal) {
		await this.prepareAccount?.("read");
		const info = this.infoFor(model);
		const preferred = this.defaultEffort(model);
		return this.withCatalogInfo(await super.resolveModel(provider, model, signal), info, preferred);
	}
	async prepareCall(provider, model, signal) {
		const scope = await this.prepareAccount?.("request", model);
		const info = this.infoFor(model);
		const preferred = this.defaultEffort(model);
		const prepared = await this.prepareSnapshot(provider, model, signal, scope);
		const captured = this.withCatalogInfo(prepared.model, info, preferred);
		return {
			...prepared,
			model: captured,
			stream: (options) => prepared.stream(sanitizeWorkBuddyHistory({
				...options,
				...options.reasoningEffort !== void 0 || captured.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: captured.reasoning.defaultEffort }
			}))
		};
	}
	stream(options) {
		const prepare = this.prepareCall(options.provider, options.model, options.signal);
		return (async function* () {
			yield* (await prepare).stream(options);
		})();
	}
};
// src/credit-log.ts
/** Reads only the credit fields from upstream SSE; the forwarded byte stream is separate. */
var WorkBuddyCreditSseObserver = class WorkBuddyCreditSseObserver {
	static MAX_BUFFER_CHARS = 1048576;
	decoder = new TextDecoder();
	pending = "";
	observed;
	complete = false;
	overflowed = false;
	push(bytes) {
		if (this.overflowed) return;
		this.pending += this.decoder.decode(bytes, { stream: true });
		if (this.pending.length > WorkBuddyCreditSseObserver.MAX_BUFFER_CHARS) {
			this.overflowed = true;
			this.pending = "";
			return;
		}
		this.consumeLines(false);
	}
	finish() {
		this.pending += this.decoder.decode();
		this.consumeLines(true);
		return this.complete && !this.overflowed && this.observed !== void 0 ? this.observed : void 0;
	}
	consumeLines(final) {
		const lines = this.pending.split(/\r?\n/u);
		this.pending = final ? "" : lines.pop() ?? "";
		for (const line of lines) {
			if (!line.startsWith("data:")) continue;
			const payload = line.slice(5).trimStart();
			if (payload === "") continue;
			if (payload === "[DONE]") {
				this.complete = true;
				continue;
			}
			try {
				const value = JSON.parse(payload);
				if (typeof value !== "object" || value === null) continue;
				const event = value;
				const credit = event.usage?.credit;
				if (typeof event.id === "string" && event.id.length > 0 && typeof credit === "number" && Number.isFinite(credit) && credit >= 0) this.observed = {
					responseId: event.id,
					credit
				};
				if (event.choices?.some((choice) => typeof choice.finish_reason === "string" && choice.finish_reason.length > 0)) this.complete = true;
			} catch {}
		}
	}
};
/** Short-lived, bounded join between upstream response ids and host messages. */
var WorkBuddyCreditLog = class {
	limit;
	entries = /* @__PURE__ */ new Map();
	epochValue = 0;
	constructor(limit = 512) {
		this.limit = limit;
		if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("credit log limit must be a positive safe integer");
	}
	get size() {
		return this.entries.size;
	}
	get epoch() {
		return this.epochValue;
	}
	observe(responseId, credit, account, epoch = this.epochValue) {
		if (!validId(responseId) || !validId(account) || epoch !== this.epochValue || !Number.isFinite(credit) || credit < 0) return false;
		const entry = this.getOrCreate(responseId);
		if (entry.account !== void 0 && entry.account !== account) return false;
		entry.account = account;
		entry.credit = credit;
		return entry.messageId !== void 0;
	}
	associate(provider, responseId, sessionId, messageId) {
		if (![
			provider,
			responseId,
			sessionId,
			messageId
		].every(validId)) return false;
		const entry = this.getOrCreate(responseId);
		if (entry.provider !== void 0 && entry.provider !== provider) return false;
		entry.provider = provider;
		entry.sessionId = sessionId;
		entry.messageId = messageId;
		return entry.credit !== void 0;
	}
	read(provider, account, sessionId) {
		const credits = Object.create(null);
		for (const entry of this.entries.values()) if (entry.provider === provider && entry.account === account && entry.sessionId === sessionId && entry.messageId !== void 0 && entry.credit !== void 0) credits[entry.messageId] = entry.credit;
		return {
			sessionId,
			credits
		};
	}
	clear() {
		this.epochValue++;
		this.entries.clear();
	}
	removeSession(provider, sessionId) {
		for (const [responseId, entry] of this.entries) if (entry.provider === provider && entry.sessionId === sessionId) this.entries.delete(responseId);
	}
	getOrCreate(responseId) {
		let entry = this.entries.get(responseId);
		if (entry === void 0) entry = {};
		else this.entries.delete(responseId);
		this.entries.set(responseId, entry);
		while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
		return entry;
	}
};
function validId(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 512;
}
// src/shim.ts
/**
* Loopback OpenAI-compatible endpoint. The pi-ai provider points here; the
* shim applies the WorkBuddy wire quirks (forced streaming, string
* `tool_choice`, CLI-shaped headers) and forwards to the real upstream.
* It binds 127.0.0.1 only and never serves another interface.
*
* Inbound hardening: the loopback bind alone is not a trust boundary (any
* local process or a DNS-rebinding page can reach 127.0.0.1), so every
* request must carry a loopback Host header, browser-sent Origins must be
* loopback, chat POSTs must be application/json, and the Authorization
* header must carry the shim's per-process shared secret. The plugin's
* own client satisfies all four by construction; local attackers cannot
* read the secret out of the plugin process's memory.
*
* @module dsh-workbuddy-connect/shim
*/
const REQUEST_BODY_LIMIT = 67108864;
/** Chat-completion POSTs must carry a JSON body type (simple-request CSRF drops here). */
function isJsonContentType(req) {
	const type = req.headers["content-type"];
	return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}
/** HTTP status each upstream failure class surfaces as. */
const KIND_STATUS = {
	hard_credit: 402,
	model_busy: 429,
	policy_reject: 400,
	channel_reject: 400,
	queue: 400,
	soft_rate: 429,
	session_dead: 401,
	not_found: 502,
	server: 502,
	client: 400
};
/**
* The installed host scans text before using the mapped HTTP status: bare
* 401/403 means AUTH and quota wording wins over rate limits. Fullwidth forms
* retain readable upstream detail without overriding an explicit business code.
* NFKC normalization recovers the original text for diagnostic comparison.
*/
function businessDisplayDetail(detail, kind) {
	if (kind === "session_dead") return detail;
	const fullwidth = (text) => text.replace(/[!-~]/gu, (char) => String.fromCharCode(char.charCodeAt(0) + 65248));
	let safe = detail.replace(/\b(?:401|403)\b/gu, fullwidth);
	if (kind === "model_busy" || kind === "policy_reject" || kind === "channel_reject" || kind === "queue") {
		safe = safe.replace(/\b(?:quota|balance|credits?|budget|usage)\b/giu, fullwidth);
		if (kind !== "model_busy") safe = safe.replace(/\b429\b|rate.?limit/giu, fullwidth);
	}
	return safe;
}
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
function writeOpenAIError(res, status, kind, message) {
	writeJson(res, status, { error: {
		message,
		type: kind,
		code: kind
	} });
}
/** Read a request body with a size cap; over-limit bodies fail the request. */
function readBody$1(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > REQUEST_BODY_LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
/**
* Start the loopback endpoint. Requests carry any bearer; the loopback bind
* is the boundary, and the upstream credential comes from the store alone.
*/
function createWorkBuddyShim(options) {
	const { store, client, catalog } = options;
	const logger = options.logger;
	let accountIdentity;
	let accountGeneration = 0;
	const identifyAccount = (credential) => {
		const identity = `${credential.uid}:${credential.enterpriseId ?? ""}`;
		if (accountIdentity !== identity) {
			accountIdentity = identity;
			accountGeneration++;
		}
		return accountGeneration;
	};
	const SHARED_SECRET = randomBytes(32).toString("base64url");
	/** Constant-time bearer check; absent or mismatched bearers are rejected. */
	function bearerOk(req) {
		const header = req.headers.authorization;
		if (typeof header !== "string") return false;
		const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
		if (match === null) return false;
		const presented = match[1];
		const expected = SHARED_SECRET;
		const a = Buffer.from(presented);
		const b = Buffer.from(expected);
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	}
	const server = createServer((req, res) => {
		handle(req, res);
	});
	const ready = bindToUsablePort(server, {
		host: "127.0.0.1",
		onBlockedPort: (port, attempt) => {
			logger?.warn(`dsh-workbuddy-connect: port ${port} is blocked for fetch; rebinding (attempt ${attempt})`);
		}
	}).then(() => void 0);
	const baseUrl = () => {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("workbuddy shim has no listening address");
		return `http://127.0.0.1:${address.port}`;
	};
	async function handle(req, res) {
		try {
			if (!hostIsLoopback(req.headers.host)) {
				writeOpenAIError(res, 403, "host_not_allowed", "Host header must name the loopback interface");
				return;
			}
			if (!originIsLoopback(req.headers.origin)) {
				writeOpenAIError(res, 403, "origin_not_allowed", "Origin must be a loopback origin");
				return;
			}
			if (!bearerOk(req)) {
				writeOpenAIError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
				return;
			}
			const url = req.url ?? "/";
			if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
				writeJson(res, 200, { ok: true });
				return;
			}
			if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
				writeJson(res, 200, {
					object: "list",
					data: catalog.current().map((model) => ({
						id: model.id,
						object: "model",
						created: 0,
						owned_by: "workbuddy"
					}))
				});
				return;
			}
			if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
				await chatCompletions(req, res);
				return;
			}
			writeOpenAIError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
		} catch {
			if (!res.headersSent) writeOpenAIError(res, 500, "internal", "WorkBuddy request failed internally");
			else res.end();
		}
	}
	async function chatCompletions(req, res) {
		const epochAtRequestStart = options.creditEpoch?.();
		if (!isJsonContentType(req)) {
			writeOpenAIError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
			return;
		}
		let credential;
		try {
			credential = await store.resolve();
		} catch {
			writeOpenAIError(res, 401, "not_signed_in", "WorkBuddy credentials are unavailable; sign in again");
			return;
		}
		const requestAccount = `${credential.uid}:${credential.enterpriseId ?? ""}`;
		if (options.requireAccountScope && req.headers["x-workbuddy-account-scope"] !== workBuddyRequestScope(credential)) {
			res.setHeader("x-should-retry", "false");
			writeOpenAIError(res, 400, "account_changed", "WorkBuddy account changed; refresh the model list and send again");
			return;
		}
		const requestGeneration = epochAtRequestStart ?? identifyAccount(credential);
		const controller = new AbortController();
		const abort = () => controller.abort();
		const abortIfUnfinished = () => {
			if (!res.writableEnded) controller.abort();
		};
		req.once("aborted", abort);
		res.on("close", abortIfUnfinished);
		res.once("finish", () => res.off("close", abortIfUnfinished));
		const raw = (await readBody$1(req)).toString("utf8");
		const prepared = prepareChatBody(raw);
		const result = await client.chatStream(credential, prepared, controller.signal);
		if (options.onOutcome !== void 0) try {
			const model = JSON.parse(prepared)["model"];
			if (typeof model === "string") options.onOutcome({
				credential,
				model,
				...result.ok ? {} : {
					kind: result.kind,
					...upstreamBusinessCode(result.message) === void 0 ? {} : { code: upstreamBusinessCode(result.message) },
					...result.retryAt === void 0 ? {} : { retryAt: result.retryAt }
				}
			});
		} catch {}
		if (!result.ok) {
			const detail = businessDisplayDetail(extractDisplayErrorMessage(result.message) ?? result.message.slice(0, 400), result.kind);
			let businessCode = "";
			if (detail.includes("请求被拦截")) try {
				const response = JSON.parse(result.message);
				const code = upstreamBusinessCode(result.message);
				if (code !== void 0 && code >= 1e4 && code <= 99999) {
					const reason = code === 11128 && typeof response.msg === "string" ? {
						"illegal api invocation from an unapproved channel": "unapproved-channel",
						"first message is not system prompt": "first-system-missing",
						"conversation id missing": "conversation-id-missing"
					}[response.msg.trim().toLowerCase()] : void 0;
					let systemPhrase = "";
					if (reason === "unapproved-channel") {
						const request = JSON.parse(prepared);
						systemPhrase = `; system-phrase-present ${(Array.isArray(request.messages) ? request.messages : []).some((message) => {
							if (message?.role !== "system") return false;
							const content = message.content;
							if (typeof content === "string") return /DeepSeek Harness/iu.test(content);
							return Array.isArray(content) && content.some((block) => typeof block?.text === "string" && /DeepSeek Harness/iu.test(block.text));
						}) ? "yes" : "no"}`;
					}
					businessCode = ` [upstream code ${code}${reason === void 0 ? "" : `; reason ${reason}`}${systemPhrase}]`;
				}
			} catch {}
			const businessFailure = [
				"model_busy",
				"hard_credit",
				"policy_reject",
				"channel_reject",
				"queue"
			].includes(result.kind);
			const status = businessFailure ? KIND_STATUS[result.kind] : result.status;
			const statusNote = (status === 401 || status === 403) && result.kind !== "session_dead" ? "" : ` (http ${status})`;
			if (businessFailure) res.setHeader("x-should-retry", "false");
			const quotaHint = result.kind === "hard_credit" ? " (insufficient credits)" : "";
			writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, `workbuddy upstream ${result.kind}${statusNote}${quotaHint}: ${detail}${businessCode}`);
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no"
		});
		const body = Readable.fromWeb(result.response.body);
		const creditObserver = options.onCredit === void 0 && options.onCreditScoped === void 0 ? void 0 : new WorkBuddyCreditSseObserver();
		if (creditObserver !== void 0) {
			body.on("data", (chunk) => creditObserver.push(chunk));
			body.once("end", () => {
				if ((options.creditEpoch?.() ?? accountGeneration) !== requestGeneration) return;
				const observed = creditObserver.finish();
				if (observed === void 0) return;
				options.onCreditScoped?.(observed.responseId, observed.credit, requestAccount, requestGeneration);
				options.onCredit?.(observed.responseId, observed.credit);
			});
		}
		body.on("error", () => {
			if (!controller.signal.aborted) logger?.warn("dsh-workbuddy-connect: upstream stream interrupted");
			if (!res.destroyed && !res.writableEnded) res.destroy();
		});
		body.pipe(res);
	}
	return {
		ready,
		baseUrl,
		token: () => SHARED_SECRET,
		close: () => new Promise((resolve, reject) => {
			server.close(() => resolve());
			server.closeAllConnections();
			server.once("error", reject);
		})
	};
}
// src/credit-session.ts
/** Join completed host messages synchronously and retire joins with session lifetime. */
function watchWorkBuddyCreditSessions(ctx, runtimes) {
	let active = true;
	const live = /* @__PURE__ */ new Map();
	ctx.inject(["sessions"], (sessionsCtx) => {
		if (!active) return;
		const disposeCreated = sessionsCtx.on("session/created", (session) => {
			if (active) live.set(session.id, Symbol());
		});
		const disposeEvent = sessionsCtx.on("session/event", (session, event) => {
			if (!active || live.get(session.id) === void 0 || event.type !== "assistant/message" || event.data.interrupted === true) return;
			const source = event.data.message.source;
			const responseId = source.replayState?.response?.responseId;
			if (typeof responseId !== "string" || responseId.length === 0) return;
			const runtime = runtimes.find((candidate) => candidate.provider === source.provider);
			runtime?.log.associate(runtime.provider, responseId, session.id, event.data.message.id);
		});
		const disposeSession = sessionsCtx.on("session/disposed", (session) => {
			live.delete(session.id);
			for (const runtime of runtimes) runtime.log.removeSession(runtime.provider, session.id);
		});
		for (const session of sessionsCtx.sessions.list()) live.set(session.id, Symbol());
		return () => {
			live.clear();
			for (const runtime of runtimes) runtime.log.clear();
			disposeCreated();
			disposeEvent();
			disposeSession();
		};
	});
	ctx.effect(() => () => {
		active = false;
		live.clear();
		for (const runtime of runtimes) runtime.log.clear();
	});
}
// src/credit-route.ts
/** Register the authenticated read-only route for one provider's observed costs. */
function registerWorkBuddyCreditRoute(ctx, options) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: options.path,
		handler: withWorkBuddyHostAuth(ctx, async (req, res) => {
			if (req.method !== "GET") {
				res.writeHead(405, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "method not allowed" }));
				return;
			}
			if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
				res.writeHead(403, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "request-not-trusted" }));
				return;
			}
			const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("sessionId");
			const account = options.account();
			if (sessionId === null || sessionId.length === 0 || sessionId.length > 512 || account === void 0) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "invalid_request" }));
				return;
			}
			const body = JSON.stringify(options.log.read(options.provider, account, sessionId));
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(body)
			});
			res.end(body);
		})
	}));
}
// src/probe-store.ts
/**
* Local record of reasoning-effort probes.
*
* What this stores is an *observation*, never a claim about the upstream: a
* model's row is only consulted when the catalog carries no explicit
* `supportedEfforts` set, and it always loses to a declared set. The plan this
* implements (`docs/reasoning-effort-probe-plan.md` §5) requires that a result
* is invalidated whenever the model's catalog row changes, so every record
* carries a fingerprint of the fields the probe depended on.
*
* The file lives beside the plugin's own credential copy under `$DSH_HOME`,
* never in the desktop app's files, and carries no token, prompt, or response
* body — only model ids, effort spellings, and timestamps.
*
* @module dsh-workbuddy-connect/probe-store
*/
/** Basename of the probe record inside the Harness home. */
const WORKBUDDY_PROBE_FILENAME = ".workbuddy-probe.json";
/**
* On-disk format this reader accepts; other versions are discarded.
*
* Version 2 nested the records under the account that produced them
* (`records[account][modelId]`), so two accounts no longer overwrite each
* other's observations for the same model. Version 1 files (flat, one record
* per model) are deliberately not migrated: they read as empty and the
* affected models are re-probed on demand, which keeps the reader free of
* half-understood compatibility paths.
*/
const PROBE_FORMAT_VERSION = 2;
/**
* How long an observation stays usable. Conservative on purpose: the plan's
* whole argument is that upstream metadata moves fast, so a result that has
* outlived its fingerprint's usefulness should not quietly keep granting a
* picker entry.
*/
const DEFAULT_TTL_MS = 12096e5;
/**
* Plugin-owned probe record path inside the Harness home.
*
* One file per variant. Same-named models exist on both endpoints (the
* international catalog repeats `glm-5.3`, `glm-5.2`, `hy3`, `kimi-k2.6`), and
* {@link fingerprintModel} covers only `id`/`reasoning`/`supportsImages` —
* never the provider — so a single shared file would let one variant's
* observation answer for the other. The paths differ; the format does not.
*/
function workbuddyProbePath(filename = WORKBUDDY_PROBE_FILENAME) {
	return join(resolveDshHome(), filename);
}
/**
* Fingerprint the catalog fields a probe depends on.
*
* Deliberately excludes display-only fields (`name`, `billing`, `contextWindow`)
* so a rename or a promo badge does not throw away a valid observation, and
* deliberately includes the whole reasoning object so any change to the
* declared shape re-probes.
*/
function fingerprintModel(info) {
	const basis = JSON.stringify({
		id: info.id,
		reasoning: info.reasoning ?? null,
		supportsImages: info.supportsImages ?? null
	});
	return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}
/** Read-and-validate the documents on disk; anything malformed reads as empty. */
function readDocument(path) {
	if (!existsSync(path)) return void 0;
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const wrapped = parsed;
	if (wrapped["version"] !== PROBE_FORMAT_VERSION) return void 0;
	const records = wrapped["records"];
	if (typeof records !== "object" || records === null || Array.isArray(records)) return void 0;
	return parsed;
}
/** One record's shape check; a bad row is dropped rather than trusted. */
function isRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const wrapped = value;
	const validation = wrapped["validation"];
	if (validation !== "validating" && validation !== "non-validating" && validation !== "unknown") return false;
	if (typeof wrapped["fingerprint"] !== "string") return false;
	if (typeof wrapped["probedAtMs"] !== "number" || !Number.isFinite(wrapped["probedAtMs"])) return false;
	if (typeof wrapped["pluginVersion"] !== "string") return false;
	if (typeof wrapped["account"] !== "string" || wrapped["account"] === "") return false;
	const efforts = wrapped["efforts"];
	if (!Array.isArray(efforts) || efforts.some((effort) => typeof effort !== "string")) return false;
	return true;
}
/**
* The plugin's probe records: read once, written atomically, keyed by the
* account that produced each observation, and never trusted across a
* fingerprint change or past the TTL.
*/
var WorkBuddyProbeStore = class {
	path;
	ttlMs;
	pluginVersion;
	now;
	records;
	constructor(options) {
		const opts = typeof options === "string" ? {
			path: options,
			pluginVersion: "0.0.0"
		} : options;
		this.path = opts.path ?? workbuddyProbePath();
		this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		this.pluginVersion = opts.pluginVersion;
		this.now = opts.now ?? (() => Date.now());
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.records === void 0) {
			const document = readDocument(this.path);
			const records = Object.create(null);
			for (const [account, bucket] of Object.entries(document?.records ?? {})) {
				if (typeof bucket !== "object" || bucket === null || Array.isArray(bucket)) continue;
				const parsed = Object.create(null);
				for (const [modelId, record] of Object.entries(bucket)) if (isRecord(record)) parsed[modelId] = record;
				records[account] = parsed;
			}
			this.records = records;
		}
		return this.records;
	}
	/**
	* The usable record for one account and model, or `undefined` when there is
	* none, it is expired, it was taken against a different catalog row, or it
	* belongs to a different account.
	*
	* @param account - the account in effect, as `uid:enterpriseId`. Records are
	*   only returned for the account that produced them.
	*/
	get(modelId, fingerprint, account) {
		const record = this.load()[account]?.[modelId];
		if (record === void 0) return void 0;
		if (record.fingerprint !== fingerprint) return void 0;
		if (record.account !== account) return void 0;
		if (this.now() - record.probedAtMs > this.ttlMs) return void 0;
		return record;
	}
	/**
	* Store one observation under the account stamped on it. Only a decisive
	* answer (`validating` / `non-validating`) replaces an existing decisive
	* record *of the same account*: a transient `unknown` must not erase
	* knowledge the user already paid for.
	*/
	set(modelId, record) {
		const records = this.load();
		let bucket = records[record.account];
		if (bucket === void 0) {
			bucket = Object.create(null);
			Object.defineProperty(records, record.account, {
				value: bucket,
				enumerable: true,
				writable: true,
				configurable: true
			});
		}
		const existing = bucket[modelId];
		if (record.validation === "unknown" && existing !== void 0 && existing.fingerprint === record.fingerprint && existing.validation !== "unknown") return;
		Object.defineProperty(bucket, modelId, {
			value: record,
			enumerable: true,
			writable: true,
			configurable: true
		});
		this.persist();
	}
	/** Drop every record of every account; used by the card's explicit "clear" action. */
	clear() {
		this.records = Object.create(null);
		this.persist();
	}
	/** Every record currently held, grouped by account, for status display. */
	all() {
		const records = this.load();
		return Object.fromEntries(Object.entries(records).map(([account, bucket]) => [account, { ...bucket }]));
	}
	/** Build a record stamped with this store's clock, version, and account. */
	record(fingerprint, validation, efforts, account) {
		return {
			fingerprint,
			validation,
			efforts: validation === "validating" ? [...efforts] : [],
			probedAtMs: this.now(),
			pluginVersion: this.pluginVersion,
			account
		};
	}
	/**
	* Write through a temporary file and rename, so a crash mid-write cannot
	* leave a half-parsed document that reads as "no records" and silently drops
	* every observation.
	*/
	persist() {
		const directory = dirname(this.path);
		try {
			if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
			const document = {
				version: PROBE_FORMAT_VERSION,
				records: this.load()
			};
			const temporary = resolve(`${this.path}.tmp`);
			writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 384 });
			renameSync(temporary, this.path);
		} catch {}
	}
};
/**
* Order observations newest-first for display.
*
* The store keeps insertion order so the file reads chronologically, but the
* card wants the most recent detection at the top: a sweep the user just ran
* should not appear below every earlier one, which is what appending to an
* insertion-ordered list does.
*/
function newestFirst(records) {
	return [...records].sort((a, b) => b.probedAt - a.probedAt);
}
// src/probe-service.ts
/**
* Serial probe runner. One instance is shared by the manual API and any
* future automatic trigger, so the two can never overlap.
*/
var WorkBuddyProbeService = class {
	options;
	queue = Promise.resolve();
	pending = /* @__PURE__ */ new Map();
	running = false;
	constructor(options) {
		this.options = options;
	}
	/** Whether a sweep is in flight right now. */
	isRunning() {
		return this.running;
	}
	/**
	* The record the adapter may use for this model, or `undefined`.
	*
	* Applies the plan's precedence (§5): a declared set always wins, so a model
	* that declares `supportedEfforts` is never answered from an observation.
	*/
	recordFor(modelId) {
		const info = this.options.catalog.current().find((model) => model.id === modelId);
		if (info === void 0) return void 0;
		if (info.reasoning?.supportedEfforts !== void 0 && info.reasoning.supportedEfforts.length > 0) return;
		const account = this.options.account();
		if (account === void 0) return void 0;
		return this.options.store.get(modelId, fingerprintModel(info), account);
	}
	/**
	* Probe one model, serially.
	*
	* The authenticated manual route supplies one-request consent after UI
	* confirmation. Other callers must pass the configured consent gate.
	* Manual consent never changes the automatic-probing configuration.
	* Explicit requests bypass historical results, but share an ongoing run.
	*/
	async probe(modelId, manualConsent = false) {
		if (!manualConsent && !this.options.consent()) return {
			state: "unavailable",
			reason: "probing is not authorized"
		};
		if (this.options.catalog.current().find((model) => model.id === modelId) === void 0) return {
			state: "unavailable",
			reason: `unknown model: ${modelId}`
		};
		const account = this.options.account();
		if (account === void 0) return {
			state: "unavailable",
			reason: "no WorkBuddy credential"
		};
		const pendingKey = JSON.stringify([account, modelId]);
		const pending = this.pending.get(pendingKey);
		if (pending !== void 0) return pending;
		const run = this.queue.then(async () => {
			const current = this.options.catalog.current().find((model) => model.id === modelId);
			if (current === void 0) return {
				state: "unavailable",
				reason: `unknown model: ${modelId}`
			};
			if (!manualConsent && !this.options.consent()) return {
				state: "unavailable",
				reason: "probing is not authorized"
			};
			if (current.reasoning?.supports !== true || (current.reasoning.supportedEfforts?.length ?? 0) > 0) return {
				state: "unavailable",
				reason: "model does not need detection"
			};
			const cached = this.recordFor(modelId);
			if (!manualConsent && cached !== void 0 && cached.validation !== "unknown") return {
				state: "ok",
				validation: cached.validation,
				efforts: cached.efforts,
				requests: 0
			};
			if (this.options.account() !== account) return {
				state: "unavailable",
				reason: "account changed before detection"
			};
			const credential = await this.options.credentials.current();
			if (credential === void 0) return {
				state: "unavailable",
				reason: "no WorkBuddy credential"
			};
			const send = this.options.send === void 0 ? (effort, signal) => this.options.client.probeEffort(credential, modelId, effort, signal) : this.options.send(modelId);
			this.running = true;
			try {
				const outcome = await probeModel({
					send,
					region: this.options.region,
					...this.options.sentinel === void 0 ? {} : { sentinel: this.options.sentinel }
				});
				if (this.options.account() !== account) return {
					state: "unavailable",
					reason: "account changed during detection"
				};
				const record = this.options.store.record(fingerprintModel(current), outcome.validation, outcome.efforts, account);
				this.options.store.set(modelId, record);
				if (outcome.validation === "unknown") return {
					state: "unavailable",
					reason: outcome.reason
				};
				return {
					state: "ok",
					validation: outcome.validation,
					efforts: record.efforts,
					requests: outcome.requests
				};
			} finally {
				this.running = false;
			}
		});
		this.queue = run.catch(() => void 0);
		this.pending.set(pendingKey, run);
		try {
			return await run;
		} finally {
			this.pending.delete(pendingKey);
		}
	}
};
// src/pi-ai-guard.ts
/**
* Confirm the pi-ai copy this plugin actually loaded is the exact generation
* pinned in the build manifest and exercised against the supported DSH hosts.
*
* #92's failure mode: a pnpm profile with `nodeLinker: hoisted` and
* `autoInstallPeers: false` installs no peer for us, so a co-installed
* plugin's older pi-ai sits at the profile root and wins bare-specifier
* resolution. The host then adds a system message (pi-ai 0.87's
* `collapseSystemMessages`) and the older copy answers `estimateMessageTokens`
* by reading `.length` off a block it does not model — every request dies at
* `PI_AI_ERROR` before any upstream HTTP. Declaring pi-ai as a regular
* dependency (package.json) is the fix; this module exists so a future
* regression reports *what* it loaded instead of that opaque crash.
*
* It is deliberately a warning, not a throw. The plugin is mid-load at this
* point, and a hard failure here would take down a host that may still be able
* to serve other providers. The message is the product; the operator decides.
*
* @module dsh-workbuddy-connect/pi-ai-guard
*/
/** Exact manifest pin injected by the build and exercised by the integration suite. */
const REQUIRED_PI_AI_VERSION = "1.5.0";
/**
* Read the version of the pi-ai copy Node resolves for *this* module.
*
* The package's exports map does not open `./package.json`, so the manifest
* cannot be imported. Instead the module's own specifier is resolved and the
* resulting file is walked up to the directory whose `package.json` names
* `@earendil-works/pi-ai`. That reads the copy actually loaded rather than a
* guess from the install tree.
*
* @returns The resolved version, or undefined when it cannot be determined.
*/
function resolvedPiAiVersion() {
	let entry;
	try {
		entry = import.meta.resolve("@earendil-works/pi-ai");
	} catch {
		return;
	}
	let dir = dirname(fileURLToPath(entry));
	for (let step = 0; step < 5; step += 1) {
		try {
			const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			if (manifest.name === "@earendil-works/pi-ai" && typeof manifest.version === "string") return manifest.version;
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
}
/**
* One line describing a pi-ai copy that is not the required generation, or
* undefined when the resolved version matches or cannot be read.
*
* The cause is left open on purpose. A hoisted profile root is the case #92
* measured, but an updater or installer can just as easily leave the wrong copy
* in place, and this diagnostic cannot tell them apart from a version string.
* Naming both versions and the remedy is what the reader can act on; naming only
* versions and the fix also keeps any filesystem path out of logs and reports.
*
* Carries no plugin prefix: callers log it under their own.
*
* @param resolved - Version to report on. Read from the live module graph when
* omitted; pass it explicitly to describe a hypothetical copy.
*/
function piAiVersionWarning(resolved) {
	const version = arguments.length === 0 ? resolvedPiAiVersion() : resolved;
	if (version === void 0 || version === "1.5.0") return void 0;
	return `loaded @earendil-works/pi-ai ${version}, but this plugin is built for ${REQUIRED_PI_AI_VERSION}. The wrong copy is being resolved — check the profile's pi-ai install (a pnpm profile with nodeLinker "hoisted" and autoInstallPeers false can expose another package's older copy). Reinstalling the plugin so it installs its own ${REQUIRED_PI_AI_VERSION} copy resolves it`;
}
// src/web-status.ts
function json$2(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/**
* The request must be addressed to the loopback interface, and a
* browser-attached Origin must be loopback too. The Host check drops
* DNS-rebinding pages (their Host is the attacker's domain, not loopback);
* the card's same-origin fetches carry no Origin and pass on Host alone.
*/
function loopbackRequest(req) {
	return hostIsLoopback(req.headers.host) && originIsLoopback(req.headers.origin);
}
/**
* Assemble the card's status document. Sign-in state is read-only; credit is
* a live billing answer whose failure degrades to `creditsError` rather than
* failing the whole document.
*/
async function workBuddyWebStatus(deps) {
	await deps.beforeRead?.();
	const authStatus = await deps.store.status();
	if (authStatus.state !== "signed-in") return {
		status: "signed-out",
		...authStatus.reason === void 0 ? {} : { reason: authStatus.reason },
		...authStatus.reasonCode === void 0 ? {} : { reasonCode: authStatus.reasonCode }
	};
	const status = {
		status: "signed-in",
		...authStatus.nickname === void 0 ? {} : { nickname: authStatus.nickname },
		...authStatus.domain === void 0 || authStatus.domain === "" ? {} : { domain: authStatus.domain },
		...authStatus.source === void 0 ? {} : { source: authStatus.source },
		...authStatus.expiresAtMs === void 0 ? {} : { expiresAt: authStatus.expiresAtMs }
	};
	const modelsField = deps.models().map((model) => {
		const rate = normalizeCredits(model.billing?.credits);
		const reasoning = resolveEfforts(model, deps.observe?.(model.id), deps.region ?? "cn");
		const saved = deps.defaultEffort?.(model.id);
		const preferred = saved !== void 0 && reasoning.efforts.includes(saved) ? saved : void 0;
		const upstreamDefault = resolveDefaultEffort(model, reasoning.efforts);
		const effective = resolveDefaultEffort(model, reasoning.efforts, preferred);
		const availability = deps.availability?.(model.id);
		const supported = model.supportedContextWindows ?? [];
		const maxContextWindow = supported.length > 0 ? Math.max(...supported) : void 0;
		const defaultContextWindow = model.defaultContextWindow ?? model.contextWindow;
		return {
			id: model.id,
			name: model.name,
			...availability === void 0 ? {} : { availability },
			...model.promotionProvenance === void 0 ? {} : { promotion: promotionFacts(model, model.promotionProvenance) },
			...model.billing?.free === true ? { free: true } : {},
			...model.billing?.badges !== void 0 && model.billing.badges.length > 0 ? { badges: model.billing.badges } : {},
			...rate === void 0 ? {} : { credits: rate },
			...model.billing?.rateUnknown === true ? { rateUnknown: true } : {},
			...reasoning.source === "declared" ? { declaredEfforts: reasoning.efforts } : {},
			...reasoning.efforts.length > 0 ? { availableEfforts: reasoning.efforts } : {},
			...upstreamDefault === void 0 ? {} : { upstreamDefaultEffort: upstreamDefault },
			...preferred === void 0 ? {} : { savedDefaultEffort: preferred },
			...effective === void 0 ? {} : { defaultEffort: effective },
			...typeof model.contextWindow === "number" && model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {},
			...typeof defaultContextWindow === "number" && defaultContextWindow > 0 && defaultContextWindow < model.contextWindow ? { defaultContextWindow } : {},
			...maxContextWindow === void 0 || maxContextWindow <= defaultContextWindow ? {} : { maxContextWindow },
			...supported.length > 1 ? { supportedContextWindows: supported } : {},
			...typeof model.maxInputTokens === "number" && model.maxInputTokens > 0 ? { maxInputTokens: model.maxInputTokens } : {}
		};
	});
	const catalog = deps.catalog?.();
	const withCatalog = catalog === void 0 ? status : {
		...status,
		catalog
	};
	const visibility = deps.visibility?.();
	const withVisibility = visibility === void 0 ? withCatalog : {
		...withCatalog,
		visibility
	};
	const statusWithModels = modelsField.length > 0 ? {
		...withVisibility,
		models: modelsField
	} : withVisibility;
	let probed = statusWithModels;
	if (deps.probe !== void 0) {
		const maximumContextWindow = deps.useMaximumContextWindow?.();
		probed = {
			...statusWithModels,
			probe: deps.probe(),
			...deps.probeKey === void 0 ? {} : { probeKey: deps.probeKey },
			...maximumContextWindow === void 0 ? {} : { useMaximumContextWindow: maximumContextWindow }
		};
	}
	try {
		const credential = await deps.store.current();
		if (credential !== void 0) {
			const credits = await deps.client.fetchCredits(credential);
			return {
				...probed,
				credits
			};
		}
	} catch {
		return {
			...probed,
			creditsError: "credits-unavailable"
		};
	}
	return probed;
}
/** The status route's request handler, extracted so tests can mount it on a bare server. */
function workBuddyStatusHandler(deps) {
	return async (req, res) => {
		if (req.method !== "GET") {
			json$2(res, 405, { error: "method not allowed" });
			return;
		}
		if (!loopbackRequest(req)) {
			json$2(res, 403, { error: "request-not-trusted" });
			return;
		}
		try {
			json$2(res, 200, await workBuddyWebStatus(deps));
		} catch {
			json$2(res, 500, { error: "status-unavailable" });
		}
	};
}
/** Mount the GET status route on an optional webServer context. */
function registerWorkBuddyStatusRoute(ctx, deps) {
	const path = deps.path ?? "/plugins/dsh-workbuddy-connect/status";
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path,
			handler: withWorkBuddyHostAuth(ctx, workBuddyStatusHandler(deps))
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: Web status route");
}
// src/update.ts
/**
* Public, bounded stable-release checks for the community repository.
* GitHub Releases supplies both version evidence and notes. No credentials
* are sent. Missing release evidence fails unavailable, never up-to-date.
* Host/browser shared and dependency-free.
* @module dsh-workbuddy-connect-community/update
*/
const WORKBUDDY_REPOSITORY_URL = "https://github.com/tangyixiao/dsh-workbuddy-connect-community";
const WORKBUDDY_UPDATE_RELEASES_API_URL = `${WORKBUDDY_REPOSITORY_URL.replace("https://github.com", "https://api.github.com/repos")}/releases?per_page=100`;
const WORKBUDDY_RELEASE_PAGE_BASE = `${WORKBUDDY_REPOSITORY_URL}/releases/tag/`;
const WORKBUDDY_UPDATE_MAX_RELEASES_BYTES = 1048576;
/** GitHub caps one page at 100 releases; ours is far below that today. */
const RELEASES_LIST_MAX = 100;
const RELEASE_NAME_MAX_CHARS = 200;
const RELEASE_NOTES_MAX_CHARS = 16e3;
/** Parse one exact SemVer version, accepting the conventional leading `v`. */
function parseWorkBuddyVersion(raw) {
	if (typeof raw !== "string") return void 0;
	const normalized = raw.startsWith("v") ? raw.slice(1) : raw;
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(normalized);
	if (match === null) return void 0;
	const rawPrerelease = match[4] === void 0 ? [] : match[4].split(".");
	if (rawPrerelease.some((identifier) => /^\d+$/u.test(identifier) && !/^(0|[1-9]\d*)$/u.test(identifier))) return void 0;
	const prerelease = rawPrerelease.map((identifier) => /^(0|[1-9]\d*)$/u.test(identifier) ? Number(identifier) : identifier);
	if (prerelease.some((identifier) => typeof identifier === "number" && !Number.isSafeInteger(identifier))) return void 0;
	const parsed = {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease
	};
	return [
		parsed.major,
		parsed.minor,
		parsed.patch
	].every(Number.isSafeInteger) ? parsed : void 0;
}
/**
* One canonical spelling per SemVer value: leading `v` and build metadata
* fold away, so `v0.6.4`, `0.6.4`, and `0.6.4+build` dedupe as one release.
* Returns `undefined` for unparseable input; callers drop those first.
*/
function canonicalWorkBuddyVersion(version) {
	const parsed = parseWorkBuddyVersion(version);
	if (parsed === void 0) return void 0;
	return `${String(parsed.major)}.${String(parsed.minor)}.${String(parsed.patch)}` + (parsed.prerelease.length === 0 ? "" : `-${parsed.prerelease.join(".")}`);
}
function compareIdentifiers(left, right) {
	if (typeof left === "number" && typeof right === "number") return left < right ? -1 : left > right ? 1 : 0;
	if (typeof left === "number") return -1;
	if (typeof right === "number") return 1;
	return left < right ? -1 : left > right ? 1 : 0;
}
/** Compare two versions using SemVer precedence (build metadata ignored). */
function compareWorkBuddyVersions(left, right) {
	const a = parseWorkBuddyVersion(left);
	const b = parseWorkBuddyVersion(right);
	if (a === void 0 || b === void 0) throw new TypeError("invalid WorkBuddy Connect version");
	for (const [aPart, bPart] of [
		[a.major, b.major],
		[a.minor, b.minor],
		[a.patch, b.patch]
	]) if (aPart !== bPart) return aPart < bPart ? -1 : 1;
	if (a.prerelease.length === 0 && b.prerelease.length !== 0) return 1;
	if (a.prerelease.length !== 0 && b.prerelease.length === 0) return -1;
	for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
		const aPart = a.prerelease[index];
		const bPart = b.prerelease[index];
		if (aPart === void 0) return -1;
		if (bPart === void 0) return 1;
		const comparison = compareIdentifiers(aPart, bPart);
		if (comparison !== 0) return comparison;
	}
	return 0;
}
function boundedText(value, maxBytes) {
	if (new TextEncoder().encode(value).byteLength > maxBytes) throw new RangeError("update response is too large");
	return value;
}
async function readBoundedText(response, maxBytes) {
	if (response.body === null) return boundedText(await response.text(), maxBytes);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			total += next.value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new RangeError("update response is too large");
			}
			chunks.push(decoder.decode(next.value, { stream: true }));
		}
		chunks.push(decoder.decode());
		return chunks.join("");
	} finally {
		reader.releaseLock();
	}
}
async function fetchBounded(fetchImpl, url, maxBytes, timeoutMs, headers) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort(/* @__PURE__ */ new Error("update request timed out"));
	}, timeoutMs);
	try {
		const response = await fetchImpl(url, {
			headers,
			signal: controller.signal,
			credentials: "omit",
			redirect: "error"
		});
		return {
			response,
			text: await readBoundedText(response, maxBytes)
		};
	} finally {
		clearTimeout(timer);
	}
}
/** Strip control characters, normalize newlines, and cap the length. */
function cleanReleaseText(value, maxLength) {
	if (typeof value !== "string" || value.length === 0) return void 0;
	const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").replace(/\r\n?/gu, "\n").trim().slice(0, maxLength);
	return clean.length === 0 ? void 0 : clean;
}
function cleanPublishedAt(value) {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/iu.test(value) ? value.slice(0, 64) : void 0;
}
function releaseTagUrl(tag) {
	return `${WORKBUDDY_RELEASE_PAGE_BASE}${encodeURIComponent(tag)}`;
}
/**
* Parse GitHub's release-list page into stable releases, newest first.
* Unknown entry shapes are skipped, never fatal: the count and the notes both
* degrade per-entry rather than dropping the whole judgement.
*/
function stableReleases(value) {
	if (!Array.isArray(value) || value.length > RELEASES_LIST_MAX) return void 0;
	const releases = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of value) {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
		const entry = raw;
		if (entry["draft"] !== false || entry["prerelease"] !== false) continue;
		const tag = entry["tag_name"];
		if (typeof tag !== "string") continue;
		const version = parseWorkBuddyVersion(tag);
		if (version === void 0 || version.prerelease.length !== 0) continue;
		const canonical = canonicalWorkBuddyVersion(tag);
		if (canonical === void 0 || seen.has(canonical)) continue;
		seen.add(canonical);
		const name = cleanReleaseText(entry["name"], RELEASE_NAME_MAX_CHARS);
		const notes = cleanReleaseText(entry["body"], RELEASE_NOTES_MAX_CHARS);
		const publishedAt = cleanPublishedAt(entry["published_at"]);
		releases.push({
			version: tag,
			...name === void 0 ? {} : { name },
			...notes === void 0 ? {} : { notes },
			...publishedAt === void 0 ? {} : { publishedAt }
		});
	}
	releases.sort((left, right) => compareWorkBuddyVersions(right.version, left.version));
	return releases;
}
/** Check the community repository's bounded public stable-release list. */
async function checkWorkBuddyUpdate(options) {
	const { currentVersion } = options;
	if (parseWorkBuddyVersion(currentVersion) === void 0) return {
		status: "unavailable",
		currentVersion,
		reason: "invalid-current-version"
	};
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 8e3;
	let metadata;
	try {
		const { response, text } = await fetchBounded(fetchImpl, WORKBUDDY_UPDATE_RELEASES_API_URL, WORKBUDDY_UPDATE_MAX_RELEASES_BYTES, timeoutMs, { accept: "application/vnd.github+json" });
		if (!response.ok) return {
			status: "unavailable",
			currentVersion,
			reason: "registry-unavailable"
		};
		metadata = JSON.parse(text);
	} catch (error) {
		return {
			status: "unavailable",
			currentVersion,
			reason: error instanceof SyntaxError || error instanceof RangeError ? "invalid-registry-response" : "registry-unavailable"
		};
	}
	const stable = stableReleases(metadata);
	const latest = stable?.[0];
	if (stable === void 0 || latest === void 0) return {
		status: "unavailable",
		currentVersion,
		reason: "invalid-registry-response"
	};
	const latestVersion = canonicalWorkBuddyVersion(latest.version);
	if (compareWorkBuddyVersions(latestVersion, currentVersion) <= 0) return {
		status: "up-to-date",
		currentVersion,
		latestVersion: currentVersion
	};
	const releases = stable.filter((release) => compareWorkBuddyVersions(release.version, currentVersion) > 0);
	return {
		status: "update-available",
		currentVersion,
		latestVersion,
		releaseUrl: releaseTagUrl(latest.version),
		releases,
		versionsBehind: releases.length
	};
}
// src/update-route.ts
function json$1(res, status, value) {
	const payload = JSON.stringify(value);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff"
	});
	res.end(payload);
}
/** The same browser-origin gate the status route uses: DNS-rebinding pages die here. */
function browserRequestAllowed(req) {
	return hostIsLoopback(req.headers.host) && originIsLoopback(req.headers.origin);
}
/** Build the route handler; the caller owns registration and disposal. */
function workBuddyUpdateHandler(options) {
	return async (req, res) => {
		if (req.method !== "GET") {
			json$1(res, 405, { error: "method not allowed" });
			return;
		}
		if (!browserRequestAllowed(req)) {
			json$1(res, 403, { error: "forbidden" });
			return;
		}
		let result;
		try {
			result = await checkWorkBuddyUpdate({
				currentVersion: options.currentVersion,
				...options.fetchImpl === void 0 ? {} : { fetchImpl: options.fetchImpl },
				timeoutMs: options.timeoutMs ?? 8e3
			});
		} catch {
			result = {
				status: "unavailable",
				currentVersion: options.currentVersion,
				reason: "registry-unavailable"
			};
		}
		json$1(res, 200, options.manifestVersion === void 0 || options.manifestVersion === options.currentVersion ? result : {
			...result,
			manifestVersion: options.manifestVersion
		});
	};
}
/** Register the update route on the optional host web server. */
function registerWorkBuddyUpdateRoute(ctx, options) {
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_UPDATE_PATH,
			handler: workBuddyUpdateHandler(options)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: update route");
}
// src/probe-route.ts
/**
* Probe control route: the only state-changing endpoint the plugin exposes.
*
* The registered route requires Host owner authentication before these
* additional guards. Loopback headers and the control key do not prove identity:
*
* 1. **Loopback Host + Origin**, shared with the status route. This drops
*    DNS-rebinding pages, whose requests arrive addressed to the attacker's
*    domain.
* 2. **An in-process random key**, minted per process and handed only to the
*    authenticated card. A leaked key alone cannot authorize requests.
*
* A probe request is never accepted with a prompt, a model id outside the
* live catalog, or a sentinel from the browser: it is assembled entirely
* host-side. (Scope: the `probe` action only — `set-model-visibility`
* deliberately accepts a model id the current catalog no longer lists, since
* a hidden id is kept for when the model returns.)
*
* @module dsh-workbuddy-connect/probe-route
*/
/** Largest control body accepted; these payloads are a few dozen bytes. */
const MAX_BODY_BYTES = 4096;
/** Mint the per-process control key. */
function createProbeKey() {
	return randomBytes(24).toString("hex");
}
/**
* Constant-time key comparison; a length mismatch is a failure, not a crash.
*/
function keyMatches(expected, presented) {
	if (presented === void 0 || presented.length !== expected.length) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(presented);
	return a.length === b.length && timingSafeEqual(a, b);
}
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/** Read the request body with a hard ceiling. */
async function readBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES) return void 0;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/** Parse and shape-check an action; unknown fields are ignored, not trusted. */
function parseAction(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const wrapped = parsed;
	const action = wrapped["action"];
	if (action === "clear") return { action: "clear" };
	if (action === "refresh") return { action: "refresh" };
	if (action === "set-maximum-context-window") return typeof wrapped["enabled"] === "boolean" ? {
		action: "set-maximum-context-window",
		enabled: wrapped["enabled"]
	} : void 0;
	if (action === "set-model-context-window") {
		const { model, account, window } = wrapped;
		if (typeof model !== "string" || !model.trim() || typeof account !== "string" || !account || typeof window !== "number" || !Number.isSafeInteger(window) || window <= 0) return void 0;
		return {
			action,
			model: model.trim(),
			account,
			window
		};
	}
	if (action === "set-model-default-effort") {
		const { model, account, effort } = wrapped;
		if (typeof model !== "string" || !model.trim() || typeof account !== "string" || !account || effort !== void 0 && !isWorkBuddyEffort(effort)) return void 0;
		return {
			action,
			model: model.trim(),
			account,
			...effort === void 0 ? {} : { effort }
		};
	}
	if (action === "set-model-visibility") {
		const model = wrapped["model"];
		const account = wrapped["account"];
		if (typeof model !== "string" || model.trim() === "") return void 0;
		if (typeof wrapped["visible"] !== "boolean") return void 0;
		if (typeof account !== "string" || account === "") return void 0;
		return {
			action: "set-model-visibility",
			model: model.trim(),
			visible: wrapped["visible"],
			account
		};
	}
	if (action === "probe") {
		const model = wrapped["model"];
		if (typeof model !== "string" || model.trim() === "") return void 0;
		return {
			action: "probe",
			model: model.trim()
		};
	}
}
/**
* The control route's handler, extracted so tests can mount it on a bare
* server with a known key.
*/
function workBuddyProbeHandler(deps, key) {
	return async (req, res) => {
		if (req.method !== "POST") {
			json(res, 405, { error: "method not allowed" });
			return;
		}
		if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
			json(res, 403, { error: "request-not-trusted" });
			return;
		}
		if (!keyMatches(key, req.headers["x-workbuddy-probe-key"])) {
			json(res, 403, { error: "invalid-probe-key" });
			return;
		}
		const body = await readBody(req);
		if (body === void 0) {
			json(res, 413, { error: "body too large" });
			return;
		}
		const action = parseAction(body);
		if (action === void 0) {
			json(res, 400, { error: "invalid action" });
			return;
		}
		try {
			if (action.action === "clear") {
				deps.clear();
				json(res, 200, { state: "cleared" });
				return;
			}
			if (action.action === "refresh") {
				if (deps.refresh === void 0) {
					json(res, 404, { error: "refresh-not-supported" });
					return;
				}
				json(res, 200, await deps.refresh());
				return;
			}
			if (action.action === "set-maximum-context-window") {
				if (deps.setMaximumContextWindow === void 0) {
					json(res, 404, { error: "context-window-setting-not-supported" });
					return;
				}
				json(res, 200, await deps.setMaximumContextWindow(action.enabled === true));
				return;
			}
			if (action.action === "set-model-context-window") {
				if (deps.setModelContextWindow === void 0) {
					json(res, 404, { error: "context-window-setting-not-supported" });
					return;
				}
				json(res, 200, await deps.setModelContextWindow(action.model, action.window, action.account));
				return;
			}
			if (action.action === "set-model-default-effort") {
				if (deps.setModelDefaultEffort === void 0) {
					json(res, 404, { error: "reasoning-setting-not-supported" });
					return;
				}
				json(res, 200, await deps.setModelDefaultEffort(action.model, action.effort, action.account));
				return;
			}
			if (action.action === "set-model-visibility") {
				if (deps.setModelVisibility === void 0) {
					json(res, 404, { error: "visibility-setting-not-supported" });
					return;
				}
				json(res, 200, await deps.setModelVisibility(action.model, action.visible === true, action.account));
				return;
			}
			json(res, 200, await deps.probe(action.model));
		} catch (error) {
			json(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}
/** Mount the POST probe-control route on an optional webServer context. */
function registerWorkBuddyProbeRoute(ctx, deps, key) {
	const path = deps.path ?? "/plugins/dsh-workbuddy-connect/probe";
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path,
			handler: withWorkBuddyHostAuth(ctx, workBuddyProbeHandler(deps, key))
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: probe control route");
}
// src/legacy-settings.ts
/**
* Narrow one host settings service to the legacy section API, or `undefined`
* when this host's generation does not carry it.
*
* Both members are required: a service with only `installSection` would let
* this plugin install a section whose edits it could never persist, and the
* maximum-context preference is written through `update`. A host that ships
* neither is reported as `undefined` so the caller degrades in one place.
*
* @param settings - the host settings service, whose shape is generation-dependent.
* @returns the legacy API when present, otherwise `undefined`.
*/
function legacySettingsOf(settings) {
	if (typeof settings !== "object" || settings === null) return void 0;
	const candidate = settings;
	if (typeof candidate.installSection !== "function") return void 0;
	if (typeof candidate.update !== "function") return void 0;
	return settings;
}
/**
* Narrow one host settings service to the modern DSH 0.2.x SettingsForms API, or
* `undefined` when this host's generation does not carry it.
*/
function modernSettingsOf(settings) {
	if (typeof settings !== "object" || settings === null) return void 0;
	const candidate = settings;
	if (typeof candidate.installSection === "function") return void 0;
	if (typeof candidate.describe !== "function") return void 0;
	if (typeof candidate.update !== "function") return void 0;
	return settings;
}
/**
* Resolve this plugin's own profile entry id from SettingsForms descriptors.
*
* The real `describe()` (dsh-settings 0.2.1-rc.2, `SettingsForms.describe`)
* hands out *serialized* form schemas (`volatileForm(schema).toJSON()`) and
* no fiber reference, so neither a `desc.schema === Config` identity check
* nor a fiber comparison can ever succeed — identity has to come from the
* entry id the loader attached to this plugin's own fiber
* (`ctx.fiber.entry.options.id`; the tree-qualified `entry.id` includes
* parent prefixes that SettingsForms does not use). The package-name literal is the only fallback, for hosts where the
* plugin was loaded programmatically and carries no entry: entry ids are
* unique per composition, so the literal can only name this plugin. Neither
* route matching an entry that is served answers `undefined` — never a
* guess, because a wrong guess silently writes another plugin's
* configuration.
*/
function resolveModernSettingsEntryId(descriptors, ownEntryId) {
	if (ownEntryId !== void 0) return descriptors.find((row) => row.ns === ownEntryId)?.ns;
	return descriptors.find((row) => row.ns === "dsh-workbuddy-connect")?.ns;
}
// src/index.ts
/** Stable Cordis plugin name. */
const name = "llm-workbuddy";
/** The model registry required before the provider can register. */
const inject = ["llm"];
/**
* Settings namespace owning the CN card's section.
*
* DSH 0.1.2 dropped the `settingsNamespace()` branding function: a namespace is
* now a nominal string, validated by the type system where it is used rather
* than at runtime by a function call. The brand is compile-time only, so this
* stays the plain string it always was — every comparison, descriptor lookup,
* and `dsh` config file still sees `'workbuddy'`. It is cast once here so the
* public constant carries the seam's type without pulling the brand helper
* into this package (upstream DSH plugins, `dsh-llm-pi-ai` included, pass
* their namespaces as plain string literals).
*/
const WORKBUDDY_SETTINGS_NS = "workbuddy";
/**
* Settings namespace owning the international section.
*
* One namespace per variant, not one shared: each section owns only its own
* fields (`authFile` vs `authFileAI` and `useMaximumContextWindow`), and the
* sections are what `settings.yaml` and the TUI `/settings` read. On DSH 0.1.5
* they carry one more duty — the settings Plugins tab dispatches a card by
* rendering `settings.plugin.item` with `entryKey = ns` for each namespace the
* Host serves, so each variant's card needs a served section whose namespace
* equals its id. DSH 0.1.6+ ignores that pairing (its Plugins page renders the
* bundle's single `plugins.bundle.config` entry, keyed by package name), which
* costs nothing: a section that names no card renders no duplicate.
*/
const WORKBUDDY_AI_SETTINGS_NS = "workbuddy-ai";
/**
* How often the credential files are re-checked, in milliseconds.
*
* A startup-only catalog fetch cannot notice a sign-in that happens while DSH
* is already running, so the model group would not appear until a restart. This
* poll is a cheap existence/parse read of at most a few local files: it never
* contacts the network and never runs a reasoning probe.
*
* `DSH_WORKBUDDY_POLL_MS` overrides it. That exists so the sweep can be
* exercised end to end in tests and shortened while diagnosing a slow sign-in
* on a real machine; it is not a product setting and no UI exposes it. The
* value is clamped to a sane range so a mistaken override cannot turn the poll
* into a busy loop.
*/
const CREDENTIAL_POLL_MS = 3e4;
/** Floor and ceiling for the overridable poll interval. */
const MIN_POLL_MS = 100;
const MAX_POLL_MS = 864e5;
/** Resolve the sweep interval, honoring the override when it is usable. */
function credentialPollMs() {
	const override = Number(process.env["DSH_WORKBUDDY_POLL_MS"]);
	if (!Number.isFinite(override) || override < MIN_POLL_MS) return CREDENTIAL_POLL_MS;
	return Math.min(override, MAX_POLL_MS);
}
/**
* How long to wait before retrying a catalog fetch that failed.
*
* The credential sweep deliberately does not re-fetch a catalog it already has
* (a same-identity token rotation carries no new model information). But a
* *failed* fetch must not be treated the same way: without a retry, one
* transient network blip at startup would leave the group on the built-in
* fallback roster until the user noticed and pressed refresh. This bound keeps
* that recovery automatic while still honoring the "not every round" rule — at
* most one attempt per interval, and none at all once a live catalog lands.
*
* Expressed as a multiple of the sweep rather than a fixed duration so the two
* stay in proportion under the `DSH_WORKBUDDY_POLL_MS` override.
*/
const CATALOG_RETRY_SWEEPS = 10;
/** Explicit CN desktop auth-file path (shared by the plugin schema and its section). */
const AUTH_FILE_FIELD = z.string().description("WorkBuddy desktop auth file (defaults to the app's own location)");
/** Explicit international desktop auth-file path (shared by the plugin schema and its section). */
const AUTH_FILE_AI_FIELD = z.string().description("WorkBuddy AI desktop auth file (defaults to the app's own location)");
/** Probe authorization (shared by the plugin schema and the CN section). */
const PROBE_CONSENT_FIELD = z.boolean().default(false).description("Authorize reasoning-effort probes (each probe sends real requests that may consume credit)");
const MAXIMUM_CONTEXT_WINDOW_FIELD = z.boolean().default(true).volatile().description("Use the largest context window declared by WorkBuddy AI when alternatives are available (on by default)");
/** Provider retry policy (shared by both routes; default is the dsh-llm policy). */
const RETRY_POLICY_FIELD = RetryPolicySchema.description("Model-request retry policy (defaults: normal mode, 5 retries, 500 ms → 10 s backoff)");
const Config = z.object({
	authFile: AUTH_FILE_FIELD,
	authFileAI: AUTH_FILE_AI_FIELD,
	probeConsent: PROBE_CONSENT_FIELD,
	useMaximumContextWindow: MAXIMUM_CONTEXT_WINDOW_FIELD,
	retryPolicy: RETRY_POLICY_FIELD
});
/**
* Read the context-window preference off a resolved Config. Fields marked
* `.volatile()` materialize as cosmokit volatile containers (`{ get() }`) so
* the host can live-update them without remounting the plugin; plain hosts
* and values set through this plugin are plain booleans. Both spellings
* answer here.
*/
function plainConfigBoolean(value) {
	if (value !== null && typeof value === "object" && typeof value.get === "function") return plainConfigBoolean(value.get());
	return value === void 0 ? void 0 : value === true;
}
/**
* The CN side's settings section: only the fields that side edits.
*
* The section's namespace is what serves these fields to `settings.yaml` and
* the TUI `/settings`, and it keeps them apart from the international side's.
* `probeConsent` lives here because it predates the second variant; it gates no
* current code path (only manual, per-click-confirmed probes run), so it is left
* where existing users set it rather than moved and re-asked.
*/
const CN_SECTION = z.object({
	authFile: AUTH_FILE_FIELD,
	probeConsent: PROBE_CONSENT_FIELD
});
/** The international card's settings section and its context-window preference. */
const AI_SECTION = z.object({
	authFileAI: AUTH_FILE_AI_FIELD,
	useMaximumContextWindow: MAXIMUM_CONTEXT_WINDOW_FIELD
});
/** Stable identity key used by credentials, probe records, and catalog entries. */
function credentialIdentity(credential) {
	return `${credential.uid}:${credential.enterpriseId ?? ""}`;
}
/**
* The account key model-visibility preferences are stored under: the stable
* identity, but only when it carries a uid.
*
* A credential whose desktop document carried no `account.uid` normalizes to
* an empty string; keying preferences on the resulting `":enterpriseId"` would
* silently share one bucket between every such account. Those accounts get no
* per-account preferences at all — everything stays visible and the control
* route explains the refusal — which is the only honest degradation: it never
* applies one account's hidden list to another.
*/
function visibilityAccountOf(credential) {
	return credential.uid === "" ? void 0 : credentialIdentity(credential);
}
/** Read the configured explicit auth-file path for one variant. */
function configuredAuthFile(config, variant) {
	return variant.id === CN_VARIANT.id ? config.authFile : config.authFileAI;
}
/**
* The static catalog a variant serves before its first successful fetch.
*
* Each variant has its own roster: the two endpoints share several model ids
* but not their billing, context windows, or reasoning sets, so one shared
* fallback would misdescribe whichever variant it was not captured from.
*/
function fallbackFor(variant) {
	return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS : FALLBACK_WORKBUDDY_AI_MODELS;
}
/** Build one variant's stores and probe state. */
function createVariantRuntime(config, variant, current, identityOf, accountOf, keyProvider) {
	const client = new WorkBuddyUpstreamClient();
	const configured = configuredAuthFile(config, variant);
	const toolkit = new WorkBuddyToolkitRuntime(new WorkBuddyCredentialStore({
		variant,
		...configured === void 0 ? {} : { desktopPath: configured },
		...keyProvider === void 0 ? {} : { keyProvider },
		refresh: (credential) => client.refreshToken(credential)
	}), variant, client);
	const store = toolkit.view;
	const fallback = fallbackFor(variant);
	const catalog = new WorkBuddyCatalog(fallback);
	if (variant.id !== CN_VARIANT.id) catalog.setUseMaximumContextWindow(plainConfigBoolean(config.useMaximumContextWindow) === true);
	catalog.setVisible(false);
	const probeStore = new WorkBuddyProbeStore({
		pluginVersion: WORKBUDDY_CONNECT_VERSION,
		path: workbuddyProbePath(variant.probeFilename)
	});
	const savedCatalogs = new WorkBuddyCatalogStore(workbuddyCatalogPath(variant.catalogFilename));
	const visibilityStore = new WorkBuddyVisibilityStore(workbuddyVisibilityPath(variant.visibilityFilename));
	const probeService = new WorkBuddyProbeService({
		store: probeStore,
		catalog,
		credentials: store,
		client,
		region: variant.id === CN_VARIANT.id ? "cn" : "global",
		consent: () => current().probeConsent === true,
		account: () => identityOf(variant.id)
	});
	return {
		variant,
		retryPolicy: resolveRetryPolicy(config.retryPolicy, `dsh-workbuddy-connect: ${variant.id} retryPolicy`),
		store,
		toolkit,
		availability: new WorkBuddyAvailabilityStore(),
		requestScope: void 0,
		client,
		catalog,
		probeStore,
		probeService,
		savedCatalogs,
		visibilityStore,
		contextWindowStore: new ContextWindowStore(workbuddyVisibilityPath(`${variant.visibilityFilename}.context-windows`)),
		reasoningDefaultStore: new ReasoningDefaultStore(workbuddyVisibilityPath(`${variant.visibilityFilename}.reasoning-defaults`)),
		reconcile: async () => {},
		creditLog: new WorkBuddyCreditLog(),
		account: () => accountOf(variant.id),
		fallback,
		catalogSource: "fallback",
		catalogFetchedAtMs: void 0,
		catalogError: void 0,
		lastFetchAtMs: 0,
		catalogGeneration: 0,
		inflightFetch: void 0,
		invalidate: () => {},
		registered: false
	};
}
/** The catalog provenance the card displays. */
function catalogSection(runtime) {
	const fetch = runtime.client.lastCatalog;
	return {
		source: runtime.catalogSource,
		...runtime.catalogFetchedAtMs === void 0 ? {} : { fetchedAt: runtime.catalogFetchedAtMs },
		...fetch?.appVersion === void 0 ? {} : { appVersion: fetch.appVersion.version },
		...runtime.catalogError === void 0 ? {} : { error: runtime.catalogError }
	};
}
/**
* Whether a model can be probed by hand: it reasons and the upstream declares
* no effort set for it.
*
* Deliberately *not* filtered by whether a result already exists. Dropping a
* model once it has been detected made the list shrink with use, so
* re-detecting one model — after an upstream change, say — meant clearing every
* other result first. The list stays stable and the card marks which entries
* already have an answer.
*/
function isProbeCandidate(info) {
	return resolveEfforts(info).probeEligible;
}
/** Compact probe state for one card: consent, candidates, observations. */
function probeSection(runtime, consent) {
	const models = runtime.catalog.current();
	const results = models.flatMap((info) => {
		const record = runtime.probeService.recordFor(info.id);
		if (record === void 0) return [];
		return [{
			id: info.id,
			name: info.name,
			validation: record.validation,
			efforts: record.efforts,
			probedAt: record.probedAtMs
		}];
	});
	return {
		consent,
		running: runtime.probeService.isRunning(),
		candidates: models.filter(isProbeCandidate).map((info) => info.id),
		results: newestFirst(results)
	};
}
/**
* Start one variant: its loopback endpoint, provider registration, and
* configuration-card wiring.
*
* Registration waits for the shim to hold a port, because the provider's
* models read the shim origin at construction time. A failure here is
* contained to this variant: the caller logs it and the other keeps working.
*
* @returns whether the provider registered.
*/
async function startVariant(ctx, runtime) {
	const { variant, store, client, catalog, probeService } = runtime;
	const shim = createWorkBuddyShim({
		store,
		client,
		catalog,
		logger: ctx.logger,
		requireAccountScope: true,
		onOutcome: (event) => {
			const scope = workBuddyRequestScope(event.credential);
			if (event.kind === void 0) runtime.availability.success(scope, event.model);
			else {
				runtime.availability.record(scope, event.model, event.kind, event.code, event.retryAt);
				runtime.toolkit.policy.observeFailure(event.kind, event.credential);
			}
		},
		creditEpoch: () => runtime.creditLog.epoch,
		onCreditScoped: (responseId, credit, account, epoch) => runtime.creditLog.observe(responseId, credit, account, epoch)
	});
	try {
		await shim.ready;
	} catch (error) {
		ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} loopback endpoint failed to start`, error);
		return false;
	}
	try {
		const workbuddy = createWorkBuddyAdapter({
			providerId: variant.id,
			displayName: variant.displayName,
			retryPolicy: runtime.retryPolicy,
			region: variant.region,
			shim,
			store,
			catalog,
			resolveAttachments: () => ctx.get("attachments"),
			resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, (hostPath) => ctx.get("fs")?.processPathFromHostPath(hostPath), ref),
			observe: (modelId) => probeService.recordFor(modelId),
			prepareAccount: async (mode, model) => {
				const rescue = mode === "request" ? currentToolkitRescueFrame() : void 0;
				if (mode === "request") {
					if (rescue === void 0) await runtime.toolkit.policy.beginRequest();
					else {
						if (rescue.provider !== variant.id || rescue.model !== model) throw new Error("WorkBuddy rescue request target changed");
						const current = await runtime.toolkit.policy.resolveCurrent();
						await rescue.checkScope(variant.id, runtime.toolkit.base.accountId(current));
					}
				}
				await runtime.reconcile();
				const credential = await store.current().catch(() => void 0);
				if (credential === void 0) return void 0;
				if (rescue !== void 0) await rescue.checkScope(variant.id, runtime.toolkit.base.accountId(credential));
				if (visibilityAccountOf(credential) !== runtime.account()) throw new Error("WorkBuddy account changed; refresh the model list and send again");
				return workBuddyRequestScope(credential);
			},
			defaultEffort: (modelId) => {
				const account = runtime.account();
				return account === void 0 ? void 0 : runtime.reasoningDefaultStore.get(account, modelId);
			},
			hidden: () => {
				const account = runtime.account();
				return account === void 0 ? [] : runtime.visibilityStore.disabled(account);
			}
		});
		runtime.invalidate = () => {
			workbuddy.invalidate();
			ctx.emit("llm/adapters-updated");
		};
		const releaseAdapter = ctx.llm.registerAdapter([variant.id], workbuddy.adapter);
		try {
			ctx.effect(() => () => {
				releaseAdapter();
				shim.close();
			});
		} catch {
			releaseAdapter();
			shim.close();
		}
		runtime.registered = true;
		return true;
	} catch (error) {
		ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} provider registration failed`, error);
		shim.close();
		return false;
	}
}
/**
* Start both variants: their loopback endpoints, the `workbuddy` and
* `workbuddy-ai` providers, their configuration cards, and their
* credential-driven catalog lifecycles.
*
* Each variant registers unconditionally; what varies is whether its catalog is
* *visible*. An empty catalog is how DSH hides a model group (the host filters
* out groups with no models), which keeps a sign-in that happens after startup
* working without re-registering the provider.
*/
function apply(ctx, config) {
	const piAiWarning = piAiVersionWarning();
	if (piAiWarning !== void 0) ctx.logger.warn(`dsh-workbuddy-connect: ${piAiWarning}`);
	let current = () => config;
	/** Timers and in-flight work belonging to this plugin instance. */
	let stopped = false;
	const timers = [];
	/**
	* The account identity each variant last published a catalog for. Keeps a
	* same-identity token rotation from re-fetching, and lets a late response
	* from a previous identity be discarded instead of overwriting a newer one.
	*/
	const lastIdentities = /* @__PURE__ */ new Map();
	/**
	* The visibility account key each variant last adopted, parallel to
	* {@link lastIdentities}: same credential, second key — undefined both when
	* signed out and when the credential carried no uid, which is exactly the
	* case that must not fall back to a shared preference bucket.
	*/
	const lastAccounts = /* @__PURE__ */ new Map();
	const atRestKeysFor = (variant) => atRestKeyProviderFor(variant);
	const runtimes = WORKBUDDY_VARIANTS.map((variant) => createVariantRuntime(config, variant, () => current(), (id) => lastIdentities.get(id), (id) => lastAccounts.get(id), atRestKeysFor(variant)));
	const probeKey = createProbeKey();
	let setMaximumContextWindow;
	/**
	* Whether this host's settings service carries the 0.1.2-era section API.
	* Decided once, inside the `settings` inject: DSH 0.1.7 removed
	* `installSection` (and `update`) with no replacement this plugin can drive.
	* The maximum-context getter answers `undefined` while this is false, and a
	* status document without the field is what keeps the card from rendering a
	* checkbox that could not be saved.
	*/
	let legacySettingsAvailable = false;
	/** Whether modern DSH 0.2.x SettingsForms service is available to persist settings. */
	let settingsAvailable = false;
	/**
	* Point a variant at an account identity, invalidating whatever the previous
	* one left behind.
	*
	* One helper for all four transitions (sweep sign-in, sweep sign-out, manual
	* refresh, manual refresh sign-out) because each of them used to do its own
	* partial version, and the manual path forgot pieces the sweep did. Every
	* transition bumps {@link VariantRuntime.catalogGeneration}, which is what
	* makes an in-flight request from before the change refuse to write back.
	*
	* Probe observations are kept across an account change: the store nests them
	* per account, so the departing account's records simply stop being served
	* (every read is account-scoped) and are found intact if that account
	* returns. The "signed out, then in as someone else" sequence that used to
	* look like a first sighting is still safe — a record only ever answers for
	* the account stamped on it, so the new account inherits nothing. Visibility
	* preferences are kept for the same reason, and read through the new
	* account's key immediately: the picker re-lists after the invalidate below
	* and a returning account finds its own hidden list back in force.
	*
	* @param identity - the account now in effect, or `undefined` when signed out.
	* @param account - the visibility key for that same credential (`undefined`
	* also when the credential carries no uid); stored alongside the identity so
	* preference reads never guess it from the identity string.
	*/
	const adoptIdentity = (runtime, identity, account) => {
		const id = runtime.variant.id;
		const known = lastIdentities.get(id);
		if (known === identity) return;
		runtime.creditLog.clear();
		const hadCredential = known !== void 0;
		if (identity === void 0) lastIdentities.delete(id);
		else lastIdentities.set(id, identity);
		if (account === void 0) lastAccounts.delete(id);
		else lastAccounts.set(id, account);
		runtime.catalog.setContextWindows(account === void 0 ? {} : runtime.contextWindowStore.get(account));
		runtime.catalogGeneration += 1;
		runtime.inflightFetch?.controller.abort();
		runtime.inflightFetch = void 0;
		if (hadCredential && known !== identity) runtime.invalidate();
		if (identity === void 0) {
			if (known !== void 0) runtime.savedCatalogs.delete(known);
			runtime.catalog.set(runtime.fallback);
			runtime.catalogSource = "fallback";
			runtime.catalogFetchedAtMs = void 0;
			runtime.catalogError = void 0;
			if (runtime.catalog.setVisible(false)) runtime.invalidate();
			return;
		}
		const saved = runtime.savedCatalogs.get(identity);
		if (saved !== void 0) {
			runtime.catalog.set([...saved.models]);
			runtime.catalogSource = "saved";
			runtime.catalogFetchedAtMs = saved.fetchedAtMs;
		} else {
			runtime.catalog.set(runtime.fallback);
			runtime.catalogSource = "fallback";
			runtime.catalogFetchedAtMs = void 0;
		}
		runtime.catalogError = void 0;
		runtime.catalog.setVisible(true);
		runtime.invalidate();
	};
	ctx.inject(["webServer", "connection"], (webCtx) => {
		const drift = versionDrift();
		registerWorkBuddyUpdateRoute(webCtx, {
			currentVersion: WORKBUDDY_CONNECT_VERSION,
			...drift === void 0 ? {} : { manifestVersion: drift.manifest }
		});
		for (const runtime of runtimes) {
			registerWorkBuddyCreditRoute(webCtx, {
				path: runtime.variant.id === CN_VARIANT.id ? WORKBUDDY_CREDITS_PATH : WORKBUDDY_AI_CREDITS_PATH,
				provider: runtime.variant.id,
				log: runtime.creditLog,
				account: runtime.account
			});
			registerWorkBuddyStatusRoute(webCtx, {
				path: runtime.variant.statusPath,
				store: runtime.store,
				client: runtime.client,
				models: () => runtime.catalog.current(),
				beforeRead: () => runtime.reconcile(),
				availability: (modelId) => {
					return runtime.account() === void 0 || runtime.requestScope === void 0 ? void 0 : runtime.availability.get(runtime.requestScope, modelId);
				},
				region: runtime.variant.region,
				observe: (modelId) => runtime.probeService.recordFor(modelId),
				defaultEffort: (modelId) => {
					const account = runtime.account();
					return account === void 0 ? void 0 : runtime.reasoningDefaultStore.get(account, modelId);
				},
				catalog: () => catalogSection(runtime),
				probe: () => probeSection(runtime, current().probeConsent === true),
				probeKey,
				visibility: () => {
					const account = runtime.account();
					return account === void 0 ? void 0 : {
						account,
						disabled: runtime.visibilityStore.disabled(account)
					};
				},
				...runtime.variant.id === CN_VARIANT.id ? {} : { useMaximumContextWindow: () => legacySettingsAvailable || settingsAvailable ? plainConfigBoolean(current().useMaximumContextWindow) === true : void 0 }
			});
			registerToolkitRoute(webCtx, {
				path: toolkitPath(runtime.variant.id),
				key: probeKey,
				state: () => runtime.toolkit.state(probeKey),
				action: async (action) => {
					const result = await runtime.toolkit.action(action);
					await runtime.reconcile();
					return result;
				}
			});
			registerWorkBuddyProbeRoute(webCtx, {
				path: runtime.variant.probePath,
				probe: async (modelId) => {
					const result = await runtime.probeService.probe(modelId, true);
					if (result.state === "ok") runtime.invalidate();
					return result;
				},
				clear: () => {
					runtime.probeStore.clear();
					runtime.invalidate();
				},
				refresh: async () => {
					if (stopped) return {
						state: "failed",
						reason: "plugin is stopping"
					};
					let credential;
					try {
						credential = await runtime.store.current();
					} catch (error) {
						return {
							state: "failed",
							reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
						};
					}
					if (credential === void 0) {
						adoptIdentity(runtime, void 0, void 0);
						return { state: "signed-out" };
					}
					const identity = credentialIdentity(credential);
					adoptIdentity(runtime, identity, visibilityAccountOf(credential));
					await fetchCatalog(runtime, identity);
					return runtime.catalogError === void 0 ? {
						state: "refreshed",
						reason: `${runtime.catalog.current().length} models`
					} : {
						state: "failed",
						reason: runtime.catalogError
					};
				},
				...runtime.variant.id === CN_VARIANT.id ? {} : { setMaximumContextWindow: async (enabled) => {
					if (setMaximumContextWindow === void 0) return {
						state: "failed",
						reason: "settings are unavailable"
					};
					return setMaximumContextWindow(enabled);
				} },
				setModelDefaultEffort: (modelId, effort, expectedAccount) => updateModelDefaultEffort({
					currentAccount: async () => {
						if (stopped) return void 0;
						const credential = await runtime.store.current();
						return credential === void 0 ? void 0 : visibilityAccountOf(credential);
					},
					activeAccount: runtime.account,
					models: () => runtime.catalog.current(),
					observe: (modelId) => runtime.probeService.recordFor(modelId),
					region: runtime.variant.region,
					store: runtime.reasoningDefaultStore,
					invalidate: () => runtime.invalidate()
				}, modelId, effort, expectedAccount),
				setModelContextWindow: async (modelId, window, expectedAccount) => {
					const account = runtime.account();
					if (account === void 0 || account !== expectedAccount) return {
						state: "stale-account",
						reason: "the signed-in account changed"
					};
					const model = runtime.catalog.current().find((candidate) => candidate.id === modelId);
					if (model === void 0 || !model.supportedContextWindows?.includes(window)) return {
						state: "failed",
						reason: "the model does not declare this context window"
					};
					try {
						runtime.contextWindowStore.set(account, modelId, window);
					} catch (error) {
						return {
							state: "failed",
							reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
						};
					}
					runtime.catalog.setContextWindows(runtime.contextWindowStore.get(account));
					runtime.invalidate();
					return { state: "updated" };
				},
				setModelVisibility: async (modelId, visible, expectedAccount) => {
					const account = runtime.account();
					if (account === void 0) return {
						state: "failed",
						reason: "model visibility needs a signed-in account with a stable user id"
					};
					if (expectedAccount !== account) return {
						state: "stale-account",
						reason: "the signed-in account changed"
					};
					try {
						runtime.visibilityStore.setVisible(account, modelId, visible);
					} catch (error) {
						return {
							state: "failed",
							reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
						};
					}
					runtime.invalidate();
					return { state: "updated" };
				}
			}, probeKey);
		}
	});
	watchWorkBuddyCreditSessions(ctx, runtimes.map((runtime) => ({
		provider: runtime.variant.id,
		log: runtime.creditLog
	})));
	ctx.inject(["settings"], (settingsCtx) => {
		const legacy = legacySettingsOf(settingsCtx.settings);
		if (legacy !== void 0) {
			legacySettingsAvailable = true;
			/** Section sources; each falls back to its own slice when its side unloads. */
			const sources = {
				cn: () => config,
				ai: () => config
			};
			/** Merge both sections into the whole config the rest of the plugin reads. */
			const merged = () => {
				const aiMaximum = plainConfigBoolean(sources.ai().useMaximumContextWindow);
				return {
					...sources.cn().authFile === void 0 ? {} : { authFile: sources.cn().authFile },
					...sources.cn().probeConsent === void 0 ? {} : { probeConsent: sources.cn().probeConsent },
					...sources.ai().authFileAI === void 0 ? {} : { authFileAI: sources.ai().authFileAI },
					...aiMaximum === void 0 ? {} : { useMaximumContextWindow: aiMaximum }
				};
			};
			const applyMaximumContextWindow = (next) => {
				const runtime = runtimes.find((candidate) => candidate.variant.id !== CN_VARIANT.id);
				if (runtime?.catalog.setUseMaximumContextWindow(next.useMaximumContextWindow === true)) runtime.invalidate();
			};
			const repointStores = () => {
				const next = merged();
				applyMaximumContextWindow(next);
				for (const runtime of runtimes) runtime.store.setDesktopPath(configuredAuthFile(next, runtime.variant));
			};
			legacy.installSection(ctx, WORKBUDDY_SETTINGS_NS, CN_SECTION, config, {
				setSource(source) {
					sources.cn = source;
					current = merged;
				},
				onChange: repointStores
			});
			legacy.installSection(ctx, WORKBUDDY_AI_SETTINGS_NS, AI_SECTION, config, {
				setSource(source) {
					sources.ai = source;
					current = merged;
				},
				onChange: repointStores
			});
			setMaximumContextWindow = async (enabled) => {
				await legacy.update(WORKBUDDY_AI_SETTINGS_NS, { useMaximumContextWindow: enabled });
				return { state: "updated" };
			};
			return;
		}
		const modern = modernSettingsOf(settingsCtx.settings);
		if (modern !== void 0) {
			/**
			* The live preference as the host's own Config reports it.
			*
			* The forms layer is the single source of truth on a 0.2.x host: a write
			* lands in the profile document and comes back through `describe()`, so
			* nothing has to be mirrored in memory here (and a mirror is exactly how
			* runtime and saved state drift apart). The persisted default already
			* applies — the preference field defaults to `true` and the composition
			* handed this plugin its resolved `config`.
			*/
			let liveConfig = {
				...config,
				useMaximumContextWindow: plainConfigBoolean(config.useMaximumContextWindow) ?? true
			};
			/** Whether {@link liveConfig} came from a settings descriptor (see below). */
			let liveConfigBound = false;
			/**
			* Read this plugin's own entry out of the host's forms.
			*
			* The namespace on a 0.2.x host is the *profile entry id* — not the
			* `SettingsNamespace` the 0.1.x sections were installed under — so it is
			* whatever the user named this plugin in the profile composition.
			*
			* Identity cannot come from the descriptors themselves: `describe()`
			* hands out *serialized* forms (`volatileForm(schema).toJSON()`), never
			* the live Config object, and its rows carry no fiber — so
			* `desc.schema === Config` and fiber comparisons are always false
			* against the real service. The loader instead keys entries by id and
			* attaches them to the fibers it runs (`ctx.fiber.entry.options.id`, unlike the tree-qualified `entry.id`), which is
			* what {@link resolveModernSettingsEntryId} reads; the package-name
			* literal stays as the only fallback (entry ids are unique per
			* composition, so it can only name this plugin). Anything unmatched
			* answers `undefined` — a wrong guess would silently write another
			* plugin's configuration.
			*/
			const settingsEntryId = () => {
				try {
					const entry = ctx.fiber?.entry;
					return resolveModernSettingsEntryId(modern.describe(), entry?.options?.id ?? entry?.id);
				} catch (error) {
					ctx.logger.warn("dsh-workbuddy-connect: reading this plugin's settings entry failed: %s", error);
					return;
				}
			};
			/**
			* Apply whatever the settings document now says.
			*
			* The value read is the descriptor's `value` — the projection of the live
			* fiber config, i.e. what the loader actually resolved — rather than
			* `user`, which names only the profile's own section and would miss an
			* inherited or default value that is nonetheless in effect.
			*/
			const applyModernConfig = () => {
				if (!liveConfigBound) return;
				const runtime = runtimes.find((candidate) => candidate.variant.id !== CN_VARIANT.id);
				if (runtime?.catalog.setUseMaximumContextWindow(plainConfigBoolean(liveConfig.useMaximumContextWindow) === true)) runtime.invalidate();
			};
			setMaximumContextWindow = async (enabled) => {
				const ns = settingsEntryId();
				if (ns === void 0) return {
					state: "failed",
					reason: "no configurable settings entry for this plugin"
				};
				try {
					await modern.update(ns, { useMaximumContextWindow: enabled });
					if ((modern.describe().find((entry) => entry.ns === ns)?.value)?.useMaximumContextWindow !== enabled) return {
						state: "failed",
						reason: "the settings document did not accept the context-window preference"
					};
				} catch (error) {
					return {
						state: "failed",
						reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
					};
				}
				liveConfig = {
					...liveConfig,
					useMaximumContextWindow: enabled
				};
				current = () => liveConfig;
				applyModernConfig();
				return { state: "updated" };
			};
			let retry;
			let retryIndex = 0;
			let bindingStopped = false;
			const retryDelays = [
				250,
				500,
				1e3,
				2e3,
				4e3,
				8e3
			];
			const clearRetry = () => {
				clearTimeout(retry);
				retry = void 0;
			};
			const bindModernConfig = () => {
				if (bindingStopped) return;
				try {
					const ns = settingsEntryId();
					const entry = ns === void 0 ? void 0 : modern.describe().find((desc) => desc.ns === ns);
					settingsAvailable = (entry?.schema === void 0 ? void 0 : new z(entry.schema))?.dict?.useMaximumContextWindow?.type === "boolean";
					if (settingsAvailable) {
						const stored = (entry?.value)?.useMaximumContextWindow;
						liveConfig = {
							...liveConfig,
							useMaximumContextWindow: plainConfigBoolean(stored) ?? plainConfigBoolean(liveConfig.useMaximumContextWindow) ?? true
						};
						liveConfigBound = true;
						current = () => liveConfig;
						applyModernConfig();
						clearRetry();
						return;
					}
				} catch (error) {
					settingsAvailable = false;
					ctx.logger.warn("dsh-workbuddy-connect: reading the stored context-window preference failed: %s", error);
				}
				if (retry === void 0 && retryIndex < retryDelays.length) retry = setTimeout(() => {
					retry = void 0;
					bindModernConfig();
				}, retryDelays[retryIndex++]);
			};
			settingsCtx.effect(() => () => {
				bindingStopped = true;
				clearRetry();
				settingsAvailable = false;
			});
			settingsCtx.effect(() => ctx.on("settings/document-updated", () => {
				bindModernConfig();
			}));
			bindModernConfig();
			return;
		}
		ctx.logger.warn("dsh-workbuddy-connect: host settings service has no installSection or SettingsForms API; per-variant settings and the maximum-context preference are unavailable");
	});
	ctx.effect(() => () => {
		stopped = true;
		for (const runtime of runtimes) runtime.creditLog.clear();
		for (const timer of timers) clearInterval(timer);
		timers.length = 0;
		clearHostHeartbeat();
	});
	/**
	* Fetch one variant's catalog for the current credential.
	*
	* Shared by the credential sweep and the card's manual refresh, and written
	* so that concurrent callers cost one request and cannot interleave badly:
	*
	* - **One request at a time.** A second caller joins the in-flight fetch
	*   instead of starting its own (spec §5: one catalog request per variant at
	*   a time).
	* - **Generation-checked write-back.** The request records the generation it
	*   started under and writes nothing if the generation moved on — which is
	*   what a slow answer from a superseded account must not do. Checking only
	*   the *identity* was not enough: two refreshes for the same account can
	*   still finish out of order, and the older one would win.
	* - **`resolve()`, not `current()`.** Only `resolve()` performs the locked,
	*   single-flight token renewal. Reading `current()` meant an expired token
	*   made every catalog request fail until something else happened to refresh
	*   it, leaving the group on the fallback roster.
	*/
	const fetchCatalog = async (runtime, identity) => {
		const inflight = runtime.inflightFetch;
		const generation = runtime.catalogGeneration;
		if (inflight !== void 0 && inflight.identity === identity && inflight.generation === generation) return inflight.promise;
		inflight?.controller.abort();
		const controller = new AbortController();
		let run;
		run = (async () => {
			let models;
			try {
				const credential = await runtime.store.resolve();
				const resolvedIdentity = credentialIdentity(credential);
				if (resolvedIdentity !== identity) {
					adoptIdentity(runtime, resolvedIdentity, visibilityAccountOf(credential));
					await fetchCatalog(runtime, resolvedIdentity);
					return;
				}
				models = await runtime.client.fetchModels(credential, controller.signal);
				const latest = await runtime.store.current();
				const latestIdentity = latest === void 0 ? void 0 : credentialIdentity(latest);
				if (latestIdentity !== identity) {
					adoptIdentity(runtime, latestIdentity, latest === void 0 ? void 0 : visibilityAccountOf(latest));
					if (latestIdentity !== void 0) await fetchCatalog(runtime, latestIdentity);
					return;
				}
			} catch (error) {
				if (stopped || runtime.catalogGeneration !== generation) return;
				runtime.lastFetchAtMs = Date.now();
				runtime.catalogError = error instanceof Error ? error.message.slice(0, 300) : String(error);
				ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} catalog unavailable; serving the fallback list`, error);
				runtime.invalidate();
				return;
			}
			if (stopped || runtime.catalogGeneration !== generation) return;
			runtime.lastFetchAtMs = Date.now();
			runtime.catalog.set([...models]);
			runtime.catalogSource = "live";
			runtime.catalogFetchedAtMs = runtime.client.lastCatalog?.fetchedAtMs ?? Date.now();
			runtime.catalogError = void 0;
			if (lastIdentities.get(runtime.variant.id) === identity) runtime.savedCatalogs.set(identity, {
				source: runtime.client.lastCatalog?.source ?? "unknown",
				fetchedAtMs: runtime.client.lastCatalog?.fetchedAtMs ?? Date.now(),
				models: [...models],
				...runtime.client.lastCatalog?.appVersion === void 0 ? {} : { appVersion: runtime.client.lastCatalog.appVersion.version }
			});
			runtime.invalidate();
		})().finally(() => {
			if (runtime.inflightFetch?.promise === run) runtime.inflightFetch = void 0;
		});
		runtime.inflightFetch = {
			identity,
			generation,
			controller,
			promise: run
		};
		return run;
	};
	/**
	* Reconcile one variant with its credentials.
	*
	* Four transitions matter, and each is a different action:
	*
	* - **none → some** (first sighting): reveal the group and fetch a catalog.
	* - **none → some, identity changed**: additionally drop the previous
	*   account's observations, so another user's probe answers cannot be read as
	*   the new account's.
	* - **some → none**: hide the group and stop serving its models.
	* - **same identity**: nothing to do — the store refreshes tokens on demand,
	*   and re-fetching on every rotation would hit the catalog endpoint for no
	*   new information.
	*/
	const syncVariant = async (runtime) => {
		if (stopped || !runtime.registered) return;
		await runtime.toolkit.refresh().catch(() => {});
		const credential = await runtime.store.current().catch((error) => {
			ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} credential read failed`, error);
		});
		if (stopped) return;
		if (credential === void 0) {
			runtime.requestScope = void 0;
			adoptIdentity(runtime, void 0, void 0);
			return;
		}
		runtime.requestScope = workBuddyRequestScope(credential);
		const identity = credentialIdentity(credential);
		if (lastIdentities.get(runtime.variant.id) === identity && runtime.catalog.isVisible()) {
			const stale = runtime.catalogSource !== "live";
			const due = Date.now() - runtime.lastFetchAtMs >= credentialPollMs() * CATALOG_RETRY_SWEEPS;
			if (stale && due) await fetchCatalog(runtime, identity);
			return;
		}
		adoptIdentity(runtime, identity, visibilityAccountOf(credential));
		await fetchCatalog(runtime, identity);
	};
	/** Run one reconcile sweep across both variants. */
	const syncAll = async () => {
		for (const runtime of runtimes) await syncVariant(runtime);
	};
	for (const runtime of runtimes) runtime.reconcile = () => syncVariant(runtime);
	const toolkitHost = new ToolkitHostManager(ctx, runtimes.map((runtime) => runtime.toolkit));
	ctx.effect(() => () => {
		toolkitHost.dispose();
		for (const runtime of runtimes) {
			runtime.toolkit.dispose();
			runtime.availability.clear();
		}
	});
	Promise.all(runtimes.map(async (runtime) => startVariant(ctx, runtime))).then(() => {
		if (stopped) return;
		if (runtimes.some((runtime) => runtime.registered)) writeHostHeartbeat();
		syncAll();
		const timer = setInterval(() => {
			syncAll();
		}, credentialPollMs());
		timer.unref?.();
		timers.push(timer);
	});
}
export { AI_VARIANT, CN_APP_VERSION_FILENAME, CN_VARIANT, Config, FALLBACK_CN_APP_VERSION, FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, PROBE_EFFORT_CANDIDATES, WORKBUDDY_AI_SETTINGS_NS, WORKBUDDY_APP_VERSION_FILENAME, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_CATALOG_FILENAME, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_PROBE_FILENAME, WORKBUDDY_PROVIDER, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_VARIANTS, WORKBUDDY_VISIBILITY_FILENAME, WorkBuddyCatalog, WorkBuddyCatalogStore, WorkBuddyCredentialStore, WorkBuddyProbeService, WorkBuddyProbeStore, WorkBuddyUpstreamClient, WorkBuddyVisibilityStore, appUserAgent, apply, chatUserAgent, classifyUpstreamError, clearHostHeartbeat, createWorkBuddyAdapter, createWorkBuddyShim, defaultDesktopAuthCandidates, defaultDesktopAuthPath, desktopAuthCandidatesFor, fallbackChatIdentity, fingerprintModel, inject, installedAppVersion, isHeartbeatProcessAlive, modelWithCurrentPromotion, name, normalizeCredits, parseModelCatalog, parseWorkBuddyAuth, prepareChatBody, prepareCnChatBody, prepareInternationalChatBody, probeModel, processStartTimeMs, randomSentinel, readBundleVersion, readCliVersion, readHostHeartbeat, regionOf, resolveAppVersion, resolveChatIdentity, validAppVersion, validCliVersion, variantFor, visibilityAccountOf, workbuddyCatalogPath, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, workbuddyProbePath, workbuddyVisibilityPath };
