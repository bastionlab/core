<script setup lang="ts">
/** The owner's GitHub account, hooked straight into the dev boxes: every repo is one click from being cloned. */
const props = defineProps<{ boxes: any[] }>()
const emit = defineEmits<{ action: [string, any] }>()

const { data: gh, pending, refresh } = useShared<any>('gh-repos', '/api/github/repos')
onMounted(() => { if (!gh.value) refresh() })

const running = computed(() => (props.boxes ?? []).filter(b => b.status === 'running'))
const vmid = ref<number | null>(null)
watchEffect(() => { if (vmid.value == null && running.value.length) vmid.value = running.value[0].vmid })

// which repos already live on a dev box, and where
const cloned = computed(() => {
  const m = new Map<string, any>()
  for (const b of props.boxes ?? []) for (const p of b.projects ?? []) if (p.git?.repo) m.set(p.git.repo.toLowerCase(), { box: b, p })
  return m
})

const q = ref('')
const mine = ref(true)
const repos = computed(() => {
  const needle = q.value.trim().toLowerCase()
  return (gh.value?.repos ?? [])
    .filter((r: any) => !r.archived)
    .filter((r: any) => !mine.value || !r.fork)
    .filter((r: any) => !needle || `${r.full} ${r.desc} ${r.lang}`.toLowerCase().includes(needle))
})

function clone(r: any) {
  if (vmid.value == null) return
  emit('action', 'project_new', { vmid: vmid.value, name: r.name, repo: r.ssh })
}
</script>

<template>
  <Panel id="github" title="GitHub" fold="closed" :sub="gh?.user">
    <template #actions>
      <a v-if="gh?.url" :href="gh.url" target="_blank" class="btn ghost small" title="open on GitHub">↗</a>
      <button class="btn ghost small" title="refresh the repo list" @click="refresh">↻</button>
    </template>

    <div class="bar">
      <input v-model="q" class="in grow" :placeholder="`Search ${repos.length} repos…`">
      <label class="small muted toggle"><input v-model="mine" type="checkbox"> hide forks</label>
      <select v-if="running.length > 1" v-model="vmid" class="in" title="which dev box to clone into">
        <option v-for="b in running" :key="b.vmid" :value="b.vmid">→ {{ b.name }}</option>
      </select>
    </div>

    <div v-if="pending && !gh" class="faint small pad">Loading repos…</div>
    <div v-else-if="gh?.error" class="bad small pad">GitHub: {{ gh.error }}</div>
    <div v-else-if="!repos.length" class="faint small pad">No repos match.</div>

    <div v-else class="repos">
      <div v-for="r in repos" :key="r.full" class="repo">
        <div class="rh">
          <a :href="r.url" target="_blank" class="rname">{{ r.name }}</a>
          <span v-if="r.private" class="faint small" title="private">🔒</span>
          <span v-if="r.fork" class="pill">fork</span>
          <span v-if="r.lang" class="lang small faint">{{ r.lang }}</span>
        </div>
        <div v-if="r.desc" class="small muted desc">{{ r.desc }}</div>
        <div class="rf small">
          <span class="faint">{{ r.pushed ? ago(Date.parse(r.pushed) / 1000) : '–' }}</span>
          <template v-if="cloned.get(r.full.toLowerCase())">
            <span class="pill ok">on {{ cloned.get(r.full.toLowerCase()).box.name }}</span>
          </template>
          <button v-else class="btn small" :disabled="vmid == null" :title="`clone into ~/Projects/GitHub/${r.name} on the dev box`" @click="clone(r)">
            Clone
          </button>
        </div>
      </div>
    </div>

    <div v-if="gh && !gh.configured" class="small muted hint">
      {{ gh.hint }}
    </div>
    <div v-if="!running.length" class="small warn hint">No dev box is running — start one before cloning.</div>
  </Panel>
</template>

<style scoped>
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.in { font-size: 13px; padding: 6px 9px; }
.in.grow { flex: 1; min-width: 180px; }
.toggle { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
.pad { padding: 14px 0; }
.repos { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr)); gap: 8px; max-height: 420px; overflow-y: auto; }
.repo { background: var(--panel-2); border: 1px solid transparent; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.repo:hover { border-color: var(--line-2); }
.lang { margin-left: auto; }
.rh { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rname { font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
.rname:hover { color: var(--accent); }
.desc { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.rf { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; }
.rf .btn { padding: 3px 9px; }
.hint { margin-top: 10px; }
</style>
