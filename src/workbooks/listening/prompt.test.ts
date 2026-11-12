import { describe, expect, it } from 'vitest'
import { isDialog, transcript, type Dialog } from './prompt'

const dialog: Dialog = {
  speakers: ['민수', '수진'],
  turns: [
    { speaker: 0, line: '내일 만나요.' },
    { speaker: 1, line: '두 시에 만나요.' },
  ],
  questions: ['When will they meet?'],
  used: ['내일'],
}

describe('listening dialog integrity', () => {
  it('keeps speaker attribution intact for the transcript used to mark answers', () => {
    expect(isDialog(dialog)).toBe(true)
    expect(transcript(dialog)).toBe('민수: 내일 만나요.\n수진: 두 시에 만나요.')
  })

  it('rejects speakers that the two-voice player cannot represent', () => {
    for (const speaker of [-1, 2, 0.5, NaN, '0']) {
      expect(isDialog({ ...dialog, turns: [{ speaker, line: '내일 만나요.' }] })).toBe(false)
    }
    expect(isDialog({ ...dialog, speakers: ['민수'] })).toBe(false)
    expect(isDialog({ ...dialog, speakers: ['민수', '수진', '지수'] })).toBe(false)
  })

  it('rejects empty audio content and missing comprehension questions', () => {
    expect(isDialog({ ...dialog, turns: [{ speaker: 0, line: '  ' }] })).toBe(false)
    expect(isDialog({ ...dialog, turns: [] })).toBe(false)
    expect(isDialog({ ...dialog, questions: [] })).toBe(false)
  })
})
