interface Msg { role: 'user' | 'assistant' | 'system' | 'tool', content: string, tool_calls?: any[], tool_name?: string }

/** models fill the tool schema loosely: the name may carry the arg hint, args may be a JSON string or inlined */
function normalizeProposal(raw: any) {
  const action = String(raw?.action ?? '').trim().split(/[\s{(,]/)[0]!
  let args = raw?.args
  if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = undefined } }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    const { action: _a, args: _b, why: _c, ...rest } = raw ?? {}
    args = rest
  }
  return { action, args }
}

const MAX_ROUNDS = 5 // tool call → result → model, before we make it answer with what it has

/**
 * Ollama reports reasoning in message.thinking, but a model that was trained on inline <think> tags writes them
 * into the content instead — and then a stray "</think>" is rendered as part of the answer. This routes anything
 * between the tags to the reasoning channel and drops the tags, holding back a chunk that ends mid-tag.
 */
function thinkSplitter() {
  let inside = false, hold = ''
  const OPEN = '<think>', CLOSE = '</think>'
  /** a trailing "</thin" could be the start of a tag: keep it until the next chunk decides */
  const partial = (t: string) => {
    for (let n = Math.min(CLOSE.length - 1, t.length); n > 0; n--) {
      const tail = t.slice(-n)
      if (OPEN.startsWith(tail) || CLOSE.startsWith(tail)) return n
    }
    return 0
  }
  return (chunk: string) => {
    let t = hold + chunk, c = '', r = ''
    hold = ''
    for (;;) {
      const tag = inside ? CLOSE : OPEN
      const i = t.indexOf(tag)
      if (i < 0) break
      const before = t.slice(0, i)
      if (inside) r += before
      else c += before
      inside = !inside
      t = t.slice(i + tag.length)
    }
    const keep = partial(t)
    if (keep) { hold = t.slice(-keep); t = t.slice(0, -keep) }
    if (inside) r += t
    else c += t
    return { c, r }
  }
}

/**
 * Ask a local model about the server. The live snapshot goes in as the system prompt, and the model can call
 * the tools in utils/tools.ts (web search, page fetch, weather). The reply streams back as NDJSON lines:
 * {r} reasoning, {c} answer text, {tool} tool activity, {done, tokens, tps} at the end, {error} on failure.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ q?: string, model?: string, think?: boolean, web?: boolean, history?: Msg[], scope?: Scope }>(event)
  const q = String(body?.q ?? '').trim().slice(0, 4000)
  if (!q) throw createError({ statusCode: 400, statusMessage: 'empty question' })

  const scope: Scope = SCOPES.includes(body?.scope as Scope) ? body!.scope as Scope : 'metrics'
  const models = await aiModels(event).catch(() => null)
  if (!models?.length) throw createError({ statusCode: 502, statusMessage: 'Ollama is unreachable or has no models' })
  const context = await scopeContext(event, scope, models)
  const usable = models.filter(m => !m.uncensored)
  const model = usable.find(m => m.name === body.model)?.name ?? usable.find(m => m.warm)?.name ?? usable[0]?.name
  if (!model) throw createError({ statusCode: 502, statusMessage: 'no usable model installed' })

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
  const web = body.web !== false
  const messages: Msg[] = [
    {
      role: 'system',
      content: SYSTEM + SCOPE_HINT[scope] + '\n'
        + (scope === 'metrics' || scope === 'chat' || scope === 'home' ? AI_CATALOG : '')
        + (web ? WEB_HINT : '') + (scope === 'notes' ? '' : ACTION_HINT) + '\nLive data:\n' + context,
    },
    ...history,
    { role: 'user', content: q },
  ]

  const { ollamaUrl } = useRuntimeConfig(event)
  setResponseHeaders(event, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Model': model })
  const enc = new TextEncoder()

  return new ReadableStream({
    async start(ctl) {
      const send = (x: any) => ctl.enqueue(enc.encode(JSON.stringify(x) + '\n'))
      let tokens = 0, seconds = 0
      const proposed = new Set<string>()
      let answered = false
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const res = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model, stream: true, think: !!body.think, messages,
              ...(round < MAX_ROUNDS - 1 ? { tools: [...(web ? TOOLS : []), ...(scope === 'notes' ? [] : [actionTool(scope)])] } : {}),
            }),
            signal: AbortSignal.timeout(10 * 60_000),
          })
          if (!res.ok || !res.body) throw new Error(`ollama: ${(await res.text()).slice(0, 300)}`)

          const reader = res.body.getReader(), dec = new TextDecoder()
          const split = thinkSplitter()
          let buf = '', content = '', calls: any[] = []
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buf += dec.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop()!
            for (const line of lines) {
              if (!line.trim()) continue
              const j = JSON.parse(line)
              if (j.error) throw new Error(j.error)
              if (j.message?.thinking) send({ r: j.message.thinking })
              if (j.message?.content) {
                const { c, r } = split(j.message.content)
                if (r) send({ r })
                if (c) { content += c; answered ||= !!c.trim(); send({ c }) }
              }
              if (j.message?.tool_calls?.length) calls.push(...j.message.tool_calls)
              if (j.done) {
                tokens += j.eval_count ?? 0
                seconds += (j.eval_duration ?? 0) / 1e9
              }
            }
          }

          if (!calls.length) break
          messages.push({ role: 'assistant', content, tool_calls: calls })
          for (const c of calls) {
            const name = c.function?.name, args = c.function?.arguments ?? {}
            if (name === 'propose_action') {
              // never executed here — validated by the agent, shown to the owner, run only if they press Run
              const { action, args: aArgs } = normalizeProposal(args)
              let result: any
              // a weak model re-proposes the same thing every round and the owner gets a stack of identical
              // Run buttons; tell it the proposal already exists instead of showing it twice
              const key = action + JSON.stringify(aArgs ?? {})
              if (proposed.has(key)) {
                messages.push({ role: 'tool', tool_name: name, content: JSON.stringify({ status: 'already proposed above and waiting for the owner — do not propose it again, just answer' }) })
                continue
              }
              proposed.add(key)
              try {
                const { desc } = await agent<{ desc: string }>(event, '/action/check', { method: 'POST', body: { name: action, args: aArgs } })
                send({ proposal: { action, args: aArgs, desc, why: args?.why } })
                result = { status: 'shown to the owner, waiting for approval', action, desc }
              } catch (e: any) {
                result = { error: e?.statusMessage || e?.message || 'invalid action' }
                send({ toolDone: name, error: result.error })
              }
              messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result) })
              continue
            }
            send({ tool: name, args })
            const result = await runTool(name, args)
            send({ toolDone: name, error: (result as any)?.error })
            messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result).slice(0, 20_000) })
          }
        }
        // a model that spends its last round on the tool call can finish with a proposal and no prose;
        // the owner would see a bare Run button, so say what it is waiting for
        if (!answered && proposed.size) send({ c: 'Proposed above — it runs only when you press Run.' })
        send({ done: true, model, scope, tokens, tps: seconds ? tokens / seconds : null })
      } catch (e: any) {
        send({ error: e?.message ?? String(e) })
      } finally {
        ctl.close()
      }
    },
  })
})
