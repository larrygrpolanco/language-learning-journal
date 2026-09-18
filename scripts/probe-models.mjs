/**
 * Throwaway probe. Answers three questions the docs do not, for each candidate model:
 *   1. does it accept `reasoning: { effort }` at all
 *   2. does it honour `text.format` json_schema with strict
 *   3. does it read an `input_image` part
 *
 * Run with: node --use-system-ca scripts/probe-models.mjs
 *
 * `--use-system-ca` is not optional on this machine. Moffitt's TLS inspection presents a self-signed
 * chain that Node's bundled CA list rejects with SELF_SIGNED_CERT_IN_CHAIN, and the flag makes Node
 * read the Windows store instead. Do not reach for NODE_TLS_REJECT_UNAUTHORIZED.
 *
 * Reads the key from .env and never prints it.
 */
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const key = /XAI[_A-Z]*KEY\s*=\s*"?([^"\r\n]+)"?/.exec(env)?.[1]?.trim()
if (!key) throw new Error('no xAI key found in .env')

const MODELS = ['grok-4.6', 'grok-4.3', 'grok-4.20-0309-non-reasoning', 'grok-build-0.1']

// A real PNG off disk. A hand-rolled base64 one is rejected as "Invalid PNG image", which reads like
// a model limitation and is not one.
const PNG = `data:image/png;base64,${readFileSync(new URL('../public/icon-192.png', import.meta.url)).toString('base64')}`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['colour'],
  properties: { colour: { type: 'string' } },
}

const post = async (body) => {
  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, note: `${res.status} non-json` }
  }
  if (!res.ok) {
    const msg = json.error?.message ?? json.error ?? JSON.stringify(json).slice(0, 160)
    return { ok: false, note: `${res.status} ${String(msg).slice(0, 140)}` }
  }
  const message = json.output?.find((o) => o.type === 'message')
  const out = (message?.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('')
    .trim()
  const reasoning = json.usage?.output_tokens_details?.reasoning_tokens
  return { ok: true, out: out.slice(0, 90), reasoning, usage: json.usage?.total_tokens }
}

const probes = {
  'effort:low': (model) => ({
    model,
    input: [{ role: 'user', content: 'Reply with the single word: ready' }],
    reasoning: { effort: 'low' },
  }),
  'no-effort': (model) => ({
    model,
    input: [{ role: 'user', content: 'Reply with the single word: ready' }],
  }),
  'json-schema': (model) => ({
    model,
    input: [{ role: 'user', content: 'The colour is red. Answer as JSON.' }],
    text: { format: { type: 'json_schema', name: 'probe', strict: true, schema: SCHEMA } },
  }),
  image: (model) => ({
    model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Reply with one word: what shape is in this image?' },
          { type: 'input_image', image_url: PNG },
        ],
      },
    ],
  }),
}

for (const model of MODELS) {
  console.log(`\n=== ${model} ===`)
  for (const [name, build] of Object.entries(probes)) {
    const t = Date.now()
    const r = await post(build(model))
    const ms = Date.now() - t
    if (r.ok) {
      const reasoning = r.reasoning === undefined ? '' : ` reasoning=${r.reasoning}`
      console.log(`  ${name.padEnd(12)} OK   ${ms}ms tokens=${r.usage}${reasoning}  "${r.out}"`)
    } else {
      console.log(`  ${name.padEnd(12)} FAIL ${ms}ms ${r.note}`)
    }
  }
}
