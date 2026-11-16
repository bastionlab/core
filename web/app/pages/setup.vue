<script setup lang="ts">
/** First-run setup: owner account, remote access, optional Claude login. Reachable later from Settings. */
definePageMeta({ title: 'Setup' })
const step = ref(0)
const steps = ['Account', 'Remote access', 'Claude', 'Done']
const acct = ref<any>(null)
const loadAcct = async () => { acct.value = await $fetch('/api/account').catch(() => null) }
onMounted(loadAcct)
const hasOwner = computed(() => !!acct.value?.user)
async function finish() { await $fetch('/api/setup/done', { method: 'POST' }).catch(() => {}); await navigateTo('/') }
</script>

<template>
  <div class="setup">
    <h1 class="sec">Set up Bastion</h1>
    <ol class="dots" aria-label="Progress">
      <li v-for="(s, i) in steps" :key="s" :class="{ on: i === step, done: i < step }">{{ s }}</li>
    </ol>

    <Panel v-if="step === 0" title="Your account" sub="Name and password">
      <AccountPanel />
    </Panel>
    <Panel v-else-if="step === 1" title="Remote access" sub="How you reach Bastion from outside">
      <VpnPanel />
    </Panel>
    <Panel v-else-if="step === 2" title="Claude" sub="Optional: powers chat">
      <ClaudeLogin />
    </Panel>
    <Panel v-else title="All set" sub="You can change any of this in Settings">
      <button type="button" class="btn primary" @click="finish">Open Bastion</button>
    </Panel>

    <div v-if="step < 3" class="nav">
      <button type="button" class="btn ghost" :disabled="step === 0" @click="step--">Back</button>
      <button v-if="step > 0" type="button" class="btn ghost" @click="step++">Skip</button>
      <button type="button" class="btn primary" :disabled="step === 0 && !hasOwner" @click="step === 0 ? loadAcct().then(() => step++) : step++">Next</button>
    </div>
  </div>
</template>

<style scoped>
.setup { max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.dots { display: flex; gap: 6px; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; }
.dots li { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--faint); font-size: 0.85rem; }
.dots li.on { border-color: var(--accent); color: var(--text); background: var(--accent-soft); }
.dots li.done { color: var(--muted); }
.nav { display: flex; gap: 8px; justify-content: flex-end; }
</style>
