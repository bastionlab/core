export const TRACK_ICON: Record<string, string> = {
  languages: '🔤', concepts: '🧠', cloud: '☁️', devops: '🚀', systems: '⚙️',
  networking: '🌐', security: '🔐', data: '🗄️', web: '🕸️', ai: '🤖',
}
export const trackIcon = (t: string) => TRACK_ICON[t] ?? '📘'

/** read sections + answered questions + finished tasks, out of everything the lesson has */
export function lessonProgress(l: any) {
  const x = l?.lesson
  if (!x) return { done: 0, total: 0, pct: 0 }
  const p = l.progress ?? {}
  const total = x.sections.length + x.quiz.length + x.tasks.length
  const done = (p.read?.length ?? 0) + Object.keys(p.quiz ?? {}).length + (p.tasks?.length ?? 0)
  return { done, total, pct: l.done ? 100 : total ? Math.round((100 * done) / total) : 0 }
}

export function quizScore(l: any) {
  const q = l?.lesson?.quiz ?? [], a = l?.progress?.quiz ?? {}
  const answered = Object.keys(a).length
  return { right: q.filter((x: any, i: number) => a[i] === x.answer).length, answered, total: q.length }
}

export const berlinDay = (t = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(t)

/** the Monday (Berlin) of the week a moment falls in */
function monday(t: number) {
  const day = berlinDay(t)
  const wd = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
  return new Date(Date.parse(`${day}T12:00:00Z`) - wd * 86_400_000).toISOString().slice(0, 10)
}

/** weeks in a row with a finished lesson, counting back from this week (or last week, while this one is still open) */
export function streak(lessons: any[]) {
  const weeks = new Set(lessons.filter(l => l.done).map(l => monday(l.done * 1000)))
  let n = 0
  let t = Date.now()
  if (!weeks.has(monday(t))) t -= 7 * 86_400_000
  while (weeks.has(monday(t))) { n++; t -= 7 * 86_400_000 }
  return n
}

export const SKILL_LEVELS = ['', 'aware', 'basics', 'working', 'strong', 'expert']
