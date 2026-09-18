import { db, type JournalDb } from '../db/db'
import { mergeDrafts } from './proposals'
import { draftProposal, saveProposal } from './writes'
import type { Id, Proposal, ProposalDraft } from '../db/types'

/**
 * The extraction that is running right now. Technical plan §10.
 *
 * Extract is the one call in this app that can take half a minute, and the dialog it fills is a
 * `?extract=1` param over an entry that never unmounts. Closing it should therefore mean minimize,
 * the way a workbook sheet does (§7). It did not. The dialog owned the promise and dropped the answer
 * on unmount, so clicking away mid-call paid for a call and kept nothing, and the next press started
 * the same one again.
 *
 * So the promise lives here instead, keyed by entry, and the save happens here rather than in the
 * component. Nothing is cancelled and nothing is asked twice: a dialog that opens while a call is in
 * flight attaches to that call rather than starting a second one, which is what makes reopening
 * Extract resume instead of restart.
 *
 * This is not the background work §1 rules out. Nothing here is scheduled, swept, retried, badged, or
 * persisted across a reload. It is one promise outliving one dialog.
 */

const running = new Map<Id, Promise<ProposalDraft>>()

/**
 * The call in flight for this entry, if there is one.
 *
 * Handed back as the promise rather than a boolean so a dialog that opens mid-call can simply await
 * it, which is the whole of what "resume" means here.
 */
export const runningExtraction = (entryId: Id): Promise<ProposalDraft> | undefined =>
  running.get(entryId)

/** A held proposal as a plain draft, which is the shape everything downstream of Extract wants. */
export const asDraft = (held: Proposal | undefined): ProposalDraft | undefined =>
  held ? { entryId: held.entryId, words: held.words, sentences: held.sentences } : undefined

/**
 * Runs `ask` for this entry, or hands back the call already running for it.
 *
 * The result is merged into whatever draft the entry holds and saved before it is returned, so an
 * answer lands in the journal whether or not anyone is still looking at it. Merging rather than
 * overwriting is the same rule `Look again` has always followed: an edited field is never rewritten.
 */
export const runExtraction = (
  notebookId: Id,
  entryId: Id,
  ask: () => Promise<ProposalDraft>,
  d: JournalDb = db,
): Promise<ProposalDraft> => {
  const held = running.get(entryId)
  if (held) return held

  const started = (async () => {
    const fresh = await ask()
    const merged = mergeDrafts(asDraft(await draftProposal(entryId, d)), fresh)
    await saveProposal(notebookId, merged, d)
    return merged
  })().finally(() => {
    running.delete(entryId)
  })

  // A failure with nobody awaiting it — the dialog was closed — is still a handled rejection. An open
  // dialog sees the error as it always did, because `catch` here does not consume it for the caller.
  started.catch(() => {})

  running.set(entryId, started)
  return started
}
