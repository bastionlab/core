/** begin the Google OAuth login: the agent mints a state and returns Google's consent URL */
export default defineEventHandler(event => agent(event, '/google/start', { method: 'POST', body: {} }))
