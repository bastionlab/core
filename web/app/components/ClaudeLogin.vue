<script setup lang="ts">
/** Sign in to Claude on pve from the browser: open the link, sign in, paste the code back. Used in Settings and the chat's /login. */
const emit = defineEmits<{ done: [] }>()
type St = { running?: boolean, url?: string | null, loggedIn?: boolean, email?: string, method?: string, expires?: string }
const st = ref<St>({})
const code = ref('')
const busy = ref(false)
const err = ref('')
const mode = ref<'claudeai' | 'console'>('claudeai')
const err2 = (e: any) => e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed'
async function load() { try { st.value = await $fetch<St>('/api/claude/auth') } catch (e) { err.value = err2(e) } }
async function call(step: string, body: any = {}) {
  busy.value = true; err.value = ''
  try { st.value = await $fetch<St>(`/api/claude/auth/${step}`, { method: 'POST', body }); return true } catch (e) { err.value = err2(e); return false } finally { busy.value = false }
}
async function start() { code.value = ''; await call('start', { mode: mode.value }); if (!st.value.url && !err.value) err.value = 'No login link came back, try again' }
async function submit() { if (await call('code', { code: code.value })) { code.value = ''; emit('done') } }
onMounted(load)
</script>

<template>
  <div class="cl">
    <div class="state small">
      <span class="dot" :class="st.loggedIn ? 'ok' : 'bad'" />
      <span v-if="st.loggedIn">Signed in{{ st.email ? ` as ${st.email}` : '' }}</span>
      <span v-else>Not signed in</span>
    </div>
    <template v-if="st.running && st.url">
      <ol class="steps small">
        <li><a :href="st.url" target="_blank" rel="noopener">Open the Claude sign-in page</a> and sign in.</li>
        <li>Copy the code it shows and paste it here.</li>
      </ol>
      <form class="code" @submit.prevent="submit">
        <input v-model="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the code">
        <button type="submit" class="btn primary sm" :disabled="busy || code.trim().length < 8">Sign in</button>
        <button type="button" class="btn ghost sm" :disabled="busy" @click="call('cancel')">Cancel</button>
      </form>
    </template>
    <div v-else class="btns">
      <button type="button" class="btn primary sm" :disabled="busy" @click="start">{{ st.loggedIn ? 'Sign in again' : 'Sign in to Claude' }}</button>
      <select v-model="mode" class="sm" :disabled="busy" aria-label="Account type">
        <option value="claudeai">Claude subscription</option>
        <option value="console">Anthropic Console (API billing)</option>
      </select>
    </div>
    <div v-if="err" class="errbox small">{{ err }}</div>
  </div>
</template>

<style scoped>
.cl { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.state { display: flex; align-items: center; gap: 8px; }
.steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.code, .btns { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; align-self: stretch; }
.code input { flex: 1 1 220px; min-width: 0; }
</style>
