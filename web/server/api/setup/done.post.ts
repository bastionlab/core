/** the setup wizard was finished or skipped: stop sending the owner there */
export default defineEventHandler(() => { metaSet('setup_done', '1'); return { ok: true } })
