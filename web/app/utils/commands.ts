/**
 * Slash commands in the chat input, like Claude Code's. Most are handled right here in the dashboard (the chat runs
 * `claude -p`, where /model, /config and friends don't exist); shortcuts expand into a prompt for Claude. Anything
 * else starting with / goes to Claude unchanged, so its skills (/code-review, /simplify…) still work.
 */
export interface Cmd {
  name: string
  desc: string
  /** placeholder for the argument; a command with one needs it before it can run */
  arg?: string
  /** what the argument can be: offered in the popup after the space */
  choices?: string[]
  /** only makes sense with Claude */
  claude?: boolean
  /** may run while an answer is still coming */
  busy?: boolean
  /** a shortcut: the prompt sent instead of the command */
  prompt?: (arg: string) => string
  /** the first word of the argument is one of these; offered in the popup before the choices */
  verbs?: string[]
}

/** the dashboard CT id for the prompts below; set from a component's setup (AskBar), never looked up in a handler */
let dashCt = 0
export function setCommandCt(id?: number | null) { dashCt = Number(id) || 0 }

export const NOTE_VERBS = ['inform', 'build', 'delete', 'adjust']

/**
 * "/note <verb> <title>" → the prompt. No verb (or an unknown first word) means inform, so a title that starts with
 * "Build" doesn't start a build. adjust takes its change after a "|": "/note adjust Groceries | make it a checklist"
 */
export function notePrompt(arg: string) {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(arg.trim())
  const first = m?.[1]?.toLowerCase() ?? ''
  const verb = NOTE_VERBS.includes(first) ? first : 'inform'
  const rest = NOTE_VERBS.includes(first) ? (m?.[2] ?? '') : arg.trim()
  const [titlePart = '', changePart = ''] = rest.split('|')
  const title = titlePart.trim()
  const change = changePart.trim()
  if (!title) return 'Ask me which of my notes I mean.'
  const read = `Read it from the Notes tab first (${dashCt ? `pct exec ${dashCt} -- ` : 'inside the dashboard CT: '}curl -s http://127.0.0.1:3000/api/notes).`
  if (verb === 'build') return `Build what my note "${title}" describes: ${read} Then implement it in the dashboard (/root/dashboard; follow its CLAUDE.md and .claude/rules, a new feature starts as an add-on). Do NOT edit, rewrite or tidy the note itself, and don't just summarise it. If it is big or has open choices, give a short plan first and ask me with a questions block. When done, tell me in 2-3 lines what you built and where to find it.`
  if (verb === 'delete') return `Delete my note "${title}". ${read} Show me its title and ask "Delete it? yes/no", then delete it (/api/notes/action, action delete) only after my yes.`
  if (verb === 'adjust') return change
    ? `Adjust my note "${title}": ${change}. ${read} Make the change with /api/notes/action (action edit), then tell me what changed.`
    : `Adjust my note "${title}". ${read} Ask me what to change, then make the change with /api/notes/action (action edit).`
  return `Tell me what my note "${title}" says in 2-3 lines, and its next steps if it has any. Don't change it. ${read}`
}

/** "/newaddon <id> <Name> [what it should do]" → the prompt (needs Auto: it writes files) */
export function newAddonPrompt(arg: string) {
  const m = /^(\S+)\s+(?:"([^"]+)"|(\S+))\s*([\s\S]*)$/.exec(arg.trim())
  if (!m) return 'Ask me for the id and the name of the new add-on (like "habits Habits"), and what it should do.'
  const id = m[1]!.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const name = m[2] ?? m[3]!
  const what = m[4]!.trim()
  return `Create a new dashboard add-on with id "${id}" and name "${name}" in /root/dashboard. Use the project's new-addon skill, i.e. run \`templates/new-addon ${id} "${name}"\` there, and follow CLAUDE.md and .claude/rules (design, build; a new feature is an add-on, never core). ${what ? `What it should do: ${what}.` : 'I did not say what it should do: if that matters, ask me with a questions block first, otherwise build a small useful first version.'} Build the first working version (page, API, nav entry from addon.yaml), bump its version in addon.yaml and run python3 addons/build-index.py. Check the build status in /var/lib/dash-live/status.json. This needs write access, so it only works in Auto mode: if you cannot write files, say so and stop. When done, tell me which files you created and give me the link to its page (/${id}).`
}

export const COMMANDS: Cmd[] = [
  { name: 'help', desc: 'list the commands', busy: true },
  { name: 'clear', desc: 'clear this chat and start fresh' },
  { name: 'new', desc: 'open a new chat', busy: true },
  { name: 'model', arg: 'name', desc: 'switch the model for this chat' },
  { name: 'effort', arg: 'level', desc: 'how long Claude thinks', claude: true },
  { name: 'auto', desc: 'let Claude change files, run commands and deploy', claude: true },
  { name: 'readonly', desc: 'Claude can only look again', claude: true },
  { name: 'retry', desc: 'ask the last question again' },
  { name: 'compact', desc: 'summarise the older messages to free up context', claude: true, prompt: () => '/compact' },
  { name: 'plan', arg: 'task', desc: 'plan it first (read-only), then Execute with one tap', claude: true },
  { name: 'compare', arg: 'question', desc: 'ask several models side by side, pick the best blind' },
  { name: 'team', desc: 'subagents on/off: cheaper models do the reading and editing', claude: true, busy: true },
  { name: 'tasks', desc: 'scheduled tasks: Claude runs a prompt on its own', busy: true },
  { name: 'remember', arg: 'fact', desc: 'remember a fact about you or the server in every chat', busy: true },
  { name: 'forget', arg: 'text', desc: 'forget a remembered fact', busy: true },
  { name: 'prompts', desc: 'open the prompt library', busy: true },
  { name: 'p', arg: 'slug [text]', desc: 'Use a saved prompt', busy: true },
  { name: 'changes', desc: 'open the changes panel', busy: true },
  // no `arg`: the input would then refuse a bare /logs; the unit is optional
  { name: 'logs', desc: 'open the logs panel (/logs <unit> for one unit)', busy: true },
  { name: 'schedule', arg: 'prompt', desc: 'schedule a prompt to run on its own', busy: true },
  { name: 'newaddon', arg: '<id> <Name> [what it should do]', desc: 'build a new add-on with Claude (needs Auto)', claude: true, prompt: newAddonPrompt },
  { name: 'export', desc: 'download this chat as Markdown', busy: true },
  { name: 'stop', desc: 'stop the answer that is running', busy: true },
  { name: 'status', desc: 'is anything broken on the server right now?', prompt: () => 'Is anything broken or unhealthy on the server right now? Check quickly and keep the answer short.' },
  { name: 'notes', desc: 'list my notes', claude: true, prompt: () => 'Read my notes and list them short: open ones first, grouped by topic.' },
  { name: 'note', arg: 'title', desc: 'inform, build, delete or adjust one of my notes', claude: true, verbs: NOTE_VERBS, prompt: notePrompt },
  { name: 'deploy', desc: 'send the dashboard to GitHub (core release + changed add-ons)', claude: true, prompt: () => 'Deploy the dashboard: run /root/dashboard/agent/dash-ship (it logs to /var/log/dash-rebuild.log) and tell me what was committed, the release and which add-ons were published.' },
]

/** "/model opus" → the command (if it is one of ours), its name and the argument */
export function parseCommand(text: string, cmds: Cmd[] = COMMANDS) {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim())
  if (!m) return null
  const name = m[1]!.toLowerCase()
  return { cmd: cmds.find(c => c.name === name), name, arg: m[2]!.trim() }
}
