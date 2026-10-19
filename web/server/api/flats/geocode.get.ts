/** place name or pin -> where the search form will look (Nominatim, resolved in CT 107) */
export default defineEventHandler(async (event) => {
  const { q, lat, lon } = getQuery(event)
  const n = (v: any) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v))
  if (n(lat) !== undefined && n(lon) !== undefined)
    return deals(event, '/flats/geocode', { query: { lat: n(lat), lon: n(lon) } })
  const place = String(q ?? '').trim().slice(0, 120)
  if (!place) throw createError({ statusCode: 400, statusMessage: 'Ort fehlt' })
  return deals(event, '/flats/geocode', { query: { q: place } })
})
