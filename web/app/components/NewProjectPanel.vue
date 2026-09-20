<script setup lang="ts">
const props = defineProps<{ boxes: any[] }>()
const emit = defineEmits<{ action: [string, any] }>()

const { data: gh, refresh: refreshRepos } = useShared<any>('gh-repos', '/api/github/repos')
onMounted(() => { if (!gh.value) refreshRepos() })

const running = computed(() => (props.boxes ?? []).filter(b => b.status === 'running'))
const vmid = ref<number | null>(null)
watchEffect(() => { if (vmid.value == null && running.value.length) vmid.value = running.value[0].vmid })

const mode = ref<'new' | 'clone'>('new')
const name = ref('')
const repo = ref('')
const picked = ref('')

const repos = computed(() => gh.value?.repos ?? [])
watch(picked, (full) => {
  const r = repos.value.find((x: any) => x.full === full)
  if (r) { repo.value = r.ssh; if (!name.value) name.value = r.name }
})

const taken = computed(() => new Set((props.boxes ?? []).flatMap(b => (b.projects ?? []).map((p: any) => p.path.split('/').pop()))))
const valid = computed(() => /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(name.value) && !taken.value.has(name.value)
  && vmid.value != null && (mode.value === 'new' || /^(git@[\w.-]+:[\w.-]+\/[\w.-]+|https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+)(\.git)?$/.test(repo.value.trim())))

function create() {
  if (!valid.value) return
  emit('action', 'project_new', { vmid: vmid.value, name: name.value, ...(mode.value === 'clone' ? { repo: repo.value.trim() } : {}) })
  name.value = ''; repo.value = ''; picked.value = ''
}
</script>

<template>
  <Panel id="new" title="New project" sub="clone one of your repos or start an empty one — it appears below when it is done">
    <div class="row">
      <div class="seg">
        <button class="btn" :class="{ primary: mode === 'new' }" @click="mode = 'new'">Start new</button>
        <button class="btn" :class="{ primary: mode === 'clone' }" @click="mode = 'clone'">From GitHub</button>
      </div>
      <input v-model="name" class="in" placeholder="project name" @keydown.enter.prevent="create">
      <select v-if="running.length > 1" v-model="vmid" class="in sel">
        <option v-for="b in running" :key="b.vmid" :value="b.vmid">{{ b.name }}</option>
      </select>
      <button class="btn primary" :disabled="!valid" @click="create">Create</button>
    </div>

    <div v-if="mode === 'clone'" class="row clone">
      <select v-if="repos.length" v-model="picked" class="in sel wide">
        <option value="">pick a repo…</option>
        <option v-for="r in repos" :key="r.full" :value="r.full">{{ r.full }}{{ r.private ? ' 🔒' : '' }}{{ r.lang ? ` · ${r.lang}` : '' }}</option>
      </select>
      <input v-model="repo" class="in grow" placeholder="git@github.com:owner/name">
    </div>

    <div v-if="mode === 'clone' && !gh?.configured" class="small muted hint">
      Repo list needs a GitHub token: <code>echo &lt;token&gt; &gt; /root/devbox/keys/github_token</code> on pve (repo scope).
      Cloning by URL works without it — the dev boxes already have your SSH key.
    </div>
    <div v-else-if="gh?.error" class="small bad hint">GitHub: {{ gh.error }}</div>
    <div v-if="name && !valid && taken.has(name)" class="small warn hint">A project called {{ name }} already exists.</div>
    <div v-if="!running.length" class="small warn hint">No dev box is running — start one on the Metrics page, or create one with newdev.</div>
  </Panel>
</template>

<style scoped>
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row + .row { margin-top: 8px; }
.seg { display: flex; gap: 4px; }
.in { background: var(--panel-2); border: 1px solid var(--line); border-radius: 7px; color: var(--text); font: inherit; font-size: 13px; padding: 6px 9px; }
.in.grow { flex: 1; min-width: 220px; }
.sel { max-width: 320px; }
.sel.wide { min-width: 260px; }
.hint { margin-top: 10px; }
</style>
