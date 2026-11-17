// Browser-side validation only. Backend store modules are never imported at runtime.
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
const count = (value: unknown, max = 5000): boolean => number(value) && Number.isInteger(value) && value <= max
const time = (value: unknown): boolean => number(value) && Number.isSafeInteger(value) && value <= 8_640_000_000_000_000
const text = (value: unknown, max = 512): boolean => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
const label = (value: unknown, max: number): boolean => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
const optional = (value: unknown, validate: (value: unknown) => boolean): boolean => value === undefined || validate(value)
const choice = (value: unknown, allowed: readonly string[]): boolean => typeof value === 'string' && allowed.includes(value)
function horizon(value: unknown): boolean { return object(value) && number(value['total']) && count(value['packages'], 100) && optional(value['earliestEndTimeMs'], time) }
function credits(value: unknown): boolean {
  return object(value) && number(value['total']) && optional(value['unlimited'], flag => flag === true)
    && optional(value['cycleResetTime'], value => label(value, 80))
    && Array.isArray(value['accounts']) && value['accounts'].length <= 100 && value['accounts'].every(row => object(row) && label(row['packageName'], 160) && number(row['remain']) && number(row['size']) && optional(row['unlimited'], flag => flag === true) && optional(row['endTimeMs'], time))
    && optional(value['expiry'], value => object(value) && ['within24h', 'within3d', 'within7d'].every(key => horizon(value[key])))
}
function windows(value: unknown): boolean {
  return object(value) && ['1', '7', '30'].every(key => {
    const row = value[key]
    return object(row) && count(row['requests']) && count(row['knownCreditRequests']) && count(row['unknownCreditRequests']) && number(row['observedCredits'])
      && Number(row['knownCreditRequests']) + Number(row['unknownCreditRequests']) === row['requests']
  })
}
/** Optional extensions are bounded and region scoped before any values reach presentation. */
export function validToolkitObservations(value: Record<string, unknown>, expectedId: RegExp, savedIds: Set<string>): boolean {
  const account = (id: unknown): id is string => typeof id === 'string' && expectedId.test(id)
  const map = (value: unknown, validate: (row: Record<string, unknown>, id: string) => boolean): boolean => object(value) && Object.keys(value).length <= 100 && Object.entries(value).every(([id, row]) => savedIds.has(id) && account(id) && object(row) && validate(row, id))
  if (!optional(value['accountCredits'], value => map(value, row => optional(row['credits'], credits) && optional(row['refreshedAt'], time) && optional(row['error'], error => error === 'credits-unavailable')))) return false
  if (!optional(value['checkinResults'], value => map(value, (row, id) => row['account'] === id && time(row['time']) && choice(row['source'], ['manual', 'automatic'])
    && choice(row['outcome'], ['succeeded', 'failed', 'unknown', 'disabled', 'not-eligible', 'already-checked-in', 'day-unavailable', 'already-admitted']) && optional(row['credit'], number)))) return false
  return optional(value['usage'], value => {
    if (!object(value) || !choice(value['status'], ['available', 'history-invalid', 'storage-unavailable']) || !choice(value['persistence'], ['persisted', 'pending', 'unavailable'])) return false
    const coverage = value['coverage']
    return object(coverage) && coverage['retentionDays'] === 31 && count(coverage['maxRecords']) && Number(coverage['maxRecords']) >= 1 && count(coverage['maxBytes'], 4 * 1024 * 1024) && Number(coverage['maxBytes']) >= 512
      && (coverage['from'] === null || time(coverage['from'])) && time(coverage['to']) && (coverage['from'] === null || Number(coverage['from']) <= Number(coverage['to'])) && typeof coverage['truncated'] === 'boolean'
      && windows(value['windows']) && Array.isArray(value['byAccount']) && value['byAccount'].length <= 101 && value['byAccount'].every(row => object(row) && account(row['account']) && windows(row['windows']))
      && Array.isArray(value['byModel']) && value['byModel'].length <= 5000 && value['byModel'].every(row => object(row) && text(row['model']) && windows(row['windows']))
      && Array.isArray(value['recent']) && value['recent'].length <= 100 && value['recent'].every(row => object(row) && account(row['account']) && text(row['model']) && text(row['responseId']) && time(row['completedAt']) && optional(row['credit'], number))
  })
}
