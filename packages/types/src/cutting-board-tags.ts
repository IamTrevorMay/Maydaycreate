/**
 * Shared intent-tag vocabulary for the Cutting Board two-model system.
 *
 * Both the cut-watcher (live Premiere edits) and the cut-finder
 * (finished-video analysis) reference this list so their records
 * can be cross-referenced in Supabase.
 */

export interface IntentTag {
  id: string;
  label: string;
}

export const INTENT_TAGS: readonly IntentTag[] = [
  { id: 'silence',    label: 'Removes silence' },
  { id: 'misspeak',   label: 'Removes misspeak' },
  { id: 'cadence',    label: 'Cadence / flow' },
  { id: 'false-start', label: 'Removes false start' },
  { id: 'transition', label: 'Topic transition' },
  { id: 'pacing',     label: 'Tightens pacing' },
  { id: 'redundancy', label: 'Removes redundancy' },
] as const;

export type IntentTagId = typeof INTENT_TAGS[number]['id'];
