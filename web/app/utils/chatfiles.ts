/** Claude drafts text/code for the side panel in fences like ```file:parser.py (same name again = new version) */
const FENCE = /^```file:([^\s`]+)[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm

export function parseFiles(answer: string) {
  return [...answer.matchAll(FENCE)].map(m => ({ name: m[1]!, text: m[2]! }))
}

/** the answer as it is shown in the chat: file blocks become a one-line pointer (also while one is still streaming) */
export function stripFiles(answer: string) {
  return answer
    .replace(FENCE, (_, n) => `\`${n}\` is in the File tab`)
    .replace(/^```file:([^\s`]+)[^\n]*\n[\s\S]*$/m, (_, n) => `writing \`${n}\` ...`)
}
