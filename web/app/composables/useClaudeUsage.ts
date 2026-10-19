export interface ClaudeUsage { at: number | null, status?: string, limited?: string | null, windows: Record<string, { used: number, resets: number }> }

/** shared by the usage panel and the chat stream (every Claude API call reports the windows as a rate_limit_event) */
export function useClaudeUsage() {
  const usage = useState<ClaudeUsage | null>('cc:usage', () => null)
  const refreshing = ref(false)
  const error = ref('')

  const load = async () => { usage.value = await $fetch<ClaudeUsage>('/api/claude/usage').catch(() => usage.value) }
  async function refresh() {
    refreshing.value = true
    error.value = ''
    try { usage.value = await $fetch<ClaudeUsage>('/api/claude/usage', { method: 'POST' }) } catch (e: any) { error.value = e?.data?.statusMessage || 'refresh failed' }
    refreshing.value = false
  }
  /** fed from a live turn */
  function seen(info: any) {
    if (!info?.unifiedWindows) return
    usage.value = {
      at: Math.floor(Date.now() / 1000), status: info.status, limited: info.status !== 'allowed' ? info.rateLimitType : null,
      windows: Object.fromEntries(Object.entries(info.unifiedWindows).map(([k, v]: any) => [k, { used: v.utilization, resets: v.resetsAt }])),
    }
  }
  return { usage, load, refresh, refreshing, error, seen }
}
