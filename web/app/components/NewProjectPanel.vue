<script setup lang="ts">
/** Start a project on a dev box: empty, from a clone URL, or brand new on GitHub. */
const props = defineProps<{ boxes: any[] }>()
const emit = defineEmits<{ action: [string, any] }>()

const running = computed(() => (props.boxes ?? []).filter(b => b.status === 'running'))
const vmid = ref<number | null>(null)
watchEffect(() => { if (vmid.value == null && running.value.length) vmid.value = running.value[0].vmid })

const { data: gh } = useShared<any>('gh-repos', '/api/github/repos')
const canGithub = computed(() => !!gh.value?.configured)

const name = ref('')
const repo = ref('')
const onGithub = ref(false)
const visibility = ref<'private' | 'public'>('private')

const taken = computed(() => new Set((props.boxes ?? []).flatMap(b => (b.projects ?? []).map((p: any) => p.path.split('/').pop()))))
const clash = computed(() => onGithub.value
  && (gh.value?.repos ?? []).some((r: any) => r.name.toLowerCase() === name.value.trim().toLowerCase()))
const repoOk = computed(() => !repo.value.trim()
  || /^(git@[\w.-]+:[\w.-]+\/[\w.-]+|https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+)(\.git)?$/.test(repo.value.trim()))
const valid = computed(() => /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(name.value) && !taken.value.has(name.value)
  && vmid.value != null && repoOk.value && !clash.value)

function create() {
  if (!valid.value) return
  emit('action', 'project_new', {
    vmid: vmid.value,
    name: name.value,
    ...(onGithub.value ? { github: true, visibility: visibility.value } : repo.value.trim() ? { repo: repo.value.trim() } : {}),
  })
  name.value = ''; repo.value = ''
}
</script>

<template>
  <Panel id="new" title="New project" sub="empty, cloned, or created on GitHub">
    <div class="row">
      <input v-model="name" class="in grow" placeholder="project name" @keydown.enter.prevent="create">
      <select v-if="running.length > 1" v-model="vmid" class="in">
        <option v-for="b in running" :key="b.vmid" :value="b.vmid">→ {{ b.name }}</option>
      </select>
    </div>

    <div class="row">
      <label class="toggle small" :class="{ off: !canGithub }" :title="canGithub ? 'create the repo on GitHub and push the first commit' : 'needs a GitHub token on the host'">
        <input v-model="onGithub" type="checkbox" :disabled="!canGithub"> create on GitHub
      </label>
      <select v-if="onGithub" v-model="visibility" class="in">
        <option value="private">🔒 private</option>
        <option value="public">public</option>
      </select>
    </div>

    <div class="row">
      <input v-if="!onGithub" v-model="repo" class="in grow" placeholder="clone URL (optional) — git@github.com:owner/name">
      <div v-else class="small muted grow mono">→ {{ gh?.user }}/{{ name || '<name>' }}</div>
      <button class="btn primary" :disabled="!valid" @click="create">Create</button>
    </div>

    <div v-if="name && taken.has(name)" class="small warn hint">A project called {{ name }} already exists on a dev box.</div>
    <div v-else-if="clash" class="small warn hint">{{ gh?.user }}/{{ name }} already exists on GitHub — pick another name, or clone it instead.</div>
    <div v-else-if="!repoOk" class="small warn hint">That does not look like a clone URL.</div>
    <div v-else-if="onGithub" class="small faint hint">Scaffolds ~/Projects/GitHub/{{ name || '<name>' }} on the dev box, creates the repo and pushes the first commit.</div>
    <div v-else class="small faint hint">Lands in ~/Projects/GitHub/&lt;name&gt; on the dev box and appears above when it is done.</div>
    <div v-if="!canGithub" class="small muted hint">{{ gh?.hint }}</div>
    <div v-if="!running.length" class="small warn hint">No dev box is running — create one with the newdev action.</div>
  </Panel>
</template>

<style scoped>
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row + .row { margin-top: 8px; }
.in { background: var(--panel-2); border: 1px solid var(--line); border-radius: 7px; color: var(--text); font: inherit; font-size: 13px; padding: 6px 9px; }
.in.grow, .grow { flex: 1; min-width: 160px; }
.toggle { display: flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
.toggle.off { opacity: .55; cursor: default; }
.hint { margin-top: 10px; }
</style>
