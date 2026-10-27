/** on-demand download speed test, run by the agent (reads only: nothing on the box changes) */
export default defineEventHandler(event => agent(event, '/net/speedtest', { method: 'POST', body: {} }))
