#!/usr/bin/env bash
# deploy.sh — build the Nuxt dashboard inside CT 104 (dash) and (re)start it; also refreshes pv in dev boxes.
# The app listens on 127.0.0.1:3000 in the CT and is published only on the tailnet: https://dash.<tailnet>/
set -euo pipefail
CT=104
DIR=$(dirname "$(readlink -f "$0")")

echo "→ agent"
systemctl restart dash-agent

echo "→ pv in dev boxes"
for id in $(pvesh get /cluster/resources --type vm --output-format json | jq -r '.[] | select(.status=="running" and ((.tags // "") | split(";") | index("dev"))) | .vmid'); do
  pct push "$id" /root/devbox/pv /usr/local/bin/pv --perms 755 && echo "   CT $id"
done

echo "→ sources → CT $CT"
tar -C "$DIR/web" --exclude=node_modules --exclude=.nuxt --exclude=.output -cf - . | pct exec $CT -- sh -c 'mkdir -p /opt/dash && tar -C /opt/dash -xf -'

echo "→ env + service"
pct exec $CT -- sh -c "umask 077; printf 'NUXT_AGENT_TOKEN=%s\nHOST=127.0.0.1\nPORT=3000\nNODE_ENV=production\n' '$(cat "$DIR/agent/token")' > /etc/dash.env"
pct push $CT "$DIR/dash.service" /etc/systemd/system/dash.service

echo "→ build"
pct exec $CT -- sh -c 'cd /opt/dash && npm install --no-audit --no-fund --loglevel=error && npm run build 2>&1 | tail -3'

pct exec $CT -- sh -c 'systemctl daemon-reload && systemctl enable -q dash && systemctl restart dash'
pct exec $CT -- sh -c 'tailscale serve status --json | jq -e ".TCP[\"443\"]" >/dev/null 2>&1 || tailscale serve --bg --https=443 http://127.0.0.1:3000 >/dev/null'
sleep 2
pct exec $CT -- curl -sf -o /dev/null http://127.0.0.1:3000/api/overview && echo "✅ https://$(pct exec $CT -- tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')/"
