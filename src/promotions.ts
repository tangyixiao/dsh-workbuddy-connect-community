/** Public product promotion metadata, evaluated without requests or billing arithmetic. */
import type { WorkBuddyUpstreamModel } from './upstream.ts'

export interface PromotionProvenance { source: 'product-config' | 'console-models'; fetchedAt: number }
export interface PromotionDailyWindow { start: string; end: string }
export interface NormalizedPromotionDefinition {
  enabled: boolean
  schedule: 'fixed' | 'daily' | 'unsupported'
  validFrom?: number
  validUntil?: number
  timeZone?: string
  daily?: readonly PromotionDailyWindow[]
  priority: number
  label: string
  discountedCredits?: string
  displayMode?: 'replace' | 'strikethrough'
  factor?: number
}
export interface PromotionFacts {
  state: 'active' | 'inactive' | 'expired' | 'unknown'
  source: PromotionProvenance['source']
  fetchedAt: number
  evaluatedAt: number
  freshness: 'fresh' | 'stale' | 'unknown'
  schedule: 'fixed' | 'daily' | 'unsupported' | 'not-declared'
  validFrom?: number
  validUntil?: number
  timeZone?: string
  daily?: readonly PromotionDailyWindow[]
  nextChangeAt?: number
  label?: string
  /** Refers only to this promotion's authoritative price, never an inferred base rate. */
  priceKnown: boolean
  effectiveCredits?: string
}
const DAY_MS = 86_400_000
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function text(value: unknown): string { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 160) : '' }
function credits(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 40) return undefined
  const match = /^(?:x\s*(\d+(?:\.\d{1,12})?)|(\d+(?:\.\d{1,12})?)\s*x)$/iu.exec(value.trim())
  const numberText = match?.[1] ?? match?.[2]
  if (numberText === undefined) return undefined
  const number = Number(numberText)
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) return undefined
  return `x${number.toFixed(Math.max(2, numberText.split('.')[1]?.length ?? 0))}`
}
function minute(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim())
  if (match === null) return undefined
  const hour = Number(match[1]); const minutes = Number(match[2])
  return hour < 24 && minutes < 60 ? hour * 60 + minutes : undefined
}
function hourMinute(value: number): string { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` }
function timeZone(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z_+/-]+$/u.test(value)) return undefined
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return value } catch { return undefined }
}
function timestamp(value: unknown): number | undefined {
  // Offset or Z is required: parsing a timezone-less timestamp would depend on this machine.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return undefined
  const dateOnly = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`)
  if (!Number.isFinite(dateOnly) || new Date(dateOnly).toISOString().slice(0, 10) !== value.slice(0, 10) || Number(value.slice(11, 13)) >= 24) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** Saved catalogs are JSON, so their optional metadata must cross the same trust boundary. */
export function validSavedPromotionMetadata(model: Record<string, unknown>): boolean {
  const provenance = model['promotionProvenance']
  if (provenance !== undefined && (!record(provenance)
    || !['product-config', 'console-models'].includes(String(provenance['source']))
    || typeof provenance['fetchedAt'] !== 'number' || !Number.isFinite(provenance['fetchedAt']) || provenance['fetchedAt'] < 0)) return false
  const definitions = model['promotionDefinitions']
  if (definitions !== undefined && (!Array.isArray(definitions) || definitions.length > 256 || !definitions.every(value => {
    if (!record(value) || typeof value['enabled'] !== 'boolean' || !['fixed', 'daily', 'unsupported'].includes(String(value['schedule']))
      || typeof value['priority'] !== 'number' || !Number.isFinite(value['priority']) || typeof value['label'] !== 'string' || value['label'].length > 160) return false
    for (const key of ['validFrom', 'validUntil', 'factor']) {
      if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)) return false
    }
    if (typeof value['validFrom'] === 'number' && typeof value['validUntil'] === 'number' && value['validUntil'] <= value['validFrom']) return false
    if (value['timeZone'] !== undefined && timeZone(value['timeZone']) === undefined) return false
    if (value['discountedCredits'] !== undefined && credits(value['discountedCredits']) === undefined) return false
    if (value['displayMode'] !== undefined && value['displayMode'] !== 'replace' && value['displayMode'] !== 'strikethrough') return false
    const daily = value['daily']
    if (daily !== undefined && (!Array.isArray(daily) || daily.length === 0 || daily.length > 16
      || !daily.every(window => record(window) && minute(window['start']) !== undefined && minute(window['end']) !== undefined))) return false
    return value['schedule'] !== 'daily' || (daily !== undefined && value['timeZone'] !== undefined)
  }))) return false
  const legacy = model['promotions']
  return legacy === undefined || (Array.isArray(legacy) && legacy.length <= 256 && legacy.every(value => record(value)
    && ['start', 'end', 'factor', 'priority'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && typeof value['label'] === 'string'))
}

