import { DatabaseSync } from 'node:sqlite'
import { createHash, createHmac, createPublicKey, randomBytes, scryptSync, timingSafeEqual, verify } from 'node:crypto'
import { join } from 'node:path'
import type { H3Event } from 'h3'

/**
 * Accounts: who you are, whichever way you reached the dashboard (tailnet, LAN, your own VPN). The network gate in
 * middleware/auth.ts stays; this only replaces "whoever knows the PIN" with a name. A user signs in with a
 * password (+ a TOTP code once set up) or a passkey; the PIN keeps working as the owner's quick unlock.
 * Roles are stored but not enforced yet, so only owner accounts can be created for now.
 * users.db lives next to notes and chats in /var/lib/dash (in the nightly backup).
 */
const DIR = process.env.NOTES_DIR || '/var/lib/dash'
const db = new DatabaseSync(join(DIR, 'users.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL DEFAULT 'owner', pw TEXT NOT NULL DEFAULT '', totp TEXT NOT NULL DEFAULT '',
    gen INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
  CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, jwk TEXT NOT NULL,
    alg INTEGER NOT NULL, counter INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', created REAL NOT NULL,
    used REAL);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`)

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export interface User { id: number, name: string, role: string, pw: string, totp: string, gen: number, created: number }

export const anyUsers = () => !!db.prepare('SELECT 1 FROM users LIMIT 1').get()
export const userById = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
export const userByName = (name: string) => db.prepare('SELECT * FROM users WHERE name = ?').get(name) as User | undefined
/** the account a PIN unlock signs in as: the first owner, or none (uid 0) before any account exists */
export const pinUser = () => db.prepare(`SELECT * FROM users WHERE role = 'owner' ORDER BY id LIMIT 1`).get() as User | undefined
export const publicUser = (u?: User) => u ? { id: u.id, name: u.name, role: u.role, totp: !!u.totp } : null

// --- passwords ------------------------------------------------------------------------------------------------
export const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i
export const pwProblem = (pw: string) => pw.length < 10 ? 'Password: at least 10 characters' : pw.length > 200 ? 'Password: too long' : ''

function hashPw(pw: string) {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')}`
}
export function checkPw(u: User | undefined, pw: string) {
  // same work for unknown names, so timing doesn't tell which accounts exist
  const [, salt, hash] = (u?.pw || `scrypt:${'0'.repeat(32)}:${'0'.repeat(64)}`).split(':')
  const got = scryptSync(pw, Buffer.from(salt!, 'hex'), 32, { N: 16384, r: 8, p: 1 })
  return !!u?.pw && timingSafeEqual(got, Buffer.from(hash!, 'hex'))
}

export function createUser(name: string, pw: string, role = 'owner') {
  // a random starting gen: ids of removed accounts can come back, their old cookies must not
  const r = db.prepare('INSERT INTO users (name, role, pw, gen, created) VALUES (?, ?, ?, ?, ?)').run(name, role, hashPw(pw), randomBytes(4).readUInt32BE() >>> 1, Date.now() / 1000)
  return userById(Number(r.lastInsertRowid))!
}
export const setPw = (id: number, pw: string) => db.prepare('UPDATE users SET pw = ? WHERE id = ?').run(hashPw(pw), id)
export const setTotp = (id: number, secret: string) => db.prepare('UPDATE users SET totp = ? WHERE id = ?').run(secret, id)
/** "sign out everywhere": every cookie of this user stops validating; the global one also ends PIN sessions */
export const bumpGen = (id: number) => db.prepare('UPDATE users SET gen = gen + 1 WHERE id = ?').run(id)
export const metaGet = (k: string) => (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as any)?.v as string | undefined
export const metaSet = (k: string, v: string) => db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v)
export const globalGen = () => Number((db.prepare(`SELECT v FROM meta WHERE k = 'gen'`).get() as any)?.v ?? 0)
export const bumpGlobalGen = () => db.prepare(`INSERT INTO meta (k, v) VALUES ('gen', '1') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1`).run()

// --- TOTP (RFC 6238: 30 s, 6 digits, SHA-1 — what every authenticator app speaks) ---------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function b32(buf: Buffer) {
  let bits = '', out = ''
  for (const b of buf) bits += b.toString(2).padStart(8, '0')
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
  return out
}
function unb32(s: string) {
  let bits = ''
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v < 0) return Buffer.alloc(0); bits += v.toString(2).padStart(5, '0') }
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
function hotp(key: Buffer, n: number) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(n))
  const h = createHmac('sha1', key).update(c).digest()
  const o = h[h.length - 1]! & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
const usedCodes = new Map<string, number>()
/** one step either side for clock drift; a code works once */
export function checkTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false
  const key = unb32(secret), now = Math.floor(Date.now() / 30_000)
  for (const n of [now, now - 1, now + 1]) {
    const want = hotp(key, n)
    if (timingSafeEqual(Buffer.from(want), Buffer.from(code))) {
      const k = `${secret}:${n}`
      if (usedCodes.has(k)) return false
      usedCodes.set(k, Date.now())
      for (const [x, t] of usedCodes) if (Date.now() - t > 120_000) usedCodes.delete(x)
      return true
    }
  }
  return false
}

