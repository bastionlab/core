/** every series and film in Sonarr/Radarr, for the Remove picker */
export default defineEventHandler(event => agent(event, '/media/items'))
