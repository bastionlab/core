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
  const read = 'Read it from the Notes tab first (pct exec 104 -- curl -s http://127.0.0.1:3000/api/notes).'
  if (verb === 'build') return `Build what my note "${title}" describes: ${read} Then implement it in the dashboard (/root/dashboard; follow its CLAUDE.md and .claude/rules, a new feature starts as an add-on). Do NOT edit, rewrite or tidy the note itself, and don't just summarise it. If it is big or has open choices, give a short plan first and ask me with a questions block. When done, tell me in 2-3 lines what you built and where to find it.`
  if (verb === 'delete') return `Delete my note "${title}". ${read} Show me its title and ask "Delete it? yes/no", then delete it (/api/notes/action, action delete) only after my yes.`
  if (verb === 'adjust') return change
    ? `Adjust my note "${title}": ${change}. ${read} Make the change with /api/notes/action (action edit), then tell me what changed.`
    : `Adjust my note "${title}". ${read} Ask me what to change, then make the change with /api/notes/action (action edit).`
  return `Tell me what my note "${title}" says in 2-3 lines, and its next steps if it has any. Don't change it. ${read}`
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
