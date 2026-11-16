/** the chosen remote-access VPN and every provider's state (owner only: not in CORE_API) */
export default defineEventHandler(event => agent(event, '/vpn'))
