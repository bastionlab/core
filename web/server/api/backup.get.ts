/** Settings → Backup: schedule, the backups there are, whether a passphrase is set */
export default defineEventHandler(event => agent(event, '/backup'))
