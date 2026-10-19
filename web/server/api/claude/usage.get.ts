/** the subscription's 5-hour and weekly use, as the newest Claude turn (or refresh) reported it */
export default defineEventHandler(event => agent(event, '/claude/usage'))
