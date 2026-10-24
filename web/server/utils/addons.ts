import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/** which add-ons are switched off; lives next to the notes in CT 104 so it rides along in the nightly backup */
const DIR = process.env.NOTES_DIR || '/var/lib/dash'
const FILE = `${DIR}/addons.json`

/** built-in add-ons + the ones from addons/<id>/addon.yaml */
export const allAddons = (): Addon[] => [...ADDONS, ...(useRuntimeConfig().public.addons as Addon[] ?? [])]

/** until the owner switches anything, a built-in whose CT isn't in config.json (a fresh install) starts off */
export function addonsOff(): string[] {
  try { return JSON.parse(readFileSync(FILE, 'utf8')).off ?? [] } catch {}
  return allAddons().filter(a => a.ct && !ctId(a.ct)).map(a => a.id)
}

export function setAddon(id: string, on: boolean) {
  const a = allAddons().find(x => x.id === id)
  if (!a) throw createError({ statusCode: 400, statusMessage: 'unknown add-on' })
  const off = new Set(addonsOff())
  if (on) {
    const missing = (a.dependsOn ?? []).filter(d => off.has(d))
    if (missing.length) throw createError({ statusCode: 400, statusMessage: `turn on ${names(missing)} first` })
    off.delete(id)
  } else {
    const users = allAddons().filter(x => !off.has(x.id) && x.dependsOn?.includes(id)).map(x => x.id)
    if (users.length) throw createError({ statusCode: 400, statusMessage: `${names(users)} need${users.length > 1 ? '' : 's'} it` })
    off.add(id)
  }
  mkdirSync(DIR, { recursive: true })
  writeFileSync(`${FILE}.tmp`, JSON.stringify({ off: [...off].sort() }))
  renameSync(`${FILE}.tmp`, FILE)
  return [...off]
}

const names = (ids: string[]) => ids.map(i => allAddons().find(a => a.id === i)?.name ?? i).join(', ')
