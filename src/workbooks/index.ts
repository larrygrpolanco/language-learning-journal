import { wordDrill } from './word-drill/manifest'
import { roleplay } from './roleplay/manifest'
import { story } from './story/manifest'
import { listening } from './listening/manifest'
import type { AnyWorkbook } from './sdk'

/**
 * The registry. Technical plan §8.
 *
 * Adding a workbook is a folder and one line in this array. Deliberately a plain array rather than a
 * loader or a plugin system: there will be a handful of these, they all ship in the bundle, and a
 * dynamic import would buy nothing but a way for the list to be wrong at runtime.
 *
 * The order is the order on the practice page, and the first row gets the primary button. Word drill
 * leads because it is the one that works on the thinnest notebook.
 */
export const WORKBOOKS: readonly AnyWorkbook[] = [wordDrill, roleplay, story, listening]

export const workbookById = (id: string): AnyWorkbook | undefined =>
  WORKBOOKS.find((w) => w.id === id)
