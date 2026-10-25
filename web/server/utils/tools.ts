import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** Tools the Ask bar exposes to the model: search the web, read a page, look up the weather. */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web. Use for anything not in the server snapshot: news, docs, prices, model releases, how-tos.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_page',
      description: 'Fetch a public web page and return its text. Use after web_search when a snippet is not enough.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'absolute http(s) URL' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'weather',
      description: 'Current weather and a short forecast for a place. Defaults to the server location.',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string', description: 'city or place name, e.g. "Berlin"' } },
      },
    },
  },
]

const SEARXNG = () => `http://${ctIp('ai')}:8888`
const HOME = { name: 'home', lat: 52.52, lon: 13.405 } // fallback when no location is given

/** the model must not be able to reach the LAN, the tailnet or the host itself through fetch_page */
const BLOCKED = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80:/i]
const isPrivate = (ip: string) => BLOCKED.some(re => re.test(ip))

async function publicUrl(raw: string) {
  const u = new URL(raw)
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) URLs')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map(a => a.address)
  if (!ips.length || ips.some(isPrivate)) throw new Error('refusing to fetch a private/internal address')
  return u
}

const text = (html: string) =>
  html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, m => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[m] ?? ' '))
    .replace(/\s+/g, ' ')
    .trim()

async function webSearch(query: string) {
  const r: any = await $fetch('/search', { baseURL: SEARXNG(), query: { q: query, format: 'json' }, timeout: 20_000 })
  const hits = (r.results ?? []).slice(0, 6).map((x: any) => ({ title: x.title, url: x.url, snippet: (x.content ?? '').slice(0, 400), published: x.publishedDate }))
  return hits.length ? { query, results: hits } : { query, results: [], note: 'no results' }
}

async function fetchPage(url: string) {
  const u = await publicUrl(url)
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bastion/1.0)' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (new URL(res.url).hostname !== u.hostname) await publicUrl(res.url) // a redirect must not land inside the network either
  const body = (await res.text()).slice(0, 400_000)
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
  return { url: res.url, title, text: text(body).slice(0, 6000) }
}

async function weather(location?: string) {
  let place = HOME
  if (location) {
    const g: any = await $fetch('https://geocoding-api.open-meteo.com/v1/search', { query: { name: location, count: 1, language: 'de' }, timeout: 15_000 })
    const hit = g.results?.[0]
    if (!hit) return { error: `unknown place: ${location}` }
    place = { name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '), lat: hit.latitude, lon: hit.longitude }
  }
  const w: any = await $fetch('https://api.open-meteo.com/v1/forecast', {
    query: {
      latitude: place.lat, longitude: place.lon, timezone: 'Europe/Berlin', forecast_days: 3,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    },
    timeout: 15_000,
  })
  return { place: place.name, units: '°C, mm, km/h', current: w.current, daily: w.daily, weather_code: 'WMO code' }
}

/** run one tool call; errors come back as data so the model can react instead of the stream dying */
export async function runTool(name: string, args: any) {
  try {
    if (name === 'web_search') return await webSearch(String(args?.query ?? ''))
    if (name === 'fetch_page') return await fetchPage(String(args?.url ?? ''))
    if (name === 'weather') return await weather(args?.location ? String(args.location) : undefined)
    return { error: `unknown tool ${name}` }
  } catch (e: any) {
    return { error: e?.message ?? String(e) }
  }
}