// --- passkeys (WebAuthn, attestation "none") -----------------------------------------------------------------------
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url')
const unb64u = (s: string) => Buffer.from(String(s ?? ''), 'base64url')

/** a passkey is bound to a host name; browsers refuse IP addresses, so on the LAN IP only password + code work */
export function passkeyRp(event: H3Event) {
  const h = event.node.req.headers
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0]!.trim()
  const id = host.replace(/:\d+$/, '')
  const ok = !!id && !/^[\d.]+$/.test(id) && !id.includes(':') && id !== 'localhost'
  return { id, origin: `https://${host}`, ok }
}

const challenges = new Map<string, { kind: 'create' | 'get', uid: number, at: number }>()
export function newChallenge(kind: 'create' | 'get', uid = 0) {
  for (const [k, v] of challenges) if (Date.now() - v.at > 300_000) challenges.delete(k)
  const c = b64u(randomBytes(32))
  challenges.set(c, { kind, uid, at: Date.now() })
  return c
}

/** just enough CBOR for attestation objects and COSE keys */
function cbor(buf: Buffer, pos = 0): [any, number] {
  const ib = buf[pos++]!, major = ib >> 5, ai = ib & 31
  let len: number
  if (ai < 24) len = ai
  else if (ai === 24) len = buf[pos++]!
  else if (ai === 25) { len = buf.readUInt16BE(pos); pos += 2 }
  else if (ai === 26) { len = buf.readUInt32BE(pos); pos += 4 }
  else if (ai === 27) { len = Number(buf.readBigUInt64BE(pos)); pos += 8 }
  else throw new Error('unsupported CBOR')
  switch (major) {
    case 0: return [len, pos]
    case 1: return [-1 - len, pos]
    case 2: return [buf.subarray(pos, pos + len), pos + len]
    case 3: return [buf.subarray(pos, pos + len).toString('utf8'), pos + len]
    case 4: { const a = []; for (let i = 0; i < len; i++) { const [v, p] = cbor(buf, pos); a.push(v); pos = p } return [a, pos] }
    case 5: { const m = new Map(); for (let i = 0; i < len; i++) { const [k, p1] = cbor(buf, pos); const [v, p2] = cbor(buf, p1); m.set(k, v); pos = p2 } return [m, pos] }
    case 7: return [ai === 20 ? false : ai === 21 ? true : null, pos]
    default: throw new Error('unsupported CBOR')
  }
}

function coseToJwk(m: Map<number, any>) {
  const kty = m.get(1), alg = m.get(3)
  if (kty === 2 && m.get(-1) === 1) return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) } }
  if (kty === 1 && m.get(-1) === 6) return { alg, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64u(m.get(-2)) } }
  if (kty === 3) return { alg, jwk: { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)) } }
  throw new Error('unsupported key type')
}

function checkClient(event: H3Event, clientDataJSON: string, kind: 'create' | 'get') {
  const raw = unb64u(clientDataJSON)
  const cd = JSON.parse(raw.toString('utf8'))
  const ch = challenges.get(cd.challenge)
  challenges.delete(cd.challenge)
  if (cd.type !== `webauthn.${kind}` || !ch || ch.kind !== kind || Date.now() - ch.at > 300_000) throw new Error('expired, try again')
  if (cd.origin !== passkeyRp(event).origin) throw new Error('wrong address')
  return { raw, ch }
}

function parseAuthData(ad: Buffer, rpId: string) {
  if (!ad.subarray(0, 32).equals(createHash('sha256').update(rpId).digest())) throw new Error('wrong address')
  const flags = ad[32]!
  if (!(flags & 1)) throw new Error('no user presence')
  return { flags, counter: ad.readUInt32BE(33) }
}

export const passkeysOf = (uid: number) => db.prepare('SELECT id, label, created, used FROM passkeys WHERE uid = ? ORDER BY created').all(uid) as any[]
export const deletePasskey = (uid: number, id: string) => db.prepare('DELETE FROM passkeys WHERE uid = ? AND id = ?').run(uid, id)
export const anyPasskeys = () => !!db.prepare('SELECT 1 FROM passkeys LIMIT 1').get()

