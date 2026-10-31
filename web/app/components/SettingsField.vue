<script setup lang="ts">
/** one field an add-on asks for in addon.yaml `settings:`; secrets are write-only (set / replace / clear) */
const { t } = useI18n()
const props = defineProps<{ addon: string, f: any }>()
const emit = defineEmits<{ saved: [] }>()

const draft = ref<any>(props.f.type === 'secret' ? '' : props.f.value)
watch(() => props.f.value, v => { if (props.f.type !== 'secret') draft.value = v })
const editing = ref(false)
const busy = ref(false)
const error = ref('')
const done = ref(false)
const opts = computed(() => (props.f.options ?? []).map((o: any) => (typeof o === 'object' ? o : { value: String(o), label: String(o) })))
const dirty = computed(() => props.f.type === 'secret' ? editing.value : String(draft.value ?? '') !== String(props.f.value ?? ''))

async function save(value = draft.value) {
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/settings/set', { method: 'POST', body: { addon: props.addon, key: props.f.key, value } })
    editing.value = false; done.value = true; setTimeout(() => (done.value = false), 1500)
    if (props.f.type === 'secret') draft.value = ''
    emit('saved')
  } catch (e: any) { error.value = e?.data?.statusMessage || e?.statusMessage || e?.message; throw e } finally { busy.value = false }
}
const saveNow = (v?: any) => save(v ?? draft.value).catch(() => {}) // error shows under the field
// toggles and selects flip at once and save in the background; a refusal flips them back
function quick(v: any) {
  const before = draft.value
  draft.value = v
  save(v).catch(() => { draft.value = before; useToast().toast(`${props.f.label} not saved: ${error.value}`, { tone: 'bad' }) })
}
</script>

<template>
  <div class="field">
    <div class="lbl">
      <b>{{ f.label }}</b>
      <span v-if="f.help" class="faint small">{{ f.help }}</span>
    </div>
    <div class="ctl">
      <template v-if="f.type === 'toggle'">
        <div class="seg">
          <button type="button" :class="{ on: draft }" @click="quick(true)">{{ t('settings.on') }}</button>
          <button type="button" :class="{ on: !draft }" @click="quick(false)">{{ t('settings.off') }}</button>
        </div>
      </template>
      <template v-else-if="f.type === 'select'">
        <div class="seg">
          <button v-for="o in opts" :key="o.value" type="button" :class="{ on: String(draft) === o.value }" @click="quick(o.value)">{{ o.label }}</button>
        </div>
      </template>
      <template v-else-if="f.type === 'secret'">
        <span v-if="!editing" class="small" :class="f.set ? 'muted' : 'warn'">{{ f.set ? `${t('settings.set')}${f.updated ? ' · ' + ago(f.updated) : ''}` : t('settings.notSet') }}</span>
        <input v-else v-model="draft" type="password" autocomplete="off" :placeholder="f.label">
        <button v-if="!editing" type="button" class="btn sm" @click="editing = true">{{ f.set ? t('settings.replace') : t('settings.set') }}</button>
        <template v-else>
          <button type="button" class="btn primary sm" :disabled="busy || !draft" @click="saveNow()">{{ t('common.save') }}</button>
          <button v-if="f.set" type="button" class="btn ghost sm" :disabled="busy" @click="saveNow('')">{{ t('settings.clear') }}</button>
          <button type="button" class="btn ghost sm" @click="editing = false; draft = ''">{{ t('common.cancel') }}</button>
        </template>
      </template>
      <template v-else>
        <input v-model="draft" :type="f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'" :min="f.min" :max="f.max">
        <button v-if="dirty" type="button" class="btn primary sm" :disabled="busy" @click="saveNow()">{{ t('common.save') }}</button>
      </template>
      <span v-if="done" class="ok small">{{ t('settings.saved') }}</span>
    </div>
    <div v-if="error" class="errbox small">{{ error }}</div>
  </div>
</template>

<style scoped>
.field { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); align-items: center; gap: 4px 18px; padding: 12px 0; border-top: 1px solid var(--line); }
.field:first-child { border-top: 0; padding-top: 2px; }
.lbl { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lbl b { font-size: 13px; font-weight: 500; }
.ctl { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
.ctl input { flex: 1; min-width: 140px; }
.errbox { grid-column: 1 / -1; }
@media (max-width: 640px) {
  .field { grid-template-columns: minmax(0, 1fr); }
  .ctl { justify-content: flex-start; }
}
</style>
