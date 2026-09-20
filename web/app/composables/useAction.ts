export interface Job { id?: string, desc?: string, name: string, args: any, state: 'checking' | 'running' | 'done' | 'failed', log: string[], rc?: number | null, started: number }

/**
 * Run one of the agent's allowlisted actions and follow its log. Same endpoints the Ask bar uses
 * for approved proposals — the agent validates the name and every argument again on its side.
 */
export function useActions() {
  const jobs = ref<Job[]>([])

  async function run(name: string, args: any, after?: () => void) {
    const job = reactive<Job>({ name, args, state: 'running', log: [], started: Date.now() })
    jobs.value.unshift(job)
    try {
      const started: any = await $fetch('/api/ai/action/run', { method: 'POST', body: { name, args } })
      Object.assign(job, { id: started.id, desc: started.desc, log: started.log ?? [] })
      for (;;) {
        await new Promise(r => setTimeout(r, 1200))
        const s: any = await $fetch('/api/ai/action/status', { query: { id: job.id } })
        job.log = s.log ?? []
        if (s.done) { job.rc = s.rc; job.state = s.rc === 0 ? 'done' : 'failed'; break }
      }
    } catch (e: any) {
      job.state = 'failed'
      job.log = [...job.log, e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed']
    }
    after?.()
    return job
  }

  const dismiss = (job: Job) => (jobs.value = jobs.value.filter(j => j !== job))
  return { jobs, run, dismiss }
}
