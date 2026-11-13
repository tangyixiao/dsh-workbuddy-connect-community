import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { toolkitPath } from '../toolkit-types.ts'
import type { ToolkitAction, ToolkitWebState } from '../toolkit-types.ts'
import type { ToolkitSettings, ToolkitSettingsPatch } from '../toolkit-settings.ts'
import type { SavedAccountSummary } from '../account-store.ts'
import type { ToolkitLocaleKey } from './toolkit-locales.ts'

export interface WorkBuddyToolkitPanelProps {
  provider: string
  t: (key: ToolkitLocaleKey, params?: Record<string, unknown>) => string
}
type Translate = WorkBuddyToolkitPanelProps['t']
const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0 }
const small: CSSProperties = { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', overflowWrap: 'anywhere' }
const button: CSSProperties = { minHeight: 34, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 18, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '6px 12px', font: 'inherit', fontSize: 13, cursor: 'pointer' }
const input: CSSProperties = { boxSizing: 'border-box', minHeight: 34, width: '100%', minWidth: 0, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '6px 8px', font: 'inherit', fontSize: 13 }
const group: CSSProperties = { ...column, margin: 0, padding: '12px 0', border: 0, borderTop: '1px solid var(--dsw-alias-border-l2)' }
const legend: CSSProperties = { padding: '0 8px 0 0', color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 600 }
const label: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' }
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** Only validated owner-scoped facts reach controls; missing capabilities remain unavailable. */
export function parseToolkitWebState(value: unknown, provider: string): ToolkitWebState | undefined {
  if (!object(value) || value['provider'] !== provider || typeof value['key'] !== 'string' || value['key'].length === 0 || value['key'].length > 256) return undefined
  const expectedId = provider === 'workbuddy-ai' ? /^global-[a-f0-9]{32}$/u : /^cn-[a-f0-9]{32}$/u
  const accounts = value['accounts']
  if (!object(accounts) || typeof accounts['revision'] !== 'string' || accounts['revision'].length === 0 || accounts['revision'].length > 80
    || !['saved-account', 'follow-desktop'].includes(accounts['mode'] as string) || !Array.isArray(accounts['accounts']) || accounts['accounts'].length > 100) return undefined
  const ids = new Set<string>()
  for (const account of accounts['accounts']) {
    if (!object(account) || typeof account['id'] !== 'string' || !expectedId.test(account['id']) || ids.has(account['id'])
      || typeof account['selected'] !== 'boolean' || typeof account['expiresAtMs'] !== 'number' || !Number.isFinite(account['expiresAtMs'])
      || (account['label'] !== undefined && (typeof account['label'] !== 'string' || account['label'].length > 80))) return undefined
    ids.add(account['id'])
  }
  if (value['account'] !== undefined && (typeof value['account'] !== 'string' || !expectedId.test(value['account']))) return undefined
  const settings = value['settings']
  if (settings !== undefined) {
    if (!object(settings) || typeof settings['revision'] !== 'string' || settings['revision'].length === 0 || settings['revision'].length > 80) return undefined
    const features = settings['features']; const automation = settings['automation']; const cli = settings['cli']
    if (!object(features) || !['images', 'videos', 'cli', 'contextRescue'].every(key => typeof features[key] === 'boolean')
      || !object(automation) || typeof automation['rotate'] !== 'boolean' || typeof automation['checkin'] !== 'boolean'
      || !Array.isArray(automation['members']) || automation['members'].length > 100 || !automation['members'].every(id => typeof id === 'string' && expectedId.test(id))
      || !Number.isInteger(automation['maxSwitches']) || Number(automation['maxSwitches']) < 1 || Number(automation['maxSwitches']) > 3
      || !object(cli) || typeof cli['workspace'] !== 'string' || cli['workspace'].length > 4096 || typeof cli['model'] !== 'string' || cli['model'].length > 128
      || typeof cli['effort'] !== 'string' || !Number.isInteger(cli['timeoutMs']) || Number(cli['timeoutMs']) < 10_000 || Number(cli['timeoutMs']) > 300_000
      || !Number.isInteger(cli['maxTurns']) || Number(cli['maxTurns']) < 1 || Number(cli['maxTurns']) > 8) return undefined
  }
  const reported = object(value['capabilities']) ? value['capabilities'] : {}
  const capabilities = Object.fromEntries(['tools', 'approval', 'context', 'cli', 'media', 'checkin'].map(key => [key, reported[key] === true]))
  return { ...value, capabilities } as unknown as ToolkitWebState
}

function expiry(account: SavedAccountSummary, t: Translate): string {
  try { return account.expiresAtMs > 0 ? t('toolkitExpiry', { time: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(account.expiresAtMs)) }) : t('toolkitExpiryUnknown') }
  catch { return t('toolkitExpiryUnknown') }
}

