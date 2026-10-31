// Small dependency-free highlighter for code blocks in chat and notes: keywords, strings, comments, numbers.
// Covers the languages the owner's replies mostly use; anything else gets strings, comments and numbers only.

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

const JS = 'as async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while yield type interface enum implements private public protected readonly null undefined true false'
const PY = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self'
const SH = 'if then else elif fi case esac for while until do done in function select return local export source cd echo exit'
const SQL = 'select from where and or not null insert into values update set delete create table alter drop join left right inner outer on group by order having limit as distinct union index primary key references default is in like between case when then else end true false'

const COMMENT = {
  slash: /\/\/[^\n]*|\/\*[\s\S]*?\*\//.source,
  hash: /#[^\n]*/.source,
  dash: /--[^\n]*|\/\*[\s\S]*?\*\//.source,
  none: '(?!)',
}

const family = (lang: string): [string, string] => {
  let l = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (l.startsWith('file:') || l.includes('.')) l = l.split('.').pop() ?? '' // file:parser.py or parser.py -> py
  switch (l) {
    case 'js': case 'javascript': case 'jsx': case 'ts': case 'typescript': case 'tsx': case 'vue':
      return [JS, COMMENT.slash]
    case 'py': case 'python':
      return [PY, COMMENT.hash]
    case 'sh': case 'bash': case 'zsh': case 'shell':
      return [SH, COMMENT.hash]
    case 'sql':
      return [SQL, COMMENT.dash]
    case 'json':
      return ['true false null', COMMENT.none]
    default:
      return ['', `${COMMENT.slash}|${COMMENT.hash}`]
  }
}

const STR = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/.source
const NUM = /\b\d[\w.]*/.source
const WORD = /[A-Za-z_$][\w$]*/.source
// hideSecrets() (utils/secrets.ts) leaves \uE000<digits>\uE001 markers in the text: pass them through whole, or the digits get a span
const MARK = /\uE000\d+\uE001/.source

/** HTML for a code block: <span class="hl-k|s|n|c"> around keywords, strings, numbers and comments */
export function highlight(code: string, lang = ''): string {
  const [words, comment] = family(lang)
  const kw = new Set(words.split(' ').filter(Boolean))
  const re = new RegExp(`(${comment})|(${STR})|(${MARK})|(${NUM})|(${WORD})`, 'g')
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const [text, com, str, , num, word] = m
    const cls = com ? 'c' : str ? 's' : num ? 'n' : kw.has(word!) ? 'k' : ''
    out += esc(code.slice(last, m.index))
    out += cls ? `<span class="hl-${cls}">${esc(text)}</span>` : esc(text)
    last = m.index + text.length
  }
  return out + esc(code.slice(last))
}
