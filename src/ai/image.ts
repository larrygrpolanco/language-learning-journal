import { AiError, base64ToBlob, postJson } from './client'
import { MODELS } from './models'

/**
 * Images. Technical plan §9, and an improvement on it.
 *
 * The plan says image responses come back as xAI-hosted URLs that expire, so the bytes have to be
 * fetched in the same tick. True, and avoidable: `response_format: 'b64_json'` puts the bytes inline
 * on the `api.x.ai` response instead. Both confirmed by probe 2026-09-15.
 *
 * Inline is the better choice here for two reasons beyond expiry. The URL sits on `imgen.x.ai`, a
 * second origin whose CORS policy is neither documented nor confirmed, and this app has no server to
 * proxy through if it turns out to refuse a browser. And there is no window in which a stored URL can
 * be mistaken for something durable, because there is no URL.
 *
 * The cost is that a 400kB image arrives as 530kB of base64. For a personal app pressing this by hand,
 * that is nothing next to a capability that might simply not work.
 */

interface ImagesBody {
  data?: { b64_json?: string; url?: string; mime_type?: string }[]
}

export interface DrawOptions {
  /** More than one image from one prompt. The API returns them in `data`. */
  count?: number
}

/**
 * Draws from a prompt.
 *
 * Defined and wired, but no v1 workbook calls it. The adapter exists so that adding an illustrated
 * exercise later is a workbook folder rather than a restructuring.
 */
export const draw = async (prompt: string, opts: DrawOptions = {}): Promise<Blob[]> => {
  const body = await postJson<ImagesBody>('/images/generations', {
    model: MODELS.image,
    prompt,
    response_format: 'b64_json',
    ...(opts.count !== undefined ? { n: opts.count } : {}),
  })

  const blobs = (body.data ?? []).flatMap((d) =>
    d.b64_json ? [base64ToBlob(d.b64_json, d.mime_type ?? 'image/jpeg')] : [],
  )
  if (blobs.length === 0) throw new AiError('unreadable', 'xAI returned no image.')
  return blobs
}

/** One image, for the common case. */
export const drawOne = async (prompt: string): Promise<Blob> => {
  const [first] = await draw(prompt)
  if (!first) throw new AiError('unreadable', 'xAI returned no image.')
  return first
}
