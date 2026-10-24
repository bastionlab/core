// open the notes DB at startup, so AI jobs that were queued when the server stopped resume right away
export default defineNitroPlugin(() => { listNotes() })