function AccountRow({ account, number, pending, revision, checkin, consentOwner, mutate, t }: {
  account: SavedAccountSummary; number: number; pending: boolean; revision: string; checkin: boolean; consentOwner: string | undefined; mutate: (action: ToolkitAction) => void; t: Translate
}) {
  const [name, setName] = useState(account.label ?? '')
  useEffect(() => { setName(account.label ?? '') }, [account.label])
  const display = account.label?.trim() || t('toolkitAccountName', { number })
  return <div style={{ ...column, gap: 8, padding: '8px 0' }}>
    <div style={{ ...row, justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--dsw-alias-label-primary)', fontSize: 13, overflowWrap: 'anywhere' }}>{display}{account.selected ? <small style={{ ...small, marginLeft: 8 }}>{t('toolkitSelected')}</small> : null}</span>
      <div style={row}>
        <button type="button" style={button} aria-label={t('toolkitUseLabel', { name: display })} disabled={pending || account.selected} onClick={() => { mutate({ action: 'select-account', id: account.id, revision }) }}>{t('toolkitUse')}</button>
        <button type="button" style={button} aria-label={t('toolkitCheckinLabel', { name: display })} disabled={pending || !checkin || consentOwner === undefined} onClick={() => { if (consentOwner !== undefined) mutate({ action: 'checkin', id: account.id, revision, account: consentOwner }) }}>{t('toolkitManualCheckin')}</button>
        <button type="button" style={button} aria-label={t('toolkitRemoveLabel', { name: display })} title={account.selected ? t('toolkitSelectedRemove') : undefined} disabled={pending || account.selected} onClick={() => { mutate({ action: 'remove-account', id: account.id, revision }) }}>{t('toolkitRemove')}</button>
      </div>
    </div>
    <p style={small}>{expiry(account, t)}</p>
    <form style={row} onSubmit={event => { event.preventDefault(); if (name.trim() && name.trim() !== account.label) mutate({ action: 'rename-account', revision, id: account.id, label: name.trim() }) }}>
      <input style={{ ...input, flex: '1 1 160px' }} aria-label={t('toolkitNameLabel', { name: display })} maxLength={80} value={name} disabled={pending} onChange={event => { setName(event.currentTarget.value) }} />
      <button type="submit" style={button} disabled={pending || name.trim() === '' || name.trim() === account.label}>{t('toolkitRename')}</button>
    </form>
  </div>
}

function cliValid(cli: ToolkitSettings['cli']): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/|\\\\)/u.test(cli.workspace) && !/[\u0000-\u001f\u007f]/u.test(cli.workspace)
    && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(cli.model) && EFFORTS.includes(cli.effort)
    && Number.isInteger(cli.timeoutMs) && cli.timeoutMs >= 10_000 && cli.timeoutMs <= 300_000 && Number.isInteger(cli.maxTurns) && cli.maxTurns >= 1 && cli.maxTurns <= 4
}

