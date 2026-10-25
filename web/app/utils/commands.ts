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
  { name: 'stop', desc: 'stop the answer that is running', busy: true },
  { name: 'status', desc: 'is anything broken on the server right now?', prompt: () => 'Is anything broken or unhealthy on the server right now? Check quickly and keep the answer short.' },
  { name: 'notes', desc: 'list my notes', claude: true, prompt: () => 'Read my notes and list them short: open ones first, grouped by topic.' },
  { name: 'note', arg: 'title', desc: 'build one of my notes', claude: true, prompt: a => `Build my note "${a}". Read it from the Notes tab first.` },
  { name: 'deploy', desc: 'send the dashboard to GitHub (core release + changed add-ons)', claude: true, prompt: () => 'Deploy the dashboard: run /root/dashboard/agent/dash-ship (it logs to /var/log/dash-rebuild.log) and tell me what was committed, the release and which add-ons were published.' },
]

/** "/model opus" → the command (if it is one of ours), its name and the argument */
export function parseCommand(text: string, cmds: Cmd[] = COMMANDS) {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim())
  if (!m) return null
  const name = m[1]!.toLowerCase()
  return { cmd: cmds.find(c => c.name === name), name, arg: m[2]!.trim() }
}
