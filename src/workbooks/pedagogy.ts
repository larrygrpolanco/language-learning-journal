import type { ContextBundle } from './sdk'

/** Design constraints, not a level estimate or evidence that an item is mastered. */
export const productionRules = (bundle: ContextBundle): string => {
  const meaning = bundle.profile?.meaningLanguage ?? 'English'
  return [
    '- Keep one learning target per prompt. State the intended meaning, relevant facts, and register; never make the learner invent missing facts to discover what is being tested.',
    '- Use notebook vocabulary and attested sentence patterns as support, not proof of mastery. Do not assume an unseen tense, connector, or register is basic just because it is common.',
    `- If an incidental word is essential but absent from the notebook, supply it with a short ${meaning} gloss as support. Never supply the form being tested or a completed answer in the cue.`,
    '- Start with a concrete, short use. Subsequent rounds keep the same target and remove an explicit pattern cue before adding complexity. Do not require new grammar to make a task harder.',
    '- Accept equivalent natural answers that meet the cue. A model answer is an example, not the only acceptable wording.',
    '- Feedback identifies at most one actionable issue, prioritizing the target. Preserve the learner\'s intended meaning and keep an already natural answer unchanged.',
    '- Use the target language\'s ordinary script, without romanization unless that script is itself Latin.',
  ].join('\n')
}

/** A revealed answer provides practice, not evidence of independent production. */
export const drillOutcome = (right: boolean, modelShown: boolean): 'right' | 'wrong' | 'shown' =>
  modelShown ? 'shown' : right ? 'right' : 'wrong'
