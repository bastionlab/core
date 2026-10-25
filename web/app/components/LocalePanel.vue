<script setup lang="ts">
/** Settings → Language & format: the viewer's language, date and money format (per Tailscale login, /api/locale) */
const { setLocale } = useI18n()
const err = ref('')
const sample = 1234.5
async function save(patch: Partial<typeof localePrefs>) {
  err.value = ''
  try {
    const p = await $fetch<any>('/api/locale', { method: 'POST', body: { ...localePrefs, ...patch } })
    rememberPrefs(p)
    await setLocale(p.lang)
  } catch (e: any) { err.value = errText(e) }
}
</script>

<template>
  <Panel id="language" :title="$t('prefs.title')" fold="phone">
    <div class="kv">
      <span class="k small muted">{{ $t('prefs.language') }}</span>
      <div class="seg">
        <button v-for="l in LANG_OPTIONS" :key="l.code" type="button" :class="{ on: localePrefs.lang === l.code }" @click="save({ lang: l.code })">{{ l.label }}</button>
      </div>
    </div>
    <div class="kv">
      <span class="k small muted">{{ $t('prefs.dates') }}</span>
      <select :value="localePrefs.date" @change="save({ date: ($event.target as HTMLSelectElement).value })">
        <option v-for="d in DATE_OPTIONS" :key="d" :value="d">{{ new Date().toLocaleDateString(d, { day: 'numeric', month: 'short', year: 'numeric' }) }} · {{ d }}</option>
      </select>
    </div>
    <div class="kv">
      <span class="k small muted">{{ $t('prefs.money') }}</span>
      <select :value="localePrefs.money" @change="save({ money: ($event.target as HTMLSelectElement).value })">
        <option v-for="m in MONEY_OPTIONS" :key="m" :value="m">{{ sample.toLocaleString(m, { style: 'currency', currency: 'EUR' }) }} · {{ m }}</option>
      </select>
    </div>
    <p class="faint small">{{ $t('prefs.content') }}</p>
    <div v-if="err" class="errbox small">{{ err }}</div>
  </Panel>
</template>

<style scoped>
.kv { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
.kv:first-of-type { border-top: 0; }
.k { width: 110px; flex: none; }
p { margin: 10px 0 0; }
@media (max-width: 640px) { .k { width: 100%; } }
</style>
