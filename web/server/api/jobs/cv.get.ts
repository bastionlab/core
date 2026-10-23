/** the uploaded CV: file name, when, and the profile the model read out of it; ?search= = what that search reads against */
export default defineEventHandler((event) => {
  const search = Number(getQuery(event).search)
  return deals(event, '/jobs/cv', { query: Number.isInteger(search) && search > 0 ? { search } : {} })
})
