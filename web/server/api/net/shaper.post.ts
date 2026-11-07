/** bandwidth limits + priorities per CT: body {} reads the state, body with `enabled` saves + applies it */
export default defineEventHandler(async event => agent(event, '/net/shaper', { method: 'POST', body: await readBody(event) || {} }))
