import type { Scope } from './context'
/**
 * Actions the model may PROPOSE. It can never run one: the ask endpoint only validates a proposal and shows it,
 * the owner presses Run, and only then does /api/ai/action call the agent. The agent validates again and holds
 * the real allowlist — this list is the description the model sees.
 *
 * Each page offers the model the actions that page is about, so it does not propose a git push on the media page.
 */
// every page that may propose actions; the notes page may not
const ALL: Scope[] = ['home', 'media', 'dev', 'metrics', 'chat']

const CATALOG: { scopes: Scope[], line: string }[] = [
  { scopes: ALL, line: 'service_restart — args: service, a service the agent knows (core apps and installed add-ons).' },
  { scopes: ['home', 'metrics', 'chat'], line: 'backup_ct — args: vmid. vzdump backup of one container.' },
  { scopes: ['home', 'metrics', 'chat'], line: 'backup_all — no args. vzdump backup of EVERY container now, one after the other (snapshot mode: nothing is stopped or paused, takes a few minutes). Propose this for "back up everything / all services"; use backup_ct for one container. It refuses on its own while another backup, restore or upgrade is running — if the snapshot lists anything under "Busy", say so instead of proposing.' },
  { scopes: ['home', 'metrics', 'chat'], line: 'ct_start / ct_shutdown / ct_reboot — args: vmid. Container power state.' },
  { scopes: ['home', 'metrics', 'chat'], line: 'apt_upgrade — args: target, either "host" or a container id. Runs apt update && apt upgrade.' },
  { scopes: ['home', 'metrics', 'chat'], line: 'apt_upgrade_all — no args. Upgrades packages on the ' + cfg().name + ' host AND in every running container, one after the other. Propose this when the owner wants everything updated; use apt_upgrade for a single target.' },
  { scopes: ['metrics', 'chat'], line: 'zfs_scrub — args: pool, the name of a ZFS pool on the host (see the pools in the snapshot).' },
  { scopes: ['metrics', 'chat'], line: 'unit_start — args: unit, either "sanoid.service" (snapshot now) or "syncoid.service" (replicate to the backup pool now); only when the snapshot lists that unit as installed.' },
  { scopes: ['home', 'metrics', 'chat'], line: `ollama_pull — args: model. Downloads it into the ai container (CT ${ctId('ai')}). ollama_stop — args: model. Unloads it from VRAM.` },
  { scopes: ['dev', 'metrics', 'chat'], line: `newdev — args: vmid (${cfg().devbox.ids.join('-')}), name, ip (${cfg().devbox.ips.join(' to ')}). Creates a dev box.` },
  { scopes: ['dev', 'chat'], line: 'git_push — args: vmid (the dev box), path (the project path), message (optional). With a message it commits everything first; without one it only pushes commits that already exist.' },
  { scopes: ['dev', 'chat'], line: 'git_fetch — args: vmid, path. Fetches from GitHub so ahead/behind is current.' },
  { scopes: ['dev', 'chat'], line: 'project_new — args: vmid, name, repo (optional git@github.com:owner/name), github (optional true), visibility (private or public, default private). With repo it clones that repo into ~/Projects/GitHub/<name>. With github: true it scaffolds the project AND creates the GitHub repo for it, then pushes. With neither it only scaffolds locally.' },
  { scopes: ['dev', 'chat'], line: 'project_remove — args: vmid, path, force (optional). Removes a project from a dev box: stops its preview and Claude session and moves the folder to ~/.pv-trash, so it is recoverable and nothing on GitHub is touched. It refuses on its own if the project has uncommitted or unpushed work. Leave force out: "delete it", "it was just a test" or "I do not need it" is NOT permission to force. Pass force: true only after the owner has been told what is unpushed and has said in this conversation that that work can be lost. This is the action for "delete/remove/get rid of <project>"; never propose git_push for that.' },
  { scopes: ['dev', 'chat'], line: 'github_publish — args: vmid, path, name (optional, defaults to the folder name), visibility (private or public, default private). For a project that exists but has no remote: creates the GitHub repo and pushes it there. Never propose it for a project that already has one.' },
]

/** the action names a scope may propose, read off the catalog lines ("name — args…", "a / b — …", ". name — …") */
export function actionNames(scope: Scope = 'metrics') {
  return CATALOG.filter(a => a.scopes.includes(scope)).flatMap(a => [...a.line.matchAll(/(?:^|\. |\s\/\s)([a-z][a-z0-9_]*)(?=\s(?:—|\/))/g)].map(m => m[1]!))
}

export function actionTool(scope: Scope = 'metrics') {
  const lines = CATALOG.filter(a => a.scopes.includes(scope)).map(a => a.line)
  return {
    type: 'function',
    function: {
      name: 'propose_action',
      description: [
        'Propose an action on the server for the owner to approve. It does NOT run: the owner sees your proposal and presses Run.',
        'Propose one when the owner asks you to do something, or when you recommend a fix they would obviously want.',
        'Do not propose the same action twice, and never claim an action has run — say it is waiting for approval.',
        'The "action" argument must be exactly one of these names, with nothing added, and "args" carries its arguments:',
        ...lines,
        'Example call: {"action": "service_restart", "args": {"service": "radarr"}, "why": "it is not responding"}',
        'Nothing else destructive exists: no deleting containers, models, snapshots or datasets, and no deleting or rewriting GitHub repos (git_push and github_publish only add to them). If the owner asks for one of those, say in one line that you have no action for it and give the exact command once.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'action name from the list' },
          args: { type: 'object', description: 'arguments for the action' },
          why: { type: 'string', description: 'one short sentence: why this action, for the owner to read' },
        },
        required: ['action'],
      },
    },
  }
}
