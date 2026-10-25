<script setup lang="ts">
/**
 * Deploy = send the box's work to GitHub (action dash_deploy → agent/dash-ship: core release + changed add-ons).
 * This box needs no deploy: agent/dash-live applies every edit by itself; its last result is the "Live" line.
 * The agent and this app restart while an edit is applied, so the log is polled and gaps are expected, not errors.
 */
const { ask } = useConfirm()
const { t } = useI18n()
const s = ref<any>(null)
const lost = ref(false)
async function load() {
  try { s.value = await $fetch('/api/deploy'); lost.value = false } catch { lost.value = true }
}
usePoll(load, 3000)
const state = computed(() => !s.value ? '' : s.value.running ? 'running' : s.value.rc == null ? '' : s.value.rc === 0 ? 'ok' : 'bad')
const sub = computed(() => {
  if (!s.value) return ''
  if (s.value.running) return t('deploy.running')
  if (!s.value.ended) return t('deploy.never')
  return t(s.value.rc === 0 ? 'deploy.okAt' : 'deploy.failedAt', { t: ago(s.value.ended) })
})
const deploy = () => ask('dash_deploy', {}, t('deploy.confirm'))
const live = computed(() => s.value?.live)
const liveText = computed(() => {
  const l = live.value
  if (!l) return ''
  if (l.state === 'applying') return t('deploy.liveApplying')
  if (l.state === 'ok') return t('deploy.liveOk', { t: ago(l.at) })
  if (l.state === 'failed') return t('deploy.liveFailed', { t: ago(l.at) })
  return t('deploy.liveWatching')
})
</script>

<template>
  <Panel id="deploy" :title="$t('deploy.title')" :sub="sub" fold="phone">
    <template #actions>
      <button type="button" class="btn sm primary" :disabled="!s || s.running" @click="deploy">{{ $t('deploy.button') }}</button>
    </template>
    <Skeleton v-if="!s && !lost" kind="lines" :n="2" />
    <p v-if="live" class="small live">
      <span class="dot" :class="live.state === 'failed' ? 'bad' : live.state === 'applying' ? 'warn' : 'ok'" />
      <b>{{ $t('deploy.live') }}</b> · <span :class="live.state === 'failed' ? 'warn' : 'muted'">{{ liveText }}</span>
    </p>
    <pre v-if="live?.state === 'failed' && live.msg" class="log small bad">{{ live.msg }}</pre>
    <p v-if="s?.running || (lost && s)" class="small" :class="lost ? 'warn' : 'muted'">
      <span v-if="!lost" class="spin" />{{ lost ? $t('deploy.away') : $t('deploy.running') }}
    </p>
    <pre v-if="s?.log?.length" class="log small" :class="state">{{ s.log.slice(s.running ? -14 : -6).join('\n') }}</pre>
  </Panel>
</template>

<style scoped>
.log { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow-y: auto; background: var(--panel-2); border-radius: 6px; padding: 6px 8px; margin: 6px 0 0; font-family: var(--mono); border-left: 3px solid var(--line-2); }
.log.ok { border-left-color: var(--ok); } .log.bad { border-left-color: var(--bad); } .log.running { border-left-color: var(--accent); }
.live { margin: 0 0 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.spin { display: inline-block; width: 11px; height: 11px; margin-right: 8px; vertical-align: -1px; border-radius: 50%; border: 2px solid var(--accent-soft); border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
p { margin: 0; }
</style>