function CliForm({ settings, disabled, save, t }: { settings: ToolkitSettings; disabled: boolean; save: (patch: ToolkitSettingsPatch) => void; t: Translate }) {
  const [draft, setDraft] = useState({ ...settings.cli })
  useEffect(() => { setDraft({ ...settings.cli }) }, [settings.revision])
  const edit = (key: keyof ToolkitSettings['cli'], value: string | number): void => { setDraft(previous => ({ ...previous, [key]: value })) }
  const submit = (event: FormEvent): void => { event.preventDefault(); if (cliValid(draft)) save({ cli: draft }) }
  return <form style={column} onSubmit={submit} data-toolkit-cli-form>
    <span style={{ ...legend, fontWeight: 500 }}>{t('toolkitCliConfiguration')}</span>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 10 }}>
      <label style={column}><span style={small}>{t('toolkitWorkspace')}</span><input style={input} name="workspace" value={draft.workspace} maxLength={4096} disabled={disabled} onChange={event => { edit('workspace', event.currentTarget.value) }} /></label>
      <label style={column}><span style={small}>{t('toolkitModel')}</span><input style={input} name="model" value={draft.model} maxLength={128} disabled={disabled} onChange={event => { edit('model', event.currentTarget.value) }} /></label>
      <label style={column}><span style={small}>{t('toolkitEffort')}</span><select style={input} name="effort" value={draft.effort} disabled={disabled} onChange={event => { edit('effort', event.currentTarget.value) }}><option value="">{t('toolkitChooseEffort')}</option>{EFFORTS.map(effort => <option key={effort} value={effort}>{effort}</option>)}</select></label>
      <label style={column}><span style={small}>{t('toolkitTimeout')}</span><input style={input} name="timeout" type="number" min={10} max={300} step={1} value={draft.timeoutMs / 1000} disabled={disabled} onChange={event => { edit('timeoutMs', Number(event.currentTarget.value) * 1000) }} /></label>
      <label style={column}><span style={small}>{t('toolkitTurns')}</span><input style={input} name="turns" type="number" min={1} max={4} step={1} value={draft.maxTurns} disabled={disabled} onChange={event => { edit('maxTurns', Number(event.currentTarget.value)) }} /></label>
    </div>
    <div><button type="submit" style={button} disabled={disabled || !cliValid(draft)}>{t('toolkitSaveCli')}</button></div>
  </form>
}

