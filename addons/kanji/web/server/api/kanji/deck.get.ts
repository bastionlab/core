/** the whole deck (static, ~0.5 MB): the browse grid and search work on it in the page */
export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'private, max-age=86400')
  return DECK
})
