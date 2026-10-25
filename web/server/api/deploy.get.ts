/** the Deploy button's progress: is one running, and the last run's log (agent/actions.py deploy_status) */
export default defineEventHandler(event => agent(event, '/deploy'))
