/** the page's data; anything on the host goes through the agent (agent/__ID__.py), never a raw address */
export default defineEventHandler(event => agent(event, '/__ID__/hello'))
