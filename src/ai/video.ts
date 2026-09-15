import { AiError, bytesToBlob, getJson, postJson } from './client'
import { MODELS } from './models'

/**
 * Video. Technical plan §9.
 *
 * Defined and unused. §9 asks for the adapter so no restructuring is needed later, and nothing in v1
 * calls it: it is the most expensive capability by a wide margin, and no workbook wants it yet.
 *
 * **This is the one route in `ai/` that has not been probed.** Text, TTS and images were all verified
 * against the live API before being written; this is against the documented shape only. Treat the
 * generation-then-poll flow below as unconfirmed, and probe it before the first workbook that needs it.
 * Saying so in the file is the honest alternative to a comment claiming it works.
 */

interface VideoBody {
  id?: string
  status?: 'queued' | 'in_progress' | 'completed' | 'failed'
  /** Present once `status` is `completed`. Expires, hence the immediate fetch below. */
  url?: string
  error?: string
}

/** Poll interval and ceiling. Generation is minutes, not seconds. */
const POLL_MS = 4000
const POLL_LIMIT = 90

/**
 * Animates a prompt, polling until it is done.
 *
 * The poll loop is the one thing in this app that waits, and it is not background work: it runs
 * because the learner pressed something and is watching. It stops when `signal` aborts, which is what
 * closing the sheet does.
 */
export const animate = async (prompt: string, signal?: AbortSignal): Promise<Blob> => {
  const started = await postJson<VideoBody>('/videos/generations', {
    model: MODELS.video,
    prompt,
  })
  if (!started.id) throw new AiError('unreadable', 'xAI did not start a video.')

  for (let i = 0; i < POLL_LIMIT; i += 1) {
    if (signal?.aborted) throw new AiError('offline', 'Stopped.')

    const status = await getJson<VideoBody>(`/videos/${started.id}`)
    if (status.status === 'failed') {
      throw new AiError('refused', status.error ?? 'That video could not be made.')
    }
    if (status.status === 'completed' && status.url) {
      // Same rule as everywhere else: the URL expires, so the bytes come across now or never.
      const res = await fetch(status.url)
      if (!res.ok) throw new AiError('refused', 'The finished video could not be fetched.', res.status)
      return bytesToBlob(new Uint8Array(await res.arrayBuffer()), 'video/mp4')
    }

    await new Promise((r) => setTimeout(r, POLL_MS))
  }

  throw new AiError('refused', 'That video took too long.')
}
