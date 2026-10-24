// the Learn tab's worker: once a minute, see whether a lesson finished and whether today's is due
// LEARN_WORKER=0 keeps a scratch/test build from writing lessons through the real agent
export default defineNitroPlugin(() => {
  if (process.env.LEARN_WORKER === '0') return
  setTimeout(tick, 5_000)
  setInterval(tick, 60_000)
})
