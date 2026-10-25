/** push notifications: the VAPID public key, each topic's route (Discord / push / both) and the devices signed up */
export default defineEventHandler(event => agent(event, '/push'))
