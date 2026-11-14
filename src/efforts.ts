import type { WorkBuddyModelInfo } from './catalog.ts'
import type { WorkBuddyProbeRecord } from './probe-store.ts'
import type { WorkBuddyEffort, WorkBuddyRegion } from './upstream.ts'

/** Shared capability decision; observations establish acceptance, not effectiveness. */
export interface WorkBuddyEfforts {
  efforts: readonly WorkBuddyEffort[]
  source?: 'declared' | 'observed'
  off: boolean
  probeEligible: boolean
}

/** Declarations win; only validating observations may fill an undeclared set. */
export function resolveEfforts(
  info: WorkBuddyModelInfo,
  observed?: WorkBuddyProbeRecord,
  region: WorkBuddyRegion = 'cn',
): WorkBuddyEfforts {
  const reasoning = info.reasoning
  if (reasoning?.supports !== true) return { efforts: [], off: false, probeEligible: false }
  if ((reasoning.supportedEfforts?.length ?? 0) > 0) {
    return {
      efforts: reasoning.supportedEfforts!,
      source: 'declared',
      // CN's onlyReasoning flag vetoes Off even when both flags are true (#87).
      off: reasoning.canDisableThinking === true && (region !== 'cn' || reasoning.onlyReasoning !== true),
      probeEligible: false,
    }
  }
  return {
    efforts: observed?.validation === 'validating' ? observed.efforts : [],
    ...(observed?.validation === 'validating' && observed.efforts.length > 0 ? { source: 'observed' as const } : {}),
    // Probing never grants Off, and an existing observation allows re-detection.
    off: false,
    probeEligible: true,
  }
}

/** Honor only an upstream default among the offered levels; never invent one. */
export function resolveDefaultEffort(info: WorkBuddyModelInfo, offered: readonly string[], preferred?: WorkBuddyEffort): WorkBuddyEffort | undefined {
  if (preferred !== undefined && offered.includes(preferred)) return preferred
  const effort = info.reasoning?.defaultEffort
  return effort !== undefined && offered.includes(effort) ? effort : undefined
}
