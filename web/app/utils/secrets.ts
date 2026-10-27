/**
 * Secrets in a chat answer (API keys, tokens, passwords, private keys, e-mail addresses) are shown blurred until
 * tapped, so a screenshot of the chat or someone looking over a shoulder does not leak them. Idea from Odysseus
 * (censor.js). hideSecrets() swaps each one for a marker before the markdown is rendered (so code blocks and links
 * keep working), showSecrets() puts them back into the HTML: plain inside attributes, blurred in the text.
 */
const A = '', Z = '' // private-use characters: never in real text, untouched by markdown
const VAL = `[^\\s"'\`,;<>${A}${Z}]`
const RULES: { re: RegExp, group?: boolean, ok?: (v: string) => boolean }[] = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { re: /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}|glpat-[\w-]{20,}|tskey-[a-z]+-[\w-]{10,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})/g },
  { re: new RegExp(`(\\bBearer\\s+)(${VAL}{16,})`, 'g'), group: true },
  // password=…, "token": "…", api_key: … — only values that look generated (a digit in them), not `token: string`
  { re: new RegExp(`(\\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|auth[_-]?token)\\b["']?\\s*[:=]\\s*["']?)(${VAL}{8,})`, 'gi'), group: true, ok: v => /\d/.test(v) && !/^[$<{]/.test(v) },
  { re: /\b(?!git@|noreply@)[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi },
]

export function hideSecrets(text: string) {
  const found: string[] = []
  const mark = (v: string) => `${A}${found.push(v) - 1}${Z}`
  for (const r of RULES) {
    text = text.replace(r.re, (m: string, pre?: string, v?: string) => {
      if (!r.group) return m.includes(A) ? m : mark(m)
      return r.ok && !r.ok(v!) ? m : pre! + mark(v!)
    })
  }
  return { text, found }
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const MARK = new RegExp(`${A}(\\d+)${Z}`, 'g')

export function showSecrets(html: string, found: string[]) {
  if (!found.length) return html
  return html
    .replace(/="[^"]*"/g, attr => attr.replace(MARK, (_, i) => esc(found[+i] ?? '')))
    .replace(MARK, (_, i) => `<span class="sec" title="tap to show">${esc(found[+i] ?? '')}</span>`)
}