export function registerOptions(event: H3Event, u: User) {
  const r = passkeyRp(event)
  return {
    challenge: newChallenge('create', u.id),
    rp: { id: r.id, name: 'Bastion' },
    user: { id: b64u(Buffer.from(String(u.id))), name: u.name, displayName: u.name },
    pubKeyCredParams: [-7, -8, -257].map(alg => ({ type: 'public-key', alg })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    attestation: 'none',
    excludeCredentials: passkeysOf(u.id).map(p => ({ type: 'public-key', id: p.id })),
    timeout: 120_000,
  }
}

export function registerVerify(event: H3Event, u: User, body: any, label: string) {
  const { ch } = checkClient(event, body?.clientDataJSON, 'create')
  if (ch.uid !== u.id) throw new Error('expired, try again')
  const [att] = cbor(unb64u(body?.attestationObject))
  const ad: Buffer = att.get('authData')
  const { flags } = parseAuthData(ad, passkeyRp(event).id)
  if (!(flags & 0x40)) throw new Error('no key in the response')
  const idLen = ad.readUInt16BE(53)
  const credId = ad.subarray(55, 55 + idLen)
  const [cose] = cbor(ad, 55 + idLen)
  const { alg, jwk } = coseToJwk(cose)
  createPublicKey({ key: jwk as any, format: 'jwk' }) // throws on a malformed key
  db.prepare('INSERT INTO passkeys (id, uid, jwk, alg, counter, label, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(b64u(credId), u.id, JSON.stringify(jwk), alg, ad.readUInt32BE(33), label.slice(0, 60), Date.now() / 1000)
}

export const loginOptions = (event: H3Event) => ({ challenge: newChallenge('get'), rpId: passkeyRp(event).id, userVerification: 'preferred', timeout: 120_000 })

/** the signed-in user, or throws */
export function loginVerify(event: H3Event, body: any) {
  const { raw } = checkClient(event, body?.clientDataJSON, 'get')
  const pk = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(body?.id ?? '')) as any
  if (!pk) throw new Error('unknown passkey')
  const ad = unb64u(body?.authenticatorData)
  const { counter } = parseAuthData(ad, passkeyRp(event).id)
  const data = Buffer.concat([ad, createHash('sha256').update(raw).digest()])
  const key = createPublicKey({ key: JSON.parse(pk.jwk), format: 'jwk' })
  const ok = verify(pk.alg === -8 ? null : 'sha256', data, key, unb64u(body?.signature))
  if (!ok) throw new Error('signature does not match')
  if (counter && pk.counter && counter <= pk.counter) throw new Error('passkey counter went backwards (cloned key?)')
  db.prepare('UPDATE passkeys SET counter = ?, used = ? WHERE id = ?').run(counter, Date.now() / 1000, pk.id)
  const u = userById(pk.uid)
  if (!u) throw new Error('unknown passkey')
  return u
}

export const newTotpSecret = () => b32(randomBytes(20))

// --- people (Settings → Users, owner only) -----------------------------------------------------------------------
db.exec(`CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, role TEXT NOT NULL, by INTEGER NOT NULL,
  created REAL NOT NULL, expires REAL NOT NULL)`)

export const listUsers = () => (db.prepare('SELECT id, name, role, totp, created FROM users ORDER BY id').all() as any[])
  .map(u => ({ id: u.id, name: u.name, role: u.role, totp: !!u.totp, created: u.created,
    passkeys: (db.prepare('SELECT COUNT(*) n FROM passkeys WHERE uid = ?').get(u.id) as any).n }))
const owners = () => (db.prepare(`SELECT COUNT(*) n FROM users WHERE role = 'owner'`).get() as any).n as number

export function setRole(id: number, role: string) {
  const u = userById(id)
  if (!u) throw new Error('no such account')
  if (u.role === 'owner' && role !== 'owner' && owners() <= 1) throw new Error('the last owner stays owner')
  db.prepare('UPDATE users SET role = ?, gen = gen + 1 WHERE id = ?').run(role, id) // signs them out: new role on next sign-in
}
export function removeUser(id: number) {
  const u = userById(id)
  if (!u) throw new Error('no such account')
  if (u.role === 'owner' && owners() <= 1) throw new Error('the last owner can\'t be removed')
  db.prepare('DELETE FROM passkeys WHERE uid = ?').run(id)
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
}

const tokHash = (t: string) => createHash('sha256').update(t).digest('hex')
/** a one-time link: whoever opens it picks a name and password and gets `role`; valid 7 days */
export function createInvite(role: string, by: number) {
  const token = b64u(randomBytes(24))
  const now = Date.now() / 1000
  db.prepare('INSERT INTO invites (hash, role, by, created, expires) VALUES (?, ?, ?, ?, ?)').run(tokHash(token), role, by, now, now + 7 * 86400)
  return token
}
export const listInvites = () => db.prepare('SELECT substr(hash, 1, 12) id, role, created, expires FROM invites WHERE expires > ? ORDER BY created').all(Date.now() / 1000) as any[]
export const dropInvite = (id: string) => db.prepare('DELETE FROM invites WHERE substr(hash, 1, 12) = ?').run(id)
export function inviteFor(token: string) {
  const i = db.prepare('SELECT * FROM invites WHERE hash = ?').get(tokHash(String(token))) as any
  return i && i.expires > Date.now() / 1000 ? { role: i.role as string } : null
}
export function acceptInvite(token: string, name: string, pw: string) {
  const i = inviteFor(token)
  if (!i) throw new Error('this invite has expired or was used')
  if (userByName(name)) throw new Error('that name is taken')
  db.prepare('DELETE FROM invites WHERE hash = ?').run(tokHash(token))
  return createUser(name, pw, i.role)
}
