export default defineEventHandler(event => cardInfo(String(getQuery(event).k ?? '').slice(0, 2)))
