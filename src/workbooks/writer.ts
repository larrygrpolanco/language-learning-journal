import { db, type JournalDb } from '../db/db'
import { addSentence, addWord, recordPractice, saveMoment, saveProposal } from '../journal/writes'
import { complete, completeJson } from '../ai/text'
import { speak } from '../ai/speech'
import { drawOne } from '../ai/image'
import { animate } from '../ai/video'
import type { Id } from '../db/types'
import type { AI, JournalWriter } from './sdk'

/**
 * What a workbook is handed. Technical plan §8.
 *
 * Both objects are built per session and closed over the notebook id, so a workbook has no way to name
 * another notebook and no way to reach Dexie or `fetch` directly. That is the whole enforcement
 * mechanism, and it is why these are functions rather than modules a workbook could import itself.
 */

export const journalWriterFor = (
  notebookId: Id,
  workbookId: string,
  d: JournalDb = db,
): JournalWriter => ({
  saveMoment: (m) =>
    saveMoment(
      {
        notebookId,
        body: m.body,
        title: m.title,
        source: m.source,
        ...(m.media !== undefined ? { media: m.media } : {}),
      },
      d,
    ),

  // No `entryId`, so both of these land on today's entry per §5. A word pulled out of an exercise
  // gains a word on today's entry and does not touch the session, which is §11 exactly.
  addWord: async (w) => (await addWord({ notebookId, ...w }, d)).wordId,
  addSentence: (s) => addSentence({ notebookId, ...s }, d),

  propose: (p) => saveProposal(notebookId, p, d),

  // The workbook says what happened; it does not get to say which workbook it was or when.
  recordPractice: (e) => recordPractice({ ...e, notebookId, workbookId }, d),
})

/**
 * The AI surface, with the notebook's language already bound.
 *
 * `speak` takes only the text because a workbook should not be able to ask for the wrong language for
 * the notebook it is running in.
 */
export const aiFor = (language: string): AI => ({
  complete: (input, opts) => complete(input, opts ?? {}),
  completeJson: (input, opts) => completeJson(input, opts),
  speak: (text) => speak(text, language),
  draw: (prompt) => drawOne(prompt),
  animate: (prompt, signal) => animate(prompt, signal),
})
