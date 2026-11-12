# Workbook pedagogy: first design pass

This adapts the supplied KLEAR-Anki framework to the six workbooks. It is a design
hypothesis and an exercise audit, not a literature review or a validated learning
protocol. No live generated sessions or delayed retention outcomes were evaluated
in this pass. Automated tests check software behavior, not teaching effectiveness.

## What transfers from the framework

- Give each prompt one identifiable learning target and clear instructions.
- Supply incidental vocabulary when needed; keep the target to be produced.
- Keep the target stable across a small practice cluster. Fade explicit guidance
  before asking for new complexity.
- Make feedback actionable: one priority correction, with minimal changes to the
  learner's meaning. An already natural answer stays unchanged.
- Distinguish supported practice from evidence of independent production.

A saved notebook item is evidence of exposure, not proof that its vocabulary or
grammar is mastered. The app cannot enforce “exactly one unknown” from this data.
Prompts constrain complexity but do not establish prerequisites.

Some Anki rules need different treatment here. Listening and story reading are
legitimate comprehension activities. Descriptions and conversations can have many
correct answers: determinacy means clear facts and success criteria, not identical
wording. We do not assume production automatically transfers to listening. The
other project's Korean conventions and TTS provider are not global requirements
for this multilingual app.

## Exercise audit and implemented changes

| Workbook | Gap | Current design | Still needs testing |
| --- | --- | --- | --- |
| Word drill | Random initial questions/negation could add unfamiliar grammar; a correct target word could pass despite ignoring the cue. | Concrete first use from notebook patterns; same-pattern follow-ups with less guidance; repair the target error before changing task. Mark the intended meaning and the requested message together. | Whether cue variety feels useful, target usage judgments are accurate, and incidental-word hints are sufficient. |
| Sentence drill | Random tense, register, and reason transformations could replace the learning target. Correct answers were always embellished. | First change exactly one fact while preserving grammar/register. Supply familiar substitution vocabulary from the notebook. Continue with the same pattern and less guidance. Keep natural answers unchanged. | Whether models preserve the source construction, allow legitimate alternatives, and actually fade cues without introducing unknown forms. |
| Picture description | A crowded scene and “describe enough” standard made success unclear; omissions could feel like errors. | Uncluttered scene around two or three drawable words. Visible task: name something and describe its action or location in 1–3 sentences. Minimal correction; at most one optional extension. | Image accuracy, visual ambiguity, evaluator agreement, and whether beginners need a starter pattern. |
| Listening | Generic questions could mix gist, inference, and several facts; feedback did not identify supporting audio. | Gist first, then one fact per detail question. Require explicit audio evidence, accept either response language, and quote the relevant speaker/phrase in feedback. Reject invalid speaker indices and incomplete marking arrays. | Whether questions leak answers, speech is intelligible, and learners can locate a missed detail after feedback. |
| Roleplay | Mandatory obstacles and a minimum conversation length could prevent completion or demand unknown grammar. | Supply a role, usable facts, and a concrete outcome. One detail at a time; at most one manageable obstacle. Confirm completion as soon as the outcome is settled. | Whether the task facts are sufficient, completion is judged accurately, and repair requests elicit useful simpler language. |
| Story | Choosing a branch could become arbitrary tapping; too much notebook material could overload each scene. | Use a small recurring set of words/patterns. Give short, distinct actions with understandable consequences; require the next scene to honor the choice. | Whether reading is necessary to choose, images allow guessing, and repeated forms remain comprehensible in fresh contexts. |

## Concrete examples of the intended behavior

With a saved sentence meaning “I eat an apple,” begin with “Say you eat a banana
(polite).” Supply the word for banana if needed. Keep the sentence pattern. A later
cue can ask for the same pattern with another known food and less guidance. Do not
jump to “Explain why you would have eaten it if you had time.” These are design
examples, not hard-coded generated items.

If the learner writes a correct, natural short sentence, return that sentence as
the model. If its target ending is wrong, name that issue and request a repair of
the same message. Do not correct five unrelated issues or demand a longer answer
as the price of being marked correct.

A description of one visible person and their action can satisfy the picture task
even when several background objects are unmentioned. A roleplay about agreeing
a meeting time ends once both parties agree; it does not need a new obstacle to
reach an arbitrary message count.

## Evidence and scaffolding limits

The drill header still displays the target word or sentence; prior feedback also
remains visible. These are guided usage exercises, not tests of unaided vocabulary
recall. Fading is currently instructed in prompts, not enforced by hiding answers.
There is no delayed retrieval schedule or deliberate interleaving across targets.

Drill rounds persist whether the full help answer was revealed. A submission after
that reveal is recorded as `shown`, rather than `right` or `wrong`, while still
receiving feedback. An immediate repair after an incorrect answer is also marked
as supported because the correction is already visible. New follow-up situations
can provide another attempt; they are still within-session practice, not proof of
long-term learning. Older sessions cannot reconstruct help usage they never stored.

Picture descriptions after the full model reveal do not add successful-production
events. The picture is not persisted; drawing a replacement starts a fresh attempt.
Stories and listening retain their existing exposure/help semantics, without
claiming that a branch selection or comprehension answer proves production mastery.
Roleplay completion records communicative usage; it is not a grammar assessment.

## Next validation pass

For each workbook, collect actual prompts, learner answers, help taken, feedback,
and a later attempt on a new example. Include a sparse notebook, unfamiliar forms,
multiple valid answers, a correct but unrelated response, and an incorrect target
inside an otherwise understandable answer. Test more than one language and script.

Review these separately:

1. **Task validity:** Is it clear what the learner must do? Is the target actually
   required? Are incidental demands supported? Can it be solved by copying?
2. **Feedback validity:** Does the model accept equivalent answers, reject a wrong
   target, preserve meaning, and identify one useful next action?
3. **Learner experience:** Can the learner start? What needs help? Is difficulty
   caused by retrieval or by unclear instructions and missing prerequisites?
4. **Transfer:** Can the learner use or understand the same target in a fresh
   example later, with less support? Record assisted and unassisted results apart.

Then research each exercise's specific learning claim against primary studies,
including population, proficiency, task, feedback timing, and delayed outcome.
Prioritize guided pattern practice, corrective feedback and repair, listening
support, task-based interaction, and reading/choice comprehension separately.
A result for Anki recall cards should not be treated as validation for all six.
