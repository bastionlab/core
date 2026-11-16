/** Claude sign-in state on pve (and the pending login's URL, if one is running) */
export default defineEventHandler(event => agent(event, '/claude/auth'))
