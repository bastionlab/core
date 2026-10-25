/** Settings → Users (owner only: unlisted in CORE_API): accounts, open invites, whether tailnet guests may reach sign-in */
export default defineEventHandler(() => ({ users: listUsers(), invites: listInvites(), guests: tailnetGuests() }))
