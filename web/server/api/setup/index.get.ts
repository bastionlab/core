/** first-run state: is there an owner account, has the setup been finished or skipped */
export default defineEventHandler(() => ({ accounts: anyUsers(), done: metaGet('setup_done') === '1' }))
