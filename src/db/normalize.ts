/**
 * Term normalization. Technical plan §3.
 *
 * NFC matters more than it looks. macOS hands over decomposed Hangul, so ㅎ+ㅏ+ㄴ typed on a Mac and
 * 한 pasted from a website are different strings until normalized. Without this you get silent
 * duplicate words that look identical on screen.
 */
export const normalizeTerm = (s: string): string =>
  s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()

/**
 * True when the language is written without spaces between words, so `Intl.Segmenter` cannot be
 * trusted for word boundaries. Matched on the leading subtag so 'ko-KR' and 'Korean' both land.
 */
const UNSEGMENTED = /^(ko|ja|zh|th|lo|km|my)\b/i
const UNSEGMENTED_NAMES = /^(korean|japanese|chinese|mandarin|cantonese|thai|lao|khmer|burmese)\b/i

export const isUnsegmented = (language: string): boolean => {
  const s = language.trim()
  return UNSEGMENTED.test(s) || UNSEGMENTED_NAMES.test(s)
}

/**
 * Does `term` appear in `sentence`? Drives the derived Word -> Sentence link.
 *
 * For space-delimited languages this walks `Intl.Segmenter` word boundaries, so 'car' does not match
 * inside 'scarf'. For Korean and Chinese, segmentation is unreliable, so it falls back to a substring
 * match on the normalized forms. That over-matches occasionally, which is accepted: the link is a UI
 * convenience rather than data anything depends on, and the learner can remove a wrong one.
 */
export const termAppearsIn = (term: string, sentence: string, language: string): boolean => {
  const t = normalizeTerm(term)
  if (t === '') return false
  const s = normalizeTerm(sentence)
  if (!s.includes(t)) return false
  if (isUnsegmented(language)) return true

  // A multi-word term already carries its own boundaries, and the substring hit is enough.
  if (t.includes(' ')) return true

  const seg = new Intl.Segmenter(undefined, { granularity: 'word' })
  for (const { segment, isWordLike } of seg.segment(s)) {
    if (isWordLike && normalizeTerm(segment) === t) return true
  }
  return false
}
