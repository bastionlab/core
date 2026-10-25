<script setup lang="ts">
/** propose-and-approve for actions picked outside a page (the command palette): describe, arm, then Run */
const { pending, cancel } = useConfirm()
const { run } = useActions('palette') // not any page's own list: the tray shows it
const desc = ref('')
const err = ref('')
const armed = ref(false)
let armTimer: any
watch(pending, async (p) => {
  desc.value = ''; err.value = ''; armed.value = false; clearTimeout(armTimer)
  if (!p) return
  try {
    desc.value = (await $fetch<any>('/api/ai/action/check', { method: 'POST', body: { name: p.name, args: p.args } })).desc
    armTimer = setTimeout(() => (armed.value = true), 1500)
  } catch (e: any) { err.value = e?.data?.statusMessage || e?.statusMessage || e?.message || 'not allowed' }
})
function go() {
  const p = pending.value
  if (!p || !armed.value) return
  cancel()
  run(p.name, p.args)
  useRuns().tray.value = { open: false }
}
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && pending.value) cancel() }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => { window.removeEventListener('keydown', onKey); clearTimeout(armTimer) })
</script>

<template>
  <Teleport to="body">
    <div v-if="pending" class="ac-scrim" @click.self="cancel">
      <div class="ac" role="dialog" aria-label="Confirm action">
        <b>{{ pending.label }}</b>
        <p v-if="err" class="errbox small">{{ err }}</p>
        <p v-else class="muted small">{{ desc || 'Loading…' }}</p>
        <div class="row">
          <button type="button" class="btn ghost sm" @click="cancel">Cancel</button>
          <button type="button" class="btn primary sm" :disabled="!armed || !!err" @click="go">Run</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ac-scrim { position: fixed; inset: 0; z-index: 90; background: rgb(0 0 0 / .5); display: grid; place-items: start center; padding: 14vh 12px 0; }
.ac { width: min(440px, 100%); background: var(--panel); border: 1px solid var(--warn); border-radius: var(--radius); padding: 14px 16px; box-shadow: 0 16px 40px rgb(0 0 0 / .5); }
.ac p { margin: 8px 0 12px; overflow-wrap: anywhere; }
.row { display: flex; justify-content: flex-end; gap: 8px; }
</style>
