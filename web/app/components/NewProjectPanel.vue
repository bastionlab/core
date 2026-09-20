<script setup lang="ts">
/** Start an empty project on a dev box. Cloning an existing repo lives in the GitHub panel next to this one. */
const props = defineProps<{ boxes: any[] }>()
const emit = defineEmits<{ action: [string, any] }>()

const running = computed(() => (props.boxes ?? []).filter(b => b.status === 'running'))
const vmid = ref<number | null>(null)
watchEffect(() => { if (vmid.value == null && running.value.length) vmid.value = running.value[0].vmid })

const name = ref('')
const repo = ref('')
const taken = computed(() => new Set((props.boxes ?? []).flatMap(b => (b.projects ?? []).map((p: any) => p.path.split('/').pop()))))
const repoOk = computed(() => !repo.value.trim()
  || /^(git@[\w.-]+:[\w.-]+\/[\w.-]+|https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+)(\.git)?$/.test(repo.value.trim()))
const valid = computed(() => /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(name.value) && !taken.value.has(name.value)
  && vmid.value != null && repoOk.value)

function create() {
  if (!valid.value) return
  emit('action', 'project_new', { vmid: vmid.value, name: name.value, ...(repo.value.trim() ? { repo: repo.value.trim() } : {}) })
  name.value = ''; repo.value = ''
}
</script>

<template>
  <Panel id="new" title="New project" sub="an empty git project — or paste any clone URL">
    <div class="row">
      <input v-model="name" class="in grow" placeholder="project name" @keydown.enter.prevent="create">
      <select v-if="running.length > 1" v-model="vmid" class="in">
        <option v-for="b in running" :key="b.vmid" :value="b.vmid">→ {{ b.name }}</option>
      </select>
    </div>
    <div class="row">
      <input v-model="repo" class="in grow" placeholder="clone URL (optional) — git@github.com:owner/name">
      <button class="btn primary" :disabled="!valid" @click="create">Create</button>
    </div>

    <div v-if="name && taken.has(name)" class="small warn hint">A project called {{ name }} already exists.</div>
    <div v-else-if="!repoOk" class="small warn hint">That does not look like a clone URL.</div>
    <div v-else class="small faint hint">Lands in ~/Projects/GitHub/&lt;name&gt; on the dev box and appears above when it is done.</div>
    <div v-if="!running.length" class="small warn hint">No dev box is running — create one with the newdev action.</div>
  </Panel>
</template>

<style scoped>
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row + .row { margin-top: 8px; }
.in { background: var(--panel-2); border: 1px solid var(--line); border-radius: 7px; color: var(--text); font: inherit; font-size: 13px; padding: 6px 9px; }
.in.grow { flex: 1; min-width: 160px; }
.hint { margin-top: 10px; }
</style>
