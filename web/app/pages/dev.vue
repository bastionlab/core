<script setup lang="ts">
useHead({ title: 'Dev · pve' })
const { data: boxes, pending, refresh } = useProjects()
const { data: o } = useOverview()
usePoll(refresh, 5000)

const { jobs, run, dismiss } = useActions()
const act = (name: string, args: any) => run(name, args, refresh)

const count = (box: any, f: (p: any) => any) => (box.projects ?? []).filter(f).length
const copy = (s: string) => navigator.clipboard?.writeText(s)
</script>

<template>
  <div>
    <AskPanel
      scope="dev" placeholder="Ask about your projects…"
      :examples="['What have I not pushed yet?', 'Which previews are running?', 'Summarise the state of my projects', 'How do I add a second dev box?']"
      @refresh="refresh"
    />

    <JobList :jobs="jobs" @dismiss="dismiss" />

    <div v-if="!boxes && pending" class="muted pad">Loading dev boxes…</div>
    <section v-for="box in boxes ?? []" :key="box.vmid" class="box">
      <h2 class="sec">
        {{ box.name }}
        <span class="faint small">CT {{ box.vmid }} · {{ box.projects?.length ?? 0 }} projects</span>
        <span class="tail">
          <span v-if="count(box, p => p.running)" class="pill ok">{{ count(box, p => p.running) }} running</span>
          <span v-if="count(box, p => p.cc?.running)" class="pill accent">{{ count(box, p => p.cc?.running) }} Claude</span>
          <span v-if="count(box, p => p.git?.dirty || p.git?.ahead)" class="pill warn">{{ count(box, p => p.git?.dirty || p.git?.ahead) }} unpushed</span>
          <button class="btn ghost small" :title="`ssh max@${box.name} — copy`" @click="copy(`ssh max@${box.name}`)">ssh</button>
          <button class="btn ghost small" title="refresh" @click="refresh">↻</button>
        </span>
      </h2>
      <div v-if="box.error" class="small bad">{{ box.error }}</div>
      <div class="projects">
        <ProjectCard v-for="p in box.projects" :key="p.path" :box="box" :p="p" @refresh="refresh" @action="act" />
      </div>
      <div v-if="!box.projects?.length && !box.error" class="faint small">No projects yet.</div>
    </section>

    <div class="grid two">
      <GithubPanel :boxes="boxes ?? []" @action="act" />
      <NewProjectPanel :boxes="boxes ?? []" @action="act" />
    </div>

    <div v-if="o" class="grid">
      <ContainersPanel title="Dev containers" :cts="o.cts.filter((c: any) => c.tags?.includes('dev'))" :updates="o.updates" @action="act" />
    </div>
  </div>
</template>

<style scoped>
.pad { padding: 40px 0; text-align: center; }
.box { margin-bottom: 22px; }
.box .sec { margin-top: 8px; flex-wrap: wrap; }
.tail { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 400; }
.projects { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(350px, 100%), 1fr)); gap: 10px; }
.two { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; }
@media (max-width: 900px) { .two { grid-template-columns: minmax(0, 1fr); } }
</style>
