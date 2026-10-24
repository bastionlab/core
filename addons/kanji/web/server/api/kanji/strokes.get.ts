import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Stroke order from KanjiVG (CC BY-SA 3.0), fetched once per kanji from jsDelivr and cached in CT 104.
 * Only the stroke paths and number positions are kept: the page draws its own SVG, nothing from the file is rendered.
 */
const DIR = join(process.env.NOTES_DIR || '/var/lib/dash', 'kanjivg')
const NUM = /^-?\d+(\.\d+)?$/

export default defineEventHandler(async (event) => {
  const k = String(getQuery(event).k ?? '')
  if (!DECK.some(x => x.k === k)) throw createError({ statusCode: 404, statusMessage: 'no such kanji' })
  const hex = k.codePointAt(0)!.toString(16).padStart(5, '0')
  const file = join(DIR, `${hex}.json`)
  setHeader(event, 'cache-control', 'private, max-age=604800')
  try { return JSON.parse(await readFile(file, 'utf8')) } catch {}
  const r = await fetch(`https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/${hex}.svg`, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw createError({ statusCode: 404, statusMessage: 'no stroke order for this kanji' })
  const svg = await r.text()
  const paths = [...svg.matchAll(/<path[^>]*\sd="([MmCcSsLlHhVvZz0-9.,\s-]+)"/g)].map(m => m[1]!.trim())
  const nums = [...svg.matchAll(/<text[^>]*transform="matrix\(1 0 0 1 ([\d.-]+) ([\d.-]+)\)"[^>]*>(\d+)<\/text>/g)]
    .filter(m => NUM.test(m[1]!) && NUM.test(m[2]!)).map(m => [Number(m[1]), Number(m[2]), Number(m[3])])
  if (!paths.length) throw createError({ statusCode: 502, statusMessage: 'unreadable stroke data' })
  const out = { paths, nums }
  await mkdir(DIR, { recursive: true })
  await writeFile(file, JSON.stringify(out))
  return out
})
