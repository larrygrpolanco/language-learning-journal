import { describe, expect, it } from 'vitest'
import { isUnsegmented, normalizeTerm, termAppearsIn } from './normalize'

describe('normalizeTerm', () => {
  it('folds decomposed Hangul onto composed Hangul', () => {
    // What a Mac hands over vs. what a website pastes. Identical on screen, different strings.
    const decomposed = '\u1112\u1161\u11AB' // ㅎ + ㅏ + ㄴ
    const composed = '\uD55C' // 한
    expect(decomposed).not.toBe(composed)
    expect(normalizeTerm(decomposed)).toBe(normalizeTerm(composed))
  })

  it('folds a decomposed multi-syllable word', () => {
    const decomposed = '\u1109\u116E\u1100\u1169'.normalize('NFD') // 수고
    expect(normalizeTerm(decomposed)).toBe(normalizeTerm('수고'))
  })

  it('collapses whitespace and trims', () => {
    expect(normalizeTerm('  echar   de  menos ')).toBe('echar de menos')
    expect(normalizeTerm('수고\t하셨습니다')).toBe('수고 하셨습니다')
  })

  it('lowercases so a sentence-initial capture matches a later one', () => {
    expect(normalizeTerm('Interés')).toBe(normalizeTerm('interés'))
  })

  it('leaves an accent alone rather than stripping it', () => {
    // interés and interes are different words. NFC must not flatten them.
    expect(normalizeTerm('interés')).not.toBe(normalizeTerm('interes'))
  })

  it('is idempotent', () => {
    const once = normalizeTerm(' Échar  DE menos ')
    expect(normalizeTerm(once)).toBe(once)
  })
})

describe('isUnsegmented', () => {
  it('catches the languages Intl.Segmenter cannot be trusted on', () => {
    for (const l of ['ko', 'ko-KR', 'Korean', 'ja', 'Japanese', 'zh-Hans', 'Chinese', 'Thai']) {
      expect(isUnsegmented(l)).toBe(true)
    }
  })

  it('leaves space-delimited languages to the segmenter', () => {
    for (const l of ['en', 'en-US', 'Spanish', 'es', 'French', 'de']) {
      expect(isUnsegmented(l)).toBe(false)
    }
  })
})

describe('termAppearsIn', () => {
  it('respects word boundaries in English', () => {
    expect(termAppearsIn('car', 'I drove the car home.', 'en')).toBe(true)
    expect(termAppearsIn('car', 'She wore a scarf.', 'en')).toBe(false)
  })

  it('matches a multi-word Spanish expression', () => {
    expect(termAppearsIn('echar de menos', 'Te echar de menos mucho.', 'es')).toBe(true)
  })

  it('is case and whitespace insensitive', () => {
    expect(termAppearsIn(' Interés ', 'El INTERÉS es alto.', 'es')).toBe(true)
  })

  it('substring-matches Korean, over-matching on purpose', () => {
    expect(termAppearsIn('수고', '오늘 수고하셨습니다.', 'ko')).toBe(true)
    // The documented cost of skipping segmentation: a real substring hit inside a longer word.
    expect(termAppearsIn('고하', '오늘 수고하셨습니다.', 'ko')).toBe(true)
  })

  it('matches Korean across the NFC boundary', () => {
    const term = '수고'.normalize('NFD')
    expect(termAppearsIn(term, '오늘 수고하셨습니다.', 'Korean')).toBe(true)
  })

  it('finds nothing for an empty or absent term', () => {
    expect(termAppearsIn('', 'anything', 'en')).toBe(false)
    expect(termAppearsIn('   ', 'anything', 'en')).toBe(false)
    expect(termAppearsIn('bicycle', '오늘 수고하셨습니다.', 'ko')).toBe(false)
  })
})
