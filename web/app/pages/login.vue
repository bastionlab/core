<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'Locked · pve' })
const route = useRoute()
const pin = ref('')
const err = ref('')
const busy = ref(false)

async function submit() {
  if (!pin.value || busy.value) return
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { pin: pin.value } })
    useState('auth:ok').value = true
    const next = String(route.query.next || '/')
    await navigateTo(next.startsWith('/') && !next.startsWith('//') ? next : '/')
  } catch (e: any) {
    err.value = e?.statusMessage || e?.data?.statusMessage || 'failed'
    pin.value = ''
  } finally {
    busy.value = false
  }
}
const press = (d: string) => { if (pin.value.length < 12) pin.value += d; err.value = '' }
const back = () => (pin.value = pin.value.slice(0, -1))
// on a PC the number row / numpad works too: listen on the window, so focus never matters
function key(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (/^\d$/.test(e.key)) press(e.key)
  else if (e.key === 'Backspace') back()
  else if (e.key === 'Escape') pin.value = ''
  else if (e.key === 'Enter') submit()
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', key))
onBeforeUnmount(() => window.removeEventListener('keydown', key))
</script>

<template>
  <div class="lock">
    <form class="card" @submit.prevent="submit">
      <div class="icon">🖥️</div>
      <b>pve</b>
      <div class="dots" :class="{ shake: err }" role="status" :aria-label="`${pin.length} digits entered`">
        <span v-for="i in Math.max(4, pin.length)" :key="i" :class="{ on: i <= pin.length }" />
      </div>
      <div class="err small">{{ err || ' ' }}</div>
      <div class="pad">
        <button v-for="d in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="d" type="button" @click="press(d)">{{ d }}</button>
        <button type="button" class="fn" :disabled="!pin" title="delete" @click="back">⌫</button>
        <button type="button" @click="press('0')">0</button>
        <button type="submit" class="fn go" :disabled="!pin || busy" title="unlock">→</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.lock { min-height: 100dvh; display: grid; place-items: center; background: var(--bg); padding: 16px; }
.card { display: flex; flex-direction: column; align-items: center; gap: 10px; width: min(300px, 100%); }
.icon { font-size: 34px; }
.dots { display: flex; gap: 12px; margin-top: 12px; min-height: 14px; }
.dots span { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--line-2); }
.dots span.on { background: var(--accent); border-color: var(--accent); }
.shake { animation: shake .3s; }
@keyframes shake { 25% { transform: translateX(-6px) } 75% { transform: translateX(6px) } }
.err { color: var(--bad); min-height: 18px; text-align: center; }
.pad { display: grid; grid-template-columns: repeat(3, 72px); gap: 12px; }
.pad button { width: 72px; height: 72px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: var(--panel); color: var(--text); font: inherit; font-size: 22px; cursor: pointer; }
.pad button:hover:not(:disabled) { background: var(--panel-2); }
.pad button:active:not(:disabled) { background: var(--line-2); }
.pad .fn { background: transparent; border-color: transparent; color: var(--muted); }
.pad .go:not(:disabled) { background: var(--accent); color: var(--bg); }
.pad button:disabled { opacity: .35; cursor: default; }
</style>
