/** every note — a personal notebook stays small, so the page searches, filters and sorts on its own */
export default defineEventHandler(() => ({ notes: listNotes() }))
