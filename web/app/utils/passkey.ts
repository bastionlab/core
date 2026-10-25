/** WebAuthn in the browser: the server speaks base64url, the browser ArrayBuffers */
const toBuf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const toB64u = (b: ArrayBuffer | null) => b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : ''

export const passkeysSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential

/** create a passkey from the server's options; returns what /api/account `passkey-add` expects */
export async function passkeyCreate(o: any) {
  const cred = await navigator.credentials.create({ publicKey: {
    ...o,
    challenge: toBuf(o.challenge),
    user: { ...o.user, id: toBuf(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c: any) => ({ ...c, id: toBuf(c.id) })),
  } }) as PublicKeyCredential
  const r = cred.response as AuthenticatorAttestationResponse
  return { id: cred.id, clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject) }
}

/** sign in with any passkey this device has for the host */
export async function passkeyGet(o: any) {
  const cred = await navigator.credentials.get({ publicKey: { ...o, challenge: toBuf(o.challenge) } }) as PublicKeyCredential
  const r = cred.response as AuthenticatorAssertionResponse
  return { id: cred.id, clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData),
    signature: toB64u(r.signature), userHandle: toB64u(r.userHandle) }
}
