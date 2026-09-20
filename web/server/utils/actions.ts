/**
 * Actions the model may PROPOSE. It can never run one: the ask endpoint only validates a proposal and shows it,
 * the owner presses Run, and only then does /api/ai/action call the agent. The agent validates again and holds
 * the real allowlist — this list is the description the model sees.
 *
 * Each page offers the model the actions that page is about, so it does not propose a git push on the media page.
 */
type Scope = 'home' | 'media' | 'dev' | 'metrics' | 'chat'
const ALL: Scope[] = ['home', 'media', 'dev', 'metrics', 'chat']

const CATALOG: { scopes: Scope[], line: string }[] = [
  { scopes: ALL, line: 'service_restart — args: service, one of dash, ollama, open-webui, searxng, immich, immich-ml, jellyfin, audiobookshelf, seerr, qbittorrent, prowlarr, radarr, sonarr, lazylibrarian, bazarr, gluetun, subgen. Restarting gluetun rotates the VPN server; media-vpn-sync re-attaches the clients.' },
  { scopes: ['home', 'metrics', 'chat'], line: 'backup_ct — args: vmid. vzdump backup of one container.' },
  { scopes: ['home', 'metrics', 'chat'], line: 'ct_start / ct_shutdown / ct_reboot — args: vmid. Container power state.' },
  { scopes: ['home', 'metrics', 'chat'], line: 'apt_upgrade — args: target, either "host" or a container id. Runs apt update && apt upgrade.' },
  { scopes: ['home', 'metrics', 'chat'], line: 'apt_upgrade_all — no args. Upgrades packages on the pve host AND in every running container, one after the other. Propose this when the owner wants everything updated; use apt_upgrade for a single target.' },
  { scopes: ['metrics', 'chat'], line: 'zfs_scrub — args: pool, either "tank" or "backup".' },
  { scopes: ['metrics', 'chat'], line: 'unit_start — args: unit, either "sanoid.service" (snapshot now) or "syncoid.service" (replicate to the backup pool now).' },
  { scopes: ['home', 'metrics', 'chat'], line: 'ollama_pull — args: model. Downloads it into CT 105. ollama_stop — args: model. Unloads it from VRAM.' },
  { scopes: ['dev', 'metrics', 'chat'], line: 'newdev — args: vmid (200-299), name, ip (192.168.1.60-99). Creates a dev box.' },
  { scopes: ['dev', 'chat'], line: 'git_push — args: vmid (the dev box), path (the project path), message (optional). With a message it commits everything first; without one it only pushes commits that already exist.' },
  { scopes: ['dev', 'chat'], line: 'git_fetch — args: vmid, path. Fetches from GitHub so ahead/behind is current.' },
  { scopes: ['dev', 'chat'], line: 'project_new — args: vmid, name, repo (optional git@github.com:owner/name), github (optional true), visibility (private or public, default private). With repo it clones that repo into ~/Projects/GitHub/<name>. With github: true it scaffolds the project AND creates the GitHub repo for it, then pushes. With neither it only scaffolds locally.' },
  { scopes: ['dev', 'chat'], line: 'github_publish — args: vmid, path, name (optional, defaults to the folder name), visibility (private or public, default private). For a project that exists but has no remote: creates the GitHub repo and pushes it there. Never propose it for a project that already has one.' },
]

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
        'Nothing destructive exists: no deleting containers, models, snapshots or datasets. If the owner asks for that, explain the command instead.',
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
