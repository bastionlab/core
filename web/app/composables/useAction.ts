export interface Job { id?: string, desc?: string, name: string, args: any, state: 'checking' | 'running' | 'done' | 'failed', log: string[], rc?: number | null, started: number, ended?: number, page?: string }

const KEY = 'jobs:recent'
const KEEP = 12

/**
 * Every action the owner ran, on any page: the header's jobs tray lists them, a toast says when one ends, and a page's
 * own <JobList> shows the ones started there. Kept in localStorage so a reload keeps following a running job.
 */
export function useRuns() {
  const jobs = useState<Job[]>('jobs:all', () => [])
  const tray = useState<{ open: boolean, focus?: string | number }>('jobs:tray', () => ({ open: false }))
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(jobs.value.slice(0, KEEP))) } catch {} }

  function add(j: Omit<Job, 'started' | 'log' | 'state'> & Partial<Job>) {
    const job = reactive<Job>({ state: 'running', log: [], started: Date.now(), ...j })
    jobs.value = [job, ...jobs.value].slice(0, KEEP)
    save()
    return job
  }

  /** a job ended: remember it and say so (the toast's "View log" opens the tray on it) */
  function finish(job: Job, rc: number | null | undefined, err?: string) {
    job.rc = rc
    job.state = rc === 0 && !err ? 'done' : 'failed'
    job.ended = Date.now()
    if (err) job.log = [...job.log, err]
    save()
    const { toast } = useToast()
    toast(`${job.state === 'done' ? '✓' : '✗'} ${job.desc ?? job.name}`, {
      tone: job.state === 'done' ? 'ok' : 'bad',
      action: { label: 'View log', fn: () => (tray.value = { open: true, focus: job.id ?? job.started }) },
    })
  }

  /** poll a job the agent already started until it ends */
  async function follow(job: Job) {
    try {
      for (;;) {
        await new Promise(r => setTimeout(r, 1200))
        const s: any = await $fetch('/api/ai/action/status', { query: { id: job.id } })
        job.log = s.log ?? []
        if (s.done) return finish(job, s.rc)
      }
    } catch (e: any) {
      finish(job, null, e?.data?.statusMessage || e?.statusMessage || e?.message || 'lost track of it')
    }
  }

  /** after a reload: pick up the jobs that were still running */
  function restore() {
    if (jobs.value.length) return
    try {
      const saved: Job[] = JSON.parse(localStorage.getItem(KEY) || '[]')
      jobs.value = saved.map(j => reactive(j))
      for (const j of jobs.value) if (j.state === 'running' && j.id) follow(j)
    } catch {}
  }

  const dismiss = (job: Job) => { jobs.value = jobs.value.filter(j => j !== job); save() }
  const running = computed(() => jobs.value.filter(j => j.state === 'running' || j.state === 'checking'))
  return { jobs, tray, add, finish, follow, restore, dismiss, running }
}

/**
 * Run one of the agent's allowlisted actions and follow its log. Same endpoints the Ask bar uses
 * for approved proposals — the agent validates the name and every argument again on its side.
 * `jobs` = the ones started on this page; all of them sit in the header's tray.
 */
export function useActions(page = useRoute().path) {
  const store = useRuns()
  const jobs = computed(() => store.jobs.value.filter(j => j.page === page))

  async function run(name: string, args: any, after?: () => void) {
    const job = store.add({ name, args, page })
    try {
      const started: any = await $fetch('/api/ai/action/run', { method: 'POST', body: { name, args } })
      Object.assign(job, { id: started.id, desc: started.desc, log: started.log ?? [] })
      await store.follow(job)
    } catch (e: any) {
      store.finish(job, null, e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed')
    }
    after?.()
    return job
  }

  return { jobs, run, dismiss: store.dismiss }
}