export function WorkBuddyToolkitPanel({ provider, t }: WorkBuddyToolkitPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [state, setState] = useState<ToolkitWebState>()
  const stateRef = useRef<ToolkitWebState>()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<ToolkitLocaleKey>()
  const [failure, setFailure] = useState(false)
  const requestFlight = useRef<AbortController>()
  const bodyId = useId()

  const request = useCallback(async (action?: ToolkitAction): Promise<void> => {
    if (requestFlight.current !== undefined) return
    const controller = new AbortController()
    requestFlight.current = controller
    setPending(true); setNotice(undefined); setFailure(false)
    let outcome: ToolkitLocaleKey | undefined
    let failed = false
    try {
      if (action !== undefined) {
        const key = stateRef.current?.key
        if (key === undefined) return
        try {
          const result = await fetch(toolkitPath(provider), { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Toolkit-Key': key }, body: JSON.stringify(action) })
          outcome = result.ok ? 'toolkitSaved' : result.status === 409 ? 'toolkitStale' : 'toolkitFailure'
          failed = !result.ok
        } catch {
          if (controller.signal.aborted) return
          outcome = 'toolkitUncertain'; failed = true
        }
      }
      const response = await fetch(toolkitPath(provider), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('unavailable')
      const next = parseToolkitWebState(await response.json(), provider)
      if (next === undefined) throw new Error('invalid document')
      if (!controller.signal.aborted && requestFlight.current === controller) {
        stateRef.current = next; setState(next); setNotice(outcome); setFailure(failed)
      }
    } catch {
      if (!controller.signal.aborted && requestFlight.current === controller) { stateRef.current = undefined; setState(undefined); setNotice(action === undefined ? 'toolkitLoadFailure' : 'toolkitUncertain'); setFailure(true) }
    } finally {
      if (requestFlight.current === controller) { requestFlight.current = undefined; if (!controller.signal.aborted) setPending(false) }
    }
  }, [provider])

  useEffect(() => {
    stateRef.current = undefined; setState(undefined); setPending(false); setNotice(undefined)
    if (expanded) void request()
    return () => { requestFlight.current?.abort(); requestFlight.current = undefined }
  }, [request])
  const mutate = (action: ToolkitAction): void => { void request(action) }
  const settings = state?.settings
  const save = (patch: ToolkitSettingsPatch): void => { if (settings !== undefined && state?.account !== undefined) mutate({ action: 'update-settings', revision: settings.revision, account: state.account, patch }) }
  const controlled = settings !== undefined && state?.account !== undefined
  const hasMembers = state?.accounts.accounts.some(account => settings?.automation.members.includes(account.id)) === true
  const servingIndex = state?.accounts.accounts.findIndex(account => account.id === state.decision?.servingAccount) ?? -1
  const serving = servingIndex < 0 ? undefined : state?.accounts.accounts[servingIndex]
  const servingName = serving?.label?.trim() || (serving === undefined ? state?.decision?.servingAccount === state?.account ? t('toolkitPrimaryAccount') : t('toolkitUnknownAccount') : t('toolkitAccountName', { number: servingIndex + 1 }))
  const canMedia = state?.capabilities.tools === true && state.capabilities.approval === true && state.capabilities.media === true
  const canCli = state?.capabilities.tools === true && state.capabilities.approval === true && state.capabilities.cli === true
  const choices: Array<{ key: keyof ToolkitSettings['features']; title: ToolkitLocaleKey; available: boolean }> = [
    { key: 'images', title: 'toolkitImages', available: canMedia }, { key: 'videos', title: 'toolkitVideos', available: canMedia },
    { key: 'contextRescue', title: 'toolkitContext', available: state?.capabilities.context === true },
    { key: 'cli', title: 'toolkitCli', available: canCli && settings !== undefined && cliValid(settings.cli) },
  ]
  return <section style={{ ...column, gap: 0, width: '100%', boxSizing: 'border-box', margin: '8px 0 16px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8 }}>
    <button type="button" style={{ ...row, justifyContent: 'space-between', width: '100%', padding: '10px 12px', border: 0, background: 'transparent', font: 'inherit', fontSize: 13, color: 'var(--dsw-alias-label-primary)', textAlign: 'left', cursor: 'pointer' }} aria-expanded={expanded} aria-controls={bodyId} data-toolkit-disclosure onClick={() => { setExpanded(previous => !previous); if (!expanded && stateRef.current === undefined) void request() }}><span>{t('toolkitTitle')}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
    {expanded ? <div id={bodyId} style={{ ...column, padding: '0 12px 12px' }} aria-busy={pending}>
      <p style={small}>{t('toolkitIntro')}</p>
      <div style={row}><button type="button" style={button} disabled={pending} onClick={() => { void request() }}>{t('toolkitRefresh')}</button>{pending ? <span style={small} role="status">{t(state === undefined ? 'toolkitLoading' : 'toolkitPending')}</span> : null}</div>
      {notice === undefined ? null : <p style={{ ...small, ...(failure ? { color: 'var(--dsw-alias-state-error-primary)' } : {}) }} role={failure ? 'alert' : 'status'}>{t(notice)}</p>}
      {state === undefined ? null : <>
        <fieldset style={group}><legend style={legend}>{t('toolkitAccounts')}</legend>
          <p style={small}>{t(state.accounts.mode === 'follow-desktop' ? 'toolkitFollowing' : 'toolkitUsingSaved')}</p>
          <div style={row}><button type="button" style={button} disabled={pending} onClick={() => { mutate({ action: 'save-account', revision: state.accounts.revision }) }}>{t('toolkitSaveAccount')}</button><button type="button" style={button} disabled={pending || state.accounts.mode === 'follow-desktop'} onClick={() => { mutate({ action: 'follow-desktop', revision: state.accounts.revision }) }}>{t('toolkitFollowDesktop')}</button></div>
          {state.accounts.accounts.length === 0 ? <p style={small}>{t('toolkitEmptyAccounts')}</p> : state.accounts.accounts.map((account, index) => <AccountRow key={account.id} account={account} number={index + 1} pending={pending} revision={state.accounts.revision} checkin={state.capabilities.checkin} consentOwner={state.account} mutate={mutate} t={t} />)}
          <p style={small}>{t('toolkitCheckinHint')}</p>
          {object(state.checkin) ? <p style={small} role="status">{t(state.checkin.state === 'succeeded' ? 'toolkitCheckinSucceeded' : state.checkin.state === 'already-checked-in' ? 'toolkitCheckinAlready' : state.checkin.state === 'not-eligible' ? 'toolkitCheckinIneligible' : state.checkin.state === 'failed' ? 'toolkitCheckinFailed' : 'toolkitCheckinUnknown')}{state.checkin.state === 'succeeded' && typeof state.checkin.credits === 'number' && Number.isFinite(state.checkin.credits) ? ` · ${t('toolkitCheckinCredits', { credits: new Intl.NumberFormat(undefined).format(state.checkin.credits) })}` : ''}</p> : null}
        </fieldset>
        <fieldset style={group}><legend style={legend}>{t('toolkitFeatures')}</legend>
          <p style={small}>{t('toolkitCosts')}</p>{controlled ? null : <p style={small}>{t('toolkitNeedsAccount')}</p>}
          {choices.map(feature => <label key={feature.key} style={label}><input type="checkbox" data-toolkit-feature={feature.key} checked={settings?.features[feature.key] === true} disabled={pending || !controlled || (!settings?.features[feature.key] && !feature.available)} onChange={event => { save({ features: { [feature.key]: event.currentTarget.checked } }) }} /><span>{t(feature.title)}{feature.available ? null : <small style={{ ...small, display: 'block' }}>{feature.key === 'cli' && canCli ? t('toolkitCliConfigureFirst') : t('toolkitUnavailable')}</small>}</span></label>)}
          <p style={small}>{t('toolkitContextHint')}</p><p style={small}>{t('toolkitCliHint')}</p>
          {settings === undefined ? null : <CliForm settings={settings} disabled={pending || !controlled} save={save} t={t} />}
        </fieldset>
        <fieldset style={group}><legend style={legend}>{t('toolkitAutomation')}</legend>
          <label style={label}><input type="checkbox" data-toolkit-automation="rotate" checked={settings?.automation.rotate === true} disabled={pending || !controlled || (!settings?.automation.rotate && !hasMembers)} onChange={event => { save({ automation: { rotate: event.currentTarget.checked } }) }} /><span>{t('toolkitRotate')}</span></label><p style={small}>{t('toolkitRotateHint')}</p>
          <label style={label}><input type="checkbox" data-toolkit-automation="checkin" checked={settings?.automation.checkin === true} disabled={pending || !controlled || (!settings?.automation.checkin && (!state.capabilities.checkin || !hasMembers))} onChange={event => { save({ automation: { checkin: event.currentTarget.checked } }) }} /><span>{t('toolkitAutoCheckin')}{state.capabilities.checkin ? null : <small style={{ ...small, display: 'block' }}>{t('toolkitUnavailable')}</small>}</span></label><p style={small}>{t('toolkitAutoCheckinHint')}</p>
          <span style={legend}>{t('toolkitMembers')}</span><p style={small}>{t('toolkitMembersHint')}</p>
          {state.accounts.accounts.map((account, index) => <label style={label} key={account.id}><input type="checkbox" data-toolkit-member checked={settings?.automation.members.includes(account.id) === true} disabled={pending || !controlled} onChange={event => { if (settings !== undefined) save({ automation: { members: event.currentTarget.checked ? [...settings.automation.members.filter(id => id !== account.id), account.id] : settings.automation.members.filter(id => id !== account.id) } }) }} /><span>{account.label?.trim() || t('toolkitAccountName', { number: index + 1 })}</span></label>)}
          {hasMembers ? null : <p style={small}>{t('toolkitChooseMembers')}</p>}
          <label style={{ ...row, fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>{t('toolkitRotationLimit')}<select style={{ ...input, width: 'auto' }} value={settings?.automation.maxSwitches ?? 1} disabled={pending || !controlled} onChange={event => { save({ automation: { maxSwitches: Number(event.currentTarget.value) } }) }}>{[1, 2, 3].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          {state.decision?.servingAccount === undefined ? null : <p style={small} role="status" data-toolkit-serving-account>{t('toolkitServingAccount', { name: servingName })}</p>}
          {state.decision?.state === 'serving' || state.decision?.state === 'exhausted' || state.decision?.state === 'pending' ? <p style={small} role="status">{t(state.decision.state === 'serving' ? 'toolkitDecisionRotated' : state.decision.state === 'exhausted' ? 'toolkitDecisionStopped' : 'toolkitDecisionPending')}</p> : null}
        </fieldset>
      </>}
    </div> : null}
  </section>
}
