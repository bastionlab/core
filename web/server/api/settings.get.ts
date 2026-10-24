/** /settings: the core's connections, every installed add-on's fields (secrets only as set/updated) and config.json */
export default defineEventHandler(event => agent(event, '/settings'))
