// One place that reconciles a successful versioned write with in-memory state (#63).
//
// StorageAdapter.write() returns the backend's next native version token. Before
// this seam every writing caller dropped it and either re-read the file just to
// recover the version (section save) or left FileMeta stale until the next focus
// refresh (task mutation). Concentrating the reconciliation here means a caller
// only has to hand over the write outcome; cache and metadata update in lockstep.
//
// Reactivation (re-rendering the current File) stays with the caller's Source
// activation path, keeping this module about write reconciliation only.
import { FileMeta } from './storage/types.js';

export interface WriteOutcome { id: string; content: string; version: string; }

// Update the cached content and the matching FileMeta version from a completed
// write. Returns the reconciled FileMeta, or undefined when the id is unknown
// (e.g. a write to a file not in the current list).
export function reconcileWrite(
    files: FileMeta[],
    cache: Map<string, string>,
    outcome: WriteOutcome,
): FileMeta | undefined {
    cache.set(outcome.id, outcome.content);
    const meta = files.find((file) => file.id === outcome.id);
    if (meta) meta.version = outcome.version;
    return meta;
}
