#!/usr/bin/env bash
# deploy.sh — build the Nuxt dashboard inside CT 104 (dash) and (re)start it; also refreshes pv in dev boxes.
# The app listens on 127.0.0.1:3000 in the CT and is published only on the tailnet: https://dash.<tailnet>/
set -euo pipefail
CT=104
DIR=$(dirname "$(readlink -f "$0")")

[ -s "$DIR/agent/lan_key" ] || (umask 077; openssl rand -hex 32 > "$DIR/agent/lan_key")
[ -s "$DIR/agent/pin_hash" ] || { echo "no dashboard PIN yet — run $DIR/set-pin first" >&2; exit 1; }

echo "→ agent"
# the units live in the repo; link them in so an edit to a .service/.timer takes effect on the next deploy
for u in dash-agent.service dash-alerts.service dash-alerts.timer; do ln -sf "$DIR/agent/$u" /etc/systemd/system/$u; done
systemctl daemon-reload
systemctl enable -q --now dash-alerts.timer
systemctl restart dash-agent

echo "→ pv in dev boxes"
for id in $(pvesh get /cluster/resources --type vm --output-format json | jq -r '.[] | select(.status=="running" and ((.tags // "") | split(";") | index("dev"))) | .vmid'); do
  pct push "$id" /root/devbox/pv /usr/local/bin/pv --perms 755 && echo "   CT $id"
done

echo "→ sources → CT $CT"
# app/, server/ and public/ are replaced, not overlaid: a file deleted here must not keep being built there
tar -C "$DIR/web" --exclude=node_modules --exclude=.nuxt --exclude=.output -cf - . | pct exec $CT -- sh -c 'mkdir -p /opt/dash && cd /opt/dash && rm -rf app server public && tar -xf -'

echo "→ env + service"
pct exec $CT -- sh -c "umask 077; printf 'NUXT_AGENT_TOKEN=%s\nNUXT_DEALS_TOKEN=%s\nNUXT_MONEY_TOKEN=%s\nNUXT_PIN_HASH=%s\nNUXT_LAN_KEY=%s\nHOST=127.0.0.1\nPORT=3000\nNODE_ENV=production\n' '$(cat "$DIR/agent/token")' '$(cat /root/deals/token 2>/dev/null)' '$(cat /root/money/token 2>/dev/null)' '$(cat "$DIR/agent/pin_hash")' '$(cat "$DIR/agent/lan_key")' > /etc/dash.env"
pct push $CT "$DIR/dash.service" /etc/systemd/system/dash.service

echo "→ build"
pct exec $CT -- sh -c 'cd /opt/dash && npm install --no-audit --no-fund --loglevel=error && npm run build 2>&1 | tail -3'

pct exec $CT -- sh -c 'systemctl daemon-reload && systemctl enable -q dash && systemctl restart dash'
pct exec $CT -- sh -c 'tailscale serve status --json | jq -e ".TCP[\"443\"]" >/dev/null 2>&1 || tailscale serve --bg --https=443 http://127.0.0.1:3000 >/dev/null'

echo "→ home network (Caddy on the LAN IP)"
pct exec $CT -- sh -c 'command -v caddy >/dev/null || apt-get install -y -q caddy >/dev/null'
pct push $CT "$DIR/lan/Caddyfile" /etc/caddy/Caddyfile
pct exec $CT -- sh -c "umask 077; printf 'LAN_KEY=%s\\n' '$(cat "$DIR/agent/lan_key")' > /etc/caddy/lan.env; chown caddy /etc/caddy/lan.env
  mkdir -p /etc/systemd/system/caddy.service.d; printf '[Service]\\nEnvironmentFile=/etc/caddy/lan.env\\n' > /etc/systemd/system/caddy.service.d/lan.conf
  systemctl daemon-reload; systemctl enable -q caddy; systemctl restart caddy"
sleep 2
pct exec $CT -- curl -sf -o /dev/null http://127.0.0.1:3000/api/auth/status && echo "✅ https://$(pct exec $CT -- tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')/"
