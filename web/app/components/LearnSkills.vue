<script setup lang="ts">
/** the owner's skillset: grouped by area, tap a dot to set the level, Claude moves skills after each finished lesson */
const props = defineProps<{ skills: any[], updating: boolean }>()
const emit = defineEmits<{ post: [Record<string, any>] }>()

const AREAS = Object.keys(TRACK_ICON)
const groups = computed(() => {
  const g: Record<string, any[]> = {}
  for (const s of props.skills) (g[s.area] ??= []).push(s)
  return AREAS.filter(a => g[a]).map(a => [a, g[a]!] as const)
})
const avg = computed(() => props.skills.length ? (props.skills.reduce((s, k) => s + k.level, 0) / props.skills.length).toFixed(1) : '–')
const recent = (s: any) => s.source === 'lesson' && Date.now() / 1000 - s.updated < 14 * 86400

const setLevel = (s: any, level: number) => emit('post', { action: 'skill', name: s.name, area: s.area, level })
const { armed, arm } = useArm()
const del = (s: any) => { if (arm(s.name)) emit('post', { action: 'skilldel', name: s.name }) }

const adding = ref(false)
const form = reactive({ name: '', area: 'concepts', level: 2 })
function add() {
  if (!form.name.trim()) return
  emit('post', { action: 'skill', name: form.name.trim(), area: form.area, level: form.level, note: 'added by hand' })
  form.name = ''; adding.value = false
}

const copied = ref(false)
async function copy() {
  const md = groups.value.map(([a, list]) => `**${a}**: ${list.map(s => `${s.name} (${SKILL_LEVELS[s.level]})`).join(', ')}`).join('\n')
  try { await navigator.clipboard.writeText(md); copied.value = true; setTimeout(() => (copied.value = false), 1500) } catch {}
}
</script>

<template>
  <Panel title="Your skills" id="learn-skills" fold="phone" :sub="`${skills.length} skills · avg ${avg}${updating ? ' · updating from your last lesson…' : ''}`">
    <template #actions>
      <button type="button" class="btn ghost" @click="copy">{{ copied ? '✓ copied' : 'Copy' }}</button>
      <button type="button" class="btn ghost" @click="adding = !adding">+ Add</button>
    </template>
    <form v-if="adding" class="add" @submit.prevent="add">
      <input v-model="form.name" type="text" placeholder="Skill, e.g. Kubernetes" maxlength="60">
      <select v-model="form.area"><option v-for="a in AREAS" :key="a" :value="a">{{ trackIcon(a) }} {{ a }}</option></select>
      <select v-model.number="form.level"><option v-for="l in 5" :key="l" :value="l">{{ l }} {{ SKILL_LEVELS[l] }}</option></select>
      <button type="submit" class="btn primary" :disabled="!form.name.trim()">Add</button>
    </form>
    <div class="groups">
      <div v-for="[a, list] in groups" :key="a" class="group">
        <div class="area faint small">{{ trackIcon(a) }} {{ a }}</div>
        <div v-for="s in list" :key="s.name" class="skill" :title="s.note">
          <span class="name">{{ s.name }}<span v-if="recent(s)" class="new" title="moved by a lesson recently">●</span></span>
          <span class="dots" :title="`${SKILL_LEVELS[s.level]} · 1 aware · 2 basics · 3 working · 4 strong · 5 expert · lessons move it at most +1, your taps always win`">
            <button v-for="l in 5" :key="l" type="button" class="d" :class="{ on: l <= s.level }" :aria-label="`level ${l}`" @click="setLevel(s, l)" />
          </span>
          <button type="button" class="btn ghost x" :class="{ sure: armed === s.name }" @click="del(s)">{{ armed === s.name ? 'Sure?' : '✕' }}</button>
          <span v-if="s.note" class="note faint">{{ s.note }}</span>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.add { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.add input { flex: 1; min-width: 160px; padding: 6px 10px; }
.add select { padding: 6px 8px; }
.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px 22px; }
.area { text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
.skill { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; column-gap: 8px; padding: 4px 0; border-top: 1px solid var(--line); }
.name { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new { color: var(--accent); font-size: 9px; margin-left: 5px; vertical-align: 2px; }
.note { grid-column: 1 / -1; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dots { display: flex; gap: 3px; }
.d { width: 11px; height: 11px; border-radius: 50%; border: 1px solid var(--line-2); background: transparent; padding: 0; cursor: pointer; }
.d.on { background: var(--accent); border-color: var(--accent); }
.x { padding: 0 6px; font-size: 12px; opacity: .5; }
.x:hover, .x.sure { opacity: 1; }
@media (pointer: coarse) {
  .d { width: 16px; height: 16px; position: relative; }
  .d::after { content: ''; position: absolute; inset: -8px -4px; }
  .dots { gap: 8px; }
  .x { min-height: 32px; min-width: 32px; opacity: 1; }
}
</style>
