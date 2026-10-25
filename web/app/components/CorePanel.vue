<script setup lang="ts">
/**
 * Add-ons → Core: this core's version, the newest release on its channel (stable / beta) with the changelog of
 * everything in between, Update and Rollback (core_update / core_rollback: approve, then Run; agent/core-update).
 */
const { t } = useI18n()
const c = ref<any>(null)
const err = ref('')
const loading = ref(false)
async function load(fresh = false) {
  loading.value = true; err.value = ''
  try { c.value = await $fetch('/api/core', { query: fresh ? { fresh: '1' } : {} }) } catch (e: any) { err.value = errText(e) } finally { loading.value = false }
}
onMounted(() => load())
async function channel(ch: string) {
  try { c.value = await $fetch('/api/core/channel', { method: 'POST', body: { channel: ch } }) } catch (e: any) { err.value = errText(e) }
}
const showNotes = ref(false)
const notesHtml = computed(() => md((c.value?.notes ?? []).map((n: any) => `#### ${n.tag}\n\n${n.body || '-'}`).join('\n\n')))

const { jobs, run, dismiss } = useActions()
const pending = ref<{ name: string, args: any, desc: string } | null>(null)
const armed = ref(false)
let armTimer: any
async function ask(name: string, args: any = {}) {
  err.value = ''
  try {
    const r = await $fetch<{ desc: string }>('/api/ai/action/check', { method: 'POST', body: { name, args } })
    pending.value = { name, args, desc: r.desc }
    armed.value = false; clearTimeout(armTimer); armTimer = setTimeout(() => (armed.value = true), 1500)
  } catch (e: any) { err.value = errText(e) }
}
function go() {
  const p = pending.value
  if (!p || !armed.value) return
  pending.value = null
  run(p.name, p.args)
}
onBeforeUnmount(() => clearTimeout(armTimer))
const sub = computed(() => !c.value ? '' : c.value.newer ? t('core.available', { v: c.value.latest.version }) : `v${c.value.current}`)
</script>

<template>
  <Panel id="core" :title="$t('core.title')" :sub="sub" fold="phone">
    <template #actions>
      <button type="button" class="btn ghost sm" :disabled="loading" @click="load(true)">{{ loading ? $t('common.checking') : $t('common.refresh') }}</button>
    </template>
    <Skeleton v-if="!c && !err" kind="lines" :n="3" />
    <template v-if="c">
      <div class="kv">
        <span class="k small muted">{{ $t('core.version') }}</span>
        <span class="mono small">v{{ c.current }}</span>
        <span v-if="c.git" class="pill">{{ $t('core.checkout') }}</span>
      </div>
      <div class="kv">
        <span class="k small muted">{{ $t('core.channel') }}</span>
        <div class="seg">
          <button v-for="ch in ['stable', 'beta']" :key="ch" type="button" :class="{ on: c.channel === ch }" @click="channel(ch)">{{ $t(`core.${ch}`) }}</button>
        </div>
      </div>
      <div class="kv">
        <span class="k small muted">{{ $t('core.latest') }}</span>
        <span v-if="c.error" class="small warn">{{ c.error }}</span>
        <span v-else-if="!c.latest" class="small faint">{{ $t('core.noReleases') }}</span>
        <template v-else>
          <a class="lnk small mono" :href="c.latest.url" target="_blank" rel="noopener">{{ c.latest.tag }}</a>
          <span v-if="c.latest.prerelease" class="pill warn">{{ $t('core.beta') }}</span>
          <span v-if="!c.newer" class="pill ok">{{ $t('core.upToDate') }}</span>
        </template>
      </div>
      <template v-if="c.newer">
        <button type="button" class="lnk small" @click="showNotes = !showNotes">{{ showNotes ? $t('core.hideChanges') : $t('core.showChanges', { n: c.notes.length }) }}</button>
        <div v-if="showNotes" class="notes small md" v-html="notesHtml" />
        <div v-for="b in c.blocked" :key="b" class="small bad">{{ b }}</div>
        <div v-if="c.git && c.dirty" class="small warn">{{ $t('core.dirty') }}</div>
      </template>
      <div v-if="pending" class="confirm">
        <p class="small">{{ pending.desc }}</p>
        <div class="row">
          <button type="button" class="btn primary sm" :disabled="!armed" @click="go">{{ $t('common.run') }}</button>
          <button type="button" class="btn ghost sm" @click="pending = null">{{ $t('common.cancel') }}</button>
        </div>
      </div>
      <div v-else class="row">
        <button v-if="c.newer" type="button" class="btn primary sm" :disabled="c.blocked.length > 0" @click="ask('core_update', { tag: c.latest.tag })">{{ $t('core.update', { v: c.latest.version }) }}</button>
        <button v-if="c.rollback.length" type="button" class="btn ghost sm" @click="ask('core_rollback')">{{ $t('core.rollback') }}</button>
      </div>
      <JobList :jobs="jobs" @dismiss="dismiss" />
    </template>
    <div v-if="err" class="errbox small">{{ err }}</div>
  </Panel>
</template>

<style scoped>
.kv { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
.kv:first-of-type { border-top: 0; }
.k { width: 110px; flex: none; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.notes { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 4px 12px; margin: 8px 0; max-height: 320px; overflow: auto; }
.notes :deep(h4) { margin: 10px 0 4px; }
.notes :deep(ul) { padding-left: 18px; margin: 4px 0; }
.confirm { border: 1px solid var(--warn); border-radius: var(--radius-sm); padding: 10px 12px; margin-top: 10px; }
.confirm p { margin: 0 0 8px; }
@media (pointer: coarse) { .lnk { padding: 6px 4px; } }
</style>