/** Verified official product shape only. Unsupported schedules remain visible as unknown. */
export function normalizePromotionDefinitions(raw: unknown, modelId: string): NormalizedPromotionDefinition[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 256).flatMap((entry): NormalizedPromotionDefinition[] => {
    if (!record(entry) || !Array.isArray(entry['modelIds']) || !entry['modelIds'].includes(modelId)) return []
    const badge = record(entry['badge']) ? entry['badge'] : undefined
    const discount = record(entry['discount']) ? entry['discount'] : undefined
    const explicitCredits = credits(discount?.['discountedCredits'])
    const displayMode = discount?.['displayMode'] === 'replace' || discount?.['displayMode'] === 'strikethrough' ? discount['displayMode'] : undefined
    const factor = typeof discount?.['factor'] === 'number' && Number.isFinite(discount['factor']) && discount['factor'] >= 0 ? discount['factor'] : undefined
    const result: NormalizedPromotionDefinition = {
      enabled: entry['enabled'] === true,
      schedule: 'unsupported',
      priority: typeof entry['priority'] === 'number' && Number.isFinite(entry['priority']) ? entry['priority'] : 0,
      label: text(badge?.['label'] ?? badge?.['labelEn']),
      ...explicitCredits === undefined ? {} : { discountedCredits: explicitCredits },
      ...displayMode === undefined ? {} : { displayMode },
      ...factor === undefined ? {} : { factor },
    }
    const schedule = entry['schedule']
    if (!record(schedule) || !Object.keys(schedule).every(key => ['validFrom', 'validUntil', 'timezone', 'daily'].includes(key))) return [result]
    const start = timestamp(schedule['validFrom']); const end = timestamp(schedule['validUntil']); const zone = timeZone(schedule['timezone'])
    if ((schedule['validFrom'] !== undefined && start === undefined) || (schedule['validUntil'] !== undefined && end === undefined)
      || (start !== undefined && end !== undefined && end <= start) || (schedule['timezone'] !== undefined && zone === undefined)) return [result]
    if (start !== undefined) result.validFrom = start
    if (end !== undefined) result.validUntil = end
    if (zone !== undefined) result.timeZone = zone
    if (schedule['daily'] !== undefined) {
      const daily = schedule['daily']
      if (!Array.isArray(daily) || daily.length === 0 || daily.length > 16 || zone === undefined) return [result]
      const windows: PromotionDailyWindow[] = []
      for (const window of daily) {
        if (!record(window) || !Object.keys(window).every(key => key === 'start' || key === 'end')) return [result]
        const startMinute = minute(window['start']); const endMinute = minute(window['end'])
        if (startMinute === undefined || endMinute === undefined) return [result]
        windows.push({ start: hourMinute(startMinute), end: hourMinute(endMinute) })
      }
      result.daily = windows
      result.schedule = 'daily'
    } else if (start !== undefined || end !== undefined) result.schedule = 'fixed'
    return [result]
  })
}
function zonedSeconds(now: number, zone: string): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now)
    const get = (name: string) => Number(parts.find(part => part.type === name)?.value)
    const seconds = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second') + new Date(now).getMilliseconds() / 1000
    return Number.isFinite(seconds) ? seconds : undefined
  } catch { return undefined }
}
function active(definition: NormalizedPromotionDefinition, now: number): boolean | undefined {
  if (!definition.enabled) return false
  if (definition.schedule === 'unsupported') return undefined
  if ((definition.validFrom !== undefined && now < definition.validFrom) || (definition.validUntil !== undefined && now >= definition.validUntil)) return false
  if (definition.schedule === 'fixed') return true
  const seconds = definition.timeZone === undefined ? undefined : zonedSeconds(now, definition.timeZone)
  if (seconds === undefined || definition.daily === undefined) return undefined
  const currentMinute = Math.floor(seconds / 60)
  return definition.daily.some(window => {
    const start = minute(window.start); const end = minute(window.end)
    return start !== undefined && end !== undefined && (start === end || (start < end ? currentMinute >= start && currentMinute < end : currentMinute >= start || currentMinute < end))
  })
}
function nextChange(definition: NormalizedPromotionDefinition, now: number): number | undefined {
  const boundaries = [definition.validFrom, definition.validUntil].filter((value): value is number => value !== undefined && value > now)
  // Only the observed fixed-offset zones have exact next-day boundaries here. Other IANA zones still evaluate through Intl.
  if (definition.daily !== undefined && definition.timeZone !== undefined && ['Asia/Shanghai', 'UTC', 'Etc/UTC', 'GMT'].includes(definition.timeZone)) {
    const second = zonedSeconds(now, definition.timeZone)
    if (second !== undefined) for (const window of definition.daily) {
      if (window.start === window.end) continue
      for (const boundary of [window.start, window.end]) {
        const value = minute(boundary)
        if (value !== undefined) {
          const delta = ((value * 60 - second) % 86400 + 86400) % 86400
          boundaries.push(now + (delta === 0 ? DAY_MS : Math.ceil(delta * 1000)))
        }
      }
    }
  }
  return boundaries.length === 0 ? undefined : Math.min(...boundaries)
}

