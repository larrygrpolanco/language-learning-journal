import { wordDrill } from './word-drill/manifest'
import type { AnyWorkbook } from './sdk'

/**
 * The registry. Technical plan §8.
 *
 * Adding a workbook is a folder and one line in this array. Deliberately a plain array rather than a
 * loader or a plugin system: there will be a handful of these, they all ship in the bundle, and a
 * dynamic import would buy nothing but a way for the list to be wrong at runtime.
 */
export const WORKBOOKS: readonly AnyWorkbook[] = [wordDrill]

export const workbookById = (id: string): AnyWorkbook | undefined =>
  WORKBOOKS.find((w) => w.id === id)
