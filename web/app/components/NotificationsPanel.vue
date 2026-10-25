<script setup lang="ts">
/**
 * Web Push (agent/push.py): switch it on per device, pick the topics this device gets, and route each topic to
 * Discord, push or both. Tapping a notification opens the matching page (public/sw.js).
 */
// deep: Nuxt 4 data is shallow, so the in-place optimistic flips below would not re-render until a reload
const { data, refresh } = useFetch<any>('/api/push', { deep: true })
const supported = ref(true)
const perm = ref<NotificationPermission | 'unsupported'>('default')
const myId = ref('')
const busy = ref(false)
const err = ref('')
const { toast } = useToast()
const { armed, arm } = useArm()

const reg = () => navigator.serviceWorker.getRegistration('/')
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0))
function deviceName() {
  const ua = navigator.userAgent
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const br = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''
  return [os, br].filter(Boolean).join(' · ')
}
const post = (body: any) => $fetch<any>('/api/push', { method: 'POST', body })
const why = (e: any) => e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed'

onMounted(async () => {
  supported.value = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported.value) { perm.value = 'unsupported'; return }
  perm.value = Notification.permission
  const sub = await (await reg())?.pushManager.getSubscription().catch(() => null)
  if (sub) { // already on: refresh the server's copy (keys can rotate) and learn this device's id
    const r = await post({ op: 'subscribe', sub: sub.toJSON(), name: deviceName(), topics: null }).catch(() => null)
    if (r) { myId.value = r.id; data.value = r }
  }
})

async function enable() {
  busy.value = true; err.value = ''
  try {
    perm.value = await Notification.requestPermission()
    if (perm.value !== 'granted') throw new Error('Notifications are blocked for this site in the browser settings')
    const r = await reg()
    if (!r) throw new Error('No service worker on this address yet — reload the page once')
    const key = b64(data.value.key)
    let sub = await r.pushManager.getSubscription()
    if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null }
    sub ??= await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const res = await post({ op: 'subscribe', sub: sub.toJSON(), name: deviceName(), topics: null })
    myId.value = res.id; data.value = res
    toast('Push is on for this device', { tone: 'ok' })
  } catch (e: any) { err.value = why(e) } finally { busy.value = false }
}
function sameKey(sub: PushSubscription, key: Uint8Array) {
  const k = sub.options?.applicationServerKey
  if (!k) return true
  const a = new Uint8Array(k)
  return a.length === key.length && a.every((v, i) => v === key[i])
}
async function disable(id: string) {
  if (!arm(`rm:${id}`)) return
  try {
    if (id === myId.value) { await (await (await reg())?.pushManager.getSubscription())?.unsubscribe(); myId.value = '' }
    data.value = await post({ op: 'remove', id })
  } catch (e) { toast(`Not removed: ${why(e)}`, { tone: 'bad' }) }
}
const me = computed(() => data.value?.devices?.find((d: any) => d.id === myId.value))
const others = computed(() => (data.value?.devices ?? []).filter((d: any) => d.id !== myId.value))

// optimistic: flips at once, flips back with a toast if the agent refuses
async function topic(t: string) {
  const d = me.value
  if (!d) return
  const before = [...d.topics]
  const next = before.includes(t) ? before.filter((x: string) => x !== t) : [...before, t]
  const r = await useToast().optimistic(() => (d.topics = next), () => (d.topics = before), () => post({ op: 'topics', id: d.id, topics: next }), 'Topic')
  if (r) data.value = r
}
async function route(t: any, r: string) {
  const before = t.route
  if (before === r) return
  const res = await useToast().optimistic(() => (t.route = r), () => (t.route = before), () => post({ op: 'route', topic: t.key, route: r }), 'Route')
  if (res) data.value = res
}
async function test() {
  const r = await post({ op: 'test', id: myId.value }).catch(() => null)
  toast(r?.sent ? 'Test sent — check the notification' : 'Sending failed', { tone: r?.sent ? 'ok' : 'bad' })
  refresh()
}
const on = computed(() => (data.value?.topics ?? []).filter((t: any) => t.route !== 'discord').length)
</script>

<template>
  <Panel id="notifications" title="Notifications" :sub="data ? `${data.devices.length} device${data.devices.length === 1 ? '' : 's'} · ${on} topic${on === 1 ? '' : 's'} push` : ''" fold="phone">
    <Skeleton v-if="!data" kind="rows" :n="3" />
    <template v-else>
      <div class="row dev">
        <b>This device</b>
        <template v-if="!supported">
          <span class="small warn">This browser can't receive push.</span>
        </template>
        <template v-else-if="me">
          <span class="pill ok">on</span>
          <span class="actions">
            <button type="button" class="btn sm" @click="test">Send test</button>
            <button type="button" class="btn sm ghost" :class="{ sure: armed === `rm:${me.id}` }" @click="disable(me.id)">{{ armed === `rm:${me.id}` ? 'Sure?' : 'Turn off' }}</button>
          </span>
        </template>
        <template v-else>
          <span v-if="perm === 'denied'" class="small warn">Blocked in the browser's site settings</span>
          <button type="button" class="btn primary sm actions" :disabled="busy || perm === 'denied'" @click="enable">Enable push</button>
        </template>
      </div>
      <p v-if="err" class="errbox small">{{ err }}</p>
      <div v-if="me" class="chips">
        <span class="small faint">Gets:</span>
        <button v-for="t in data.topics" :key="t.key" type="button" class="chip" :class="{ on: me.topics.includes(t.key) }" @click="topic(t.key)">{{ t.label }}</button>
      </div>

      <h3 class="sub small faint">Where each topic goes</h3>
      <div v-for="t in data.topics" :key="t.key" class="row">
        <span>{{ t.label }}</span>
        <div class="seg actions">
          <button v-for="r in ['discord', 'push', 'both']" :key="r" type="button" :class="{ on: t.route === r }" @click="route(t, r)">{{ r === 'discord' ? 'Discord' : r === 'push' ? 'Push' : 'Both' }}</button>
        </div>
      </div>

      <template v-if="others.length">
        <h3 class="sub small faint">Other devices</h3>
        <div v-for="d in others" :key="d.id" class="row">
          <span>{{ d.name }}</span>
          <span v-if="d.failed" class="pill warn">{{ d.failed }} failed</span>
          <span class="small faint">{{ d.last ? `last ${ago(d.last)}` : `added ${ago(d.added)}` }}</span>
          <button type="button" class="btn sm ghost actions" :class="{ sure: armed === `rm:${d.id}` }" @click="disable(d.id)">{{ armed === `rm:${d.id}` ? 'Sure?' : 'Remove' }}</button>
        </div>
      </template>
    </template>
  </Panel>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 0; border-top: 1px solid var(--line); }
.row.dev { border-top: 0; padding-top: 0; }
.actions { margin-left: auto; display: flex; gap: 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 6px; }
.sub { margin: 16px 0 4px; font-weight: 500; }
.errbox { margin: 6px 0; }
</style>