/** No base-price multiplication: the upstream may already bake the discount into credits. */
export function promotionFacts(model: WorkBuddyUpstreamModel & { promotionDefinitions?: readonly NormalizedPromotionDefinition[] }, provenance: PromotionProvenance, now = Date.now()): PromotionFacts {
  const age = now - provenance.fetchedAt
  const freshness = !Number.isFinite(now) || !Number.isFinite(provenance.fetchedAt) || provenance.fetchedAt < 0 || age < -5000 ? 'unknown' : age > DAY_MS ? 'stale' : 'fresh'
  const definitions: readonly NormalizedPromotionDefinition[] = model.promotionDefinitions?.length ? model.promotionDefinitions : (model.promotions ?? []).map(value => ({
    enabled: true, schedule: Number.isFinite(value.start) && Number.isFinite(value.end) && value.end > value.start ? 'fixed' : 'unsupported',
    validFrom: value.start, validUntil: value.end, label: text(value.label), priority: Number.isFinite(value.priority) ? value.priority : 0,
    // Legacy parser only admits replace discounts; only zero has a safe price without an explicit value.
    ...value.factor === 0 ? { factor: 0, displayMode: 'replace' as const } : {},
  }))
  const sorted = [...definitions].sort((left, right) => right.priority - left.priority)
  const enabled = sorted.filter(value => value.enabled)
  const selected = enabled.find(value => active(value, now) === true) ?? enabled[0] ?? sorted[0]
  let state: PromotionFacts['state'] = 'unknown'
  if (selected !== undefined) {
    const isActive = active(selected, now)
    const uncertainHigher = enabled.some(value => value.priority >= selected.priority && active(value, now) === undefined)
    state = uncertainHigher || isActive === undefined ? 'unknown' : isActive ? 'active'
      : enabled.length > 0 && enabled.every(value => value.validUntil !== undefined && now >= value.validUntil) ? 'expired' : 'inactive'
  }
  if (freshness !== 'fresh') state = 'unknown'
  const effectiveCredits = state !== 'active' || selected === undefined ? undefined : credits(selected.discountedCredits)
    ?? (selected.displayMode === 'replace' && selected.factor === 0 ? 'x0.00' : undefined)
  const next = selected === undefined ? undefined : nextChange(selected, now)
  return {
    state, source: provenance.source, fetchedAt: provenance.fetchedAt, evaluatedAt: now, freshness,
    schedule: selected?.schedule ?? 'not-declared', priceKnown: effectiveCredits !== undefined,
    ...selected?.validFrom === undefined ? {} : { validFrom: selected.validFrom },
    ...selected?.validUntil === undefined ? {} : { validUntil: selected.validUntil },
    ...selected?.timeZone === undefined ? {} : { timeZone: selected.timeZone },
    ...selected?.daily === undefined ? {} : { daily: selected.daily.map(window => ({ start: window.start, end: window.end })) },
    ...selected?.label ? { label: selected.label } : {},
    ...next === undefined ? {} : { nextChangeAt: next },
    ...effectiveCredits === undefined ? {} : { effectiveCredits },
  }
}
