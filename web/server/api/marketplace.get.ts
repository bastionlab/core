/** marketplace index + install state per add-on; ?fresh=1 skips the 10-minute cache */
export default defineEventHandler(event => marketplace(getQuery(event).fresh === '1'))
