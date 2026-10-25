/** load the viewer's language/date/money prefs and switch vue-i18n to that language */
export default defineNuxtPlugin((nuxtApp) => {
  const i18n = nuxtApp.$i18n as any
  if (localePrefs.lang !== 'en') i18n.setLocale(localePrefs.lang)
  $fetch<any>('/api/locale').then((p) => {
    rememberPrefs(p)
    if (i18n.locale.value !== p.lang) i18n.setLocale(p.lang)
  }).catch(() => {})
})
