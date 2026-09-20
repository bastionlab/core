/**
 * Natural language -> a filled-in search form, via granite4.2:8b in CT 105.
 *
 * granite is used rather than qwen3.6 because warm-model keeps it resident and
 * only one model fits in 12 GB of VRAM: composing a search should not evict
 * whatever the Ask bar or Chat page is using. `think: false` matters a lot here
 * -- with thinking on, the same call spends ~5400 tokens and 115s instead of
 * ~215 tokens and 4s.
 */
const MODEL = 'granite4.2:8b'

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    keyword: { type: 'string' },
    terms: { type: 'array', items: { type: 'string' } },
    exclude: { type: 'array', items: { type: 'string' } },
    minPrice: { type: ['integer', 'null'] },
    maxPrice: { type: ['integer', 'null'] },
    radius: { type: 'integer' },
    shipping: { type: 'string', enum: ['any', 'ship', 'pickup'] },
    intent: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['name', 'keyword', 'terms', 'exclude', 'minPrice', 'maxPrice', 'radius', 'shipping', 'intent', 'note'],
}

const SYSTEM = `Du baust Suchfilter fuer Kleinanzeigen.de. Aus einer Beschreibung in Alltagssprache machst du ein Filter-Objekt. Antworte NUR mit JSON.

FELDER

name: kurzer Slug, 1-2 Woerter, klein, ohne Umlaute.

keyword: exakt das, was man in die Kleinanzeigen-Suchmaske tippt. 2-3 Woerter, nur Produktkategorie plus das wichtigste Merkmal.
VERBOTEN im keyword: Zustand (gebraucht, neu, defekt, neuwertig), Wertung (guenstig, gut, schnaeppchen, top), Preise, Orte, Versandwoerter.
Je kuerzer, desto mehr Treffer. Lieber zu allgemein als zu eng.

terms: eine Anzeige wird nur behalten, wenn Titel oder Beschreibung MINDESTENS EINEN dieser Schnipsel enthaelt.
Nur Woerter, die realistisch in einer Anzeige stehen: Modellnamen, Groessen, Schreibvarianten, Synonyme.
Niemals Absichten oder Taetigkeiten (kein "pendeln", kein "geschenk"). Alles klein. 3-8 Eintraege.

exclude: eine Anzeige wird verworfen, sobald sie EINEN dieser Schnipsel enthaelt. Das ist der wichtigste Teil.
Hier kommt rein, was die Suche zumuellt: Zubehoer zum gesuchten Produkt, Ersatzteile, defekte Ware, Tauschgesuche.
Denke konkret an DIESE Produktkategorie. Alles klein. 4-10 Eintraege.
Niemals Zustands- oder Wertungswoerter ausschliessen (nicht "neu", nicht "gebraucht"), die stehen in fast jeder guten Anzeige.

minPrice / maxPrice: ganze Euro oder null. Nie 0 schreiben, dann null.
intent: ein bis zwei deutsche Saetze, die beschreiben, was WIRKLICH als Treffer zaehlt.
Hier gehoeren harte Bedingungen hinein, die Stichwoerter nicht ausdruecken koennen:
Mindestgroessen ("mindestens 6 TB", "mindestens 27 Zoll"), ausgeschlossene Bauformen
(keine Gehaeuse, keine Komplett-PCs, kein Zubehoer). Schreibe Zahlen immer als
"mindestens N TB" oder "maximal N GB", nie als Bereich.

radius: km um Berlin, Standard 10.
shipping: "pickup" nur bei Abholung, "ship" wenn verschickt werden soll, sonst "any".
note: ein kurzer deutscher Satz zu deinen Annahmen.

BEISPIELE

Eingabe: gebrauchte 27 zoll monitore, am besten wqhd, nur abholen, maximal 150 euro
{"name":"monitor","keyword":"monitor 27 zoll","terms":["27 zoll","27\\"","wqhd","1440p","qhd"],"exclude":["halterung","vesa","kabel","standfuss","defekt","kaputt","ersatzteil","tv","fernseher"],"minPrice":null,"maxPrice":150,"radius":10,"shipping":"pickup","intent":"Monitor mit mindestens 27 Zoll, moeglichst WQHD. Keine Halterungen, keine Kabel, keine Fernseher.","note":"27-Zoll-Monitore bis 150 EUR, nur Abholung in Berlin."}

Eingabe: airpods pro, gerne auch verschickt, so bis 120
{"name":"airpods","keyword":"airpods pro","terms":["airpods pro","airpods","pro 2"],"exclude":["huelle","case only","nur case","ladecase","ersatz","links","rechts","einzeln","replica","nachbau","defekt"],"minPrice":30,"maxPrice":120,"radius":10,"shipping":"ship","intent":"Vollstaendige AirPods Pro, beide Ohrhoerer plus Ladecase. Keine Einzelteile, keine Nachbauten, kein Zubehoer.","note":"AirPods Pro bis 120 EUR, Versand erlaubt; Mindestpreis gegen Faelschungen."}`

/**
 * Words that appear in perfectly good listings. A small model likes to put
 * these in `exclude`, where they quietly delete most of the results -- the PS5
 * test run excluded both "neu" and "gebraucht". The form is reviewed by hand
 * before saving, but these are the ones a person would not think to check.
 */
const SELF_DEFEATING = new Set([
  'neu', 'neuwertig', 'gebraucht', 'used', 'new', 'gut', 'guenstig', 'günstig',
  'schnaeppchen', 'schnäppchen', 'top', 'ovp', 'originalverpackt', 'zubehör',
  'zubehoer', 'accessory', 'teile', 'inkl', 'set',
])

const clean = (xs: any): string[] =>
  (Array.isArray(xs) ? xs : []).map(x => String(x ?? '').trim().toLowerCase()).filter(Boolean)

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const prompt = String(body?.prompt ?? '').trim().slice(0, 600)
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'describe what you are looking for' })

  const res: any = await ollama(event, '/api/chat', {
    method: 'POST',
    timeout: 120_000,
    body: {
      model: MODEL,
      stream: false,
      think: false,
      format: SCHEMA,
      options: { temperature: 0.2 },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    },
  })

  let out: any
  try {
    out = JSON.parse(res?.message?.content ?? '{}')
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'the model did not return usable JSON — try rephrasing' })
  }

  const terms = clean(out.terms)
  // an exclude that also sits in terms would cancel the search out entirely
  const exclude = clean(out.exclude).filter(x => !SELF_DEFEATING.has(x) && !terms.includes(x))
  const price = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null)

  return {
    name: String(out.name ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48),
    keyword: String(out.keyword ?? '').trim().slice(0, 120),
    terms: terms.join(', '),
    exclude: exclude.join(', '),
    minPrice: price(out.minPrice),
    maxPrice: price(out.maxPrice),
    radius: Math.min(Math.max(Number(out.radius) || 10, 0), 200),
    shipping: ['any', 'ship', 'pickup'].includes(out.shipping) ? out.shipping : 'any',
    intent: String(out.intent ?? '').trim().slice(0, 600),
    note: String(out.note ?? '').trim().slice(0, 300),
    model: MODEL,
  }
})
