/** the free text about the applicants that every drafted message is written from; ?search= for a search's own */
export default defineEventHandler((event) => {
  const search = Number(getQuery(event).search)
  return deals(event, '/flats/profile', { query: Number.isInteger(search) && search > 0 ? { search } : {} })
})
