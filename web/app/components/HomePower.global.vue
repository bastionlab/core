<script setup lang="ts">
/**
 * Home's power card: reboot or shut down the host (in 1 min), or reboot at a set time. Every button only opens the
 * shared confirm card; a pending shutdown/reboot shows here with Cancel. It shows what fits its Home tile (container queries on HomeItem's `tile`).
 */
const { data: o } = useOverview()
const { ask } = useConfirm()
const { t } = useI18n()
const at = ref('04:00')
const pending = computed(() => o.value?.host?.shutdown)
const busy = computed<string[]>(() => o.value?.backups?.busy ?? [])
const when = computed(() => pending.value && new Date(pending.value.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
</script>

<template>
  <div class="power">
    <div class="head">
      <span class="ti"><Icon name="power" :size="18" /></span>
      <span class="name">{{ $t('home.power') }}</span>
      <span v-if="pending" class="dot warn" />
    </div>
    <div class="body">
      <div v-if="pending" class="state">
        <span class="small warn">{{ pending.mode === 'reboot' ? $t('home.rebootingAt', { t: when }) : $t('home.offAt', { t: when }) }}</span>
        <button type="button" class="btn sm" @click="ask('host_shutdown_cancel', {}, t('home.cancelPower'))">{{ $t('common.cancel') }}</button>
      </div>
      <template v-else>
        <div class="row">
          <button type="button" class="btn sm" :disabled="!!busy.length" :aria-label="$t('home.reboot')" @click="ask('host_reboot', {}, t('home.rebootNow'))"><Icon name="refresh" :size="14" /><span class="lb">{{ $t('home.reboot') }}</span></button>
          <button type="button" class="btn sm danger" :disabled="!!busy.length" :aria-label="$t('home.shutdown')" @click="ask('host_shutdown', {}, t('home.shutdownNow'))"><Icon name="power" :size="14" /><span class="lb">{{ $t('home.shutdown') }}</span></button>
        </div>
        <div class="row sched">
          <input v-model="at" type="time" class="time" :aria-label="$t('home.rebootAt')">
          <button type="button" class="btn sm" :disabled="!!busy.length || !at" @click="ask('host_reboot', { at }, t('home.rebootAtLabel', { t: at }))"><Icon name="clock" :size="14" />{{ $t('home.schedule') }}</button>
        </div>
        <span v-if="busy.length" class="small faint extra">{{ busy.join(' · ') }}</span>
        <span v-else class="small faint extra up">{{ $t('home.uptime', { t: o ? duration(o.host.uptime) : '–' }) }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.power { position: relative; display: flex; flex-direction: column; gap: 10px; height: 100%; padding: 12px 14px; overflow: hidden; border-radius: var(--radius); background: var(--panel); border: 1px solid var(--line); min-width: 0; }
.head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ti { width: 34px; height: 34px; border-radius: var(--radius-sm); display: grid; place-items: center; background: var(--panel-2); color: var(--muted); flex: none; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head .dot { margin-left: auto; }
.body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.row, .state { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.state .btn { margin-left: auto; }
.time { padding: 4px 8px; }
.sched, .up { display: none; }
@media (max-width: 640px) { .ti { width: 30px; height: 30px; border-radius: 8px; } }

/* --- by the Home tile's shape --- */
/* short: one line, the buttons as icons on the right */
@container tile (max-height: 99px) {
  .power { flex-direction: row; align-items: center; padding: 8px 12px; }
  .head { flex: 1; }
  .body { flex: none; }
  .lb, .extra, .state .small { display: none; }
  .row .btn { padding: 0; width: 32px; height: 32px; justify-content: center; }
}
@container tile (max-height: 99px) and (max-width: 219px) {
  .name { display: none; }
}
/* tall enough: the scheduled reboot and the uptime too */
@container tile (min-height: 170px) {
  .sched, .up { display: flex; }
}
/* narrow: a tile with the icon and name; the buttons only when it is tall */
@container tile (max-width: 129px) {
  .power { align-items: center; justify-content: center; padding: 8px 6px; gap: 8px; }
  .head { flex-direction: column; gap: 6px; flex: none; }
  .name { display: block; font-size: 12px; }
  .head .dot { position: absolute; top: 8px; right: 8px; margin: 0; }
  .lb, .extra, .sched { display: none; }
  .row { justify-content: center; }
  .row .btn { padding: 0; width: 32px; height: 32px; justify-content: center; }
}
@container tile (max-width: 129px) and (max-height: 139px) {
  .body { display: none; }
}
</style>
