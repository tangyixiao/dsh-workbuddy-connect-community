import type { WorkBuddyModelInfo } from './catalog.ts'
import type { WorkBuddyProbeRecord } from './probe-store.ts'
import { resolveEfforts } from './efforts.ts'
import { isWorkBuddyEffort, type ReasoningDefaultStore } from './reasoning-default-store.ts'
import type { WorkBuddyRegion } from './upstream.ts'

export async function updateModelDefaultEffort(deps: {
  currentAccount: () => Promise<string | undefined>
  activeAccount: () => string | undefined
  models: () => readonly WorkBuddyModelInfo[]
  observe: (model: string) => WorkBuddyProbeRecord | undefined
  region: WorkBuddyRegion
  store: ReasoningDefaultStore
  invalidate: () => void
}, modelId: string, effort: unknown, expectedAccount: string): Promise<{ state: string; reason?: string }> {
  const account = await deps.currentAccount()
  if (!account || account !== expectedAccount || account !== deps.activeAccount()) return { state: 'stale-account', reason: 'the signed-in account changed' }
  const model = deps.models().find(candidate => candidate.id === modelId)
  if (model === undefined) return { state: 'failed', reason: 'the model is not in the current catalog' }
  const offered = resolveEfforts(model, deps.observe(modelId), deps.region).efforts
  if (effort !== undefined && (!isWorkBuddyEffort(effort) || !offered.includes(effort))) return { state: 'failed', reason: 'the model does not offer this reasoning level' }
  try { deps.store.set(account, modelId, effort) }
  catch { return { state: 'failed', reason: 'the reasoning preference could not be saved' } }
  deps.invalidate()
  return { state: 'updated' }
}
