<script setup lang="ts">
useHead({ title: 'Dev · pve' })
const { data: boxes, pending, refresh } = useProjects()
const { data: o } = useOverview()
usePoll(refresh, 5000)

const { jobs, run, dismiss } = useActions()
const act = (name: string, args: any) => run(name, args, refresh)

const all = computed(() => (boxes.value ?? []).flatMap(b => b.projects ?? []))
const previews = computed(() => all.value.filter((p: any) => p.running).length)
const claudes = computed(() => all.value.filter((p: any) => p.cc?.running).length)
const dirty = computed(() => all.value.filter((p: any) => p.git?.dirty || p.git?.ahead).length)
</script>

<template>
  <div>
    <AskPanel
      scope="dev" placeholder="Ask about your projects…"
      :examples="['What have I not pushed yet?', 'Which previews are running?', 'Summarise the state of my projects', 'How do I add a second dev box?']"
      @refresh="refresh"
    />

    <div class="summary">
      <span class="pill">{{ all.length }} projects</span>
      <span class="pill" :class="previews ? 'ok' : ''">{{ previews }} previews running</span>
      <span class="pill" :class="claudes ? 'accent' : ''">{{ claudes }} Claude sessions</span>
      <span class="pill" :class="dirty ? 'warn' : ''">{{ dirty }} with unpushed work</span>
    </div>

    <JobList :jobs="jobs" @dismiss="dismiss" />

    <div class="grid"><NewProjectPanel :boxes="boxes ?? []" @action="act" /></div>

    <div v-if="!boxes && pending" class="muted pad">Loading dev boxes…</div>
    <Panel v-for="box in boxes ?? []" :key="box.vmid" :title="box.name" :sub="`CT ${box.vmid} · ${box.ip}`" class="box">
      <template #actions>
        <code class="faint small">ssh max@{{ box.name }}</code>
        <button class="btn ghost small" @click="refresh">↻</button>
      </template>
      <div v-if="box.error" class="small bad">{{ box.error }}</div>
      <div class="projects">
        <ProjectCard v-for="p in box.projects" :key="p.path" :box="box" :p="p" @refresh="refresh" @action="act" />
      </div>
      <div v-if="!box.projects?.length && !box.error" class="faint small">No projects yet — create one above.</div>
    </Panel>

    <div v-if="o" class="grid">
      <ContainersPanel title="Dev containers" sub="LXC boxes tagged dev" :cts="o.cts.filter((c: any) => c.tags?.includes('dev'))" :updates="o.updates" />
    </div>
  </div>
</template>

<style scoped>
.summary { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.pad { padding: 40px 0; text-align: center; }
.box { margin-bottom: 16px; }
.projects { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; }
</style>
