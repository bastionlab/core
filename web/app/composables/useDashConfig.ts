/** this install's tailnet + CT addresses (server/utils/config.ts), fetched once per app load */
export function useDashConfig() {
  const c = useState<any>('dash-config', () => null)
  if (!c.value && import.meta.client) $fetch('/api/config').then(v => (c.value = v)).catch(() => {})
  return {
    cfg: c,
    ts: (sub: string) => (c.value ? `https://${sub}.${c.value.tailnet}` : ''),
    ip: (name: string) => c.value?.cts?.[name]?.ip ?? '',
    ctId: (name: string) => c.value?.cts?.[name]?.id as number | undefined,
    hostIp: computed(() => c.value?.hostIp ?? ''),
  }
}
