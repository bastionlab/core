/** the font stack for xterm: Nerd Font icons first (private-use glyphs only, see main.css), then --mono.
 *  Awaits the icon font, because xterm measures its cells once and would keep tofu boxes otherwise. */
export async function termFont() {
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace'
  try { await document.fonts.load("13px 'Symbols Nerd Font'", '') } catch {}
  return `'Symbols Nerd Font', ${mono}`
}
