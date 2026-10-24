// the Learn tab's worker: once a minute, see whether a lesson finished and whether today's is due
export default defineNitroPlugin(() => {
  setTimeout(tick, 5_000)
  setInterval(tick, 60_000)
})
