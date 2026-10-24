/** depot history per position + total (value and cost basis per day), only loaded when the Depot tab is open */
export default defineEventHandler(event => money(event, '/depot'))
