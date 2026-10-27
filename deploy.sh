#!/usr/bin/env bash
# deploy.sh — build the Nuxt dashboard inside CT 104 (dash) and (re)start it; runs each add-on's deploy.sh hook.
# The app listens on 127.0.0.1:3000 in the CT and is published only on the tailnet: https://dash.<tailnet>/
set -euo pipefail
DIR=$(dirname "$(readlink -f "$0")")
CONF=/etc/dash/config.json   # this install's tailnet, LAN, CT ids/IPs (shape: config.example.json)
[ -s "$CONF" ] || { echo "no $CONF yet — copy $DIR/config.example.json there and fill it in" >&2; exit 1; }
c() { jq -r "($1) // empty" "$CONF"; }   # a key this install lacks is empty, not "null"
CT=$(c .cts.dash.id)
BACK=$(c .paths.backends); BACK=${BACK:-/root}   # backend repos (deals, money) keep their API tokens there

[ -s "$DIR/agent/lan_key" ] || (umask 077; openssl rand -hex 32 > "$DIR/agent/lan_key")
[ -s "$DIR/agent/pin_hash" ] || { echo "no dashboard PIN yet — run $DIR/set-pin first" >&2; exit 1; }

echo "→ agent"
# the units live in the repo; link them in so an edit to a .service/.timer takes effect on the next deploy
for u in dash-agent.service dash-alerts.service dash-alerts.timer dash-addons-update.service dash-addons-update.timer dash-backup.service dash-backup.timer dash-live.service; do ln -sf "$DIR/agent/$u" /etc/systemd/system/$u; done
systemctl daemon-reload
systemctl enable -q --now dash-alerts.timer dash-addons-update.timer dash-backup.timer dash-live.service
systemctl restart dash-agent

echo "→ add-on hooks"
# an add-on that puts something on the host or into its CT on every deploy ships an executable deploy.sh
for h in "$DIR"/addons/*/deploy.sh; do [ -x "$h" ] && { "$h" || echo "   $h failed (continuing)"; }; done

echo "→ config + sources → CT $CT"
pct exec $CT -- mkdir -p /etc/dash && pct push $CT "$CONF" /etc/dash/config.json --perms 644
# app/, server/ and public/ are replaced, not overlaid: a file deleted here must not keep being built there
# add-ons ride along as addons/<id>/ (web/nuxt.config.ts extends their web/ layers)
tar -C "$DIR" --exclude=node_modules --exclude=.nuxt --exclude=.output --exclude=__pycache__ --exclude=.git --exclude='addons/*/agent' --exclude='addons/*/deploy.sh' --exclude='addons/.github' --transform 's,^web/,,;s,^web$,.,' -cf - web addons VERSION | pct exec $CT -- sh -c 'mkdir -p /opt/dash && cd /opt/dash && rm -rf app server public shared addons i18n && tar -xf -'

echo "→ env + service"
pct exec $CT -- sh -c "umask 077; printf 'NUXT_AGENT_URL=http://%s:7070\nNUXT_OLLAMA_URL=http://%s:11434\nNUXT_DEALS_URL=http://%s:8090\nNUXT_MONEY_URL=http://%s:8090\nNUXT_OWNER_LOGINS=%s\nNUXT_AGENT_TOKEN=%s\nNUXT_DEALS_TOKEN=%s\nNUXT_MONEY_TOKEN=%s\nNUXT_PIN_HASH=%s\nNUXT_LAN_KEY=%s\nHOST=127.0.0.1\nPORT=3000\nNODE_ENV=production\n' '$(c .lan.host_ip)' '$(c .cts.ai.ip)' '$(c .cts.deals.ip)' '$(c .cts.money.ip)' '$(c '.owner_logins | join(",")')' '$(cat "$DIR/agent/token")' '$(cat "$BACK/deals/token" 2>/dev/null)' '$(cat "$BACK/money/token" 2>/dev/null)' '$(cat "$DIR/agent/pin_hash")' '$(cat "$DIR/agent/lan_key")' > /etc/dash.env"
# the app's user: a fixed one (both instances share /var/lib/dash); uid 65506 is what the state files already belong to
pct exec $CT -- sh -c 'getent group dash >/dev/null || groupadd -g 65506 dash; getent passwd dash >/dev/null || useradd -u 65506 -g dash -M -d /var/lib/dash -s /usr/sbin/nologin dash'
# the standby instance: port 3001, no background workers (those run only on the main :3000 instance)
pct exec $CT -- sh -c "printf 'PORT=3001\nLEARN_WORKER=0\nRESEARCH_WORKER=0\n' > /etc/dash-standby.env; chmod 600 /etc/dash-standby.env"
pct push $CT "$DIR/dash.service" /etc/systemd/system/dash.service
pct push $CT "$DIR/dash-b.service" /etc/systemd/system/dash-b.service

echo "→ build"
# a release tarball brings web/.output prebuilt (core only): used as long as no add-on brings pages of its own
if [ -f "$DIR/web/.output/VERSION" ] && [ "$(cat "$DIR/web/.output/VERSION")" = "$(cat "$DIR/VERSION" 2>/dev/null)" ] && ! ls -d "$DIR"/addons/*/web >/dev/null 2>&1; then
  echo "   prebuilt $(cat "$DIR/VERSION")"
  tar -C "$DIR/web" -cf - .output | pct exec $CT -- sh -c 'cd /opt/dash && rm -rf .output && tar -xf -'
else
  pct exec $CT -- sh -c 'cd /opt/dash && npm install --no-audit --no-fund --loglevel=error && npm run build 2>&1 | tail -3'
fi

pct exec $CT -- sh -c 'systemctl daemon-reload && systemctl enable -q dash dash-b && systemctl restart dash-b && systemctl restart dash'
# tailnet → the Caddy loopback listener (:8080), which balances over :3000 and :3001
pct exec $CT -- sh -c 'tailscale serve --bg --https=443 http://127.0.0.1:8080 >/dev/null'

echo "→ home network (Caddy on the LAN IP; waits for / retries until the CT has that address after a boot)"
pct exec $CT -- sh -c 'command -v caddy >/dev/null || apt-get install -y -q caddy >/dev/null'
pct push $CT "$DIR/lan/Caddyfile" /etc/caddy/Caddyfile
pct exec $CT -- sh -c "umask 077; printf 'LAN_KEY=%s\\nDASH_IP=%s\\nLAN_SUBNET=%s\\n' '$(cat "$DIR/agent/lan_key")' '$(c .cts.dash.ip)' '$(c .lan.subnet)' > /etc/caddy/lan.env; chown caddy /etc/caddy/lan.env
  mkdir -p /etc/systemd/system/caddy.service.d; printf '[Unit]\\nWants=network-online.target\\nAfter=network-online.target\\nStartLimitIntervalSec=0\\n[Service]\\nEnvironmentFile=/etc/caddy/lan.env\\nRestart=on-failure\\nRestartSec=5\\n' > /etc/systemd/system/caddy.service.d/lan.conf
  systemctl daemon-reload; systemctl enable -q caddy; systemctl restart caddy"
sleep 2
pct exec $CT -- curl -sf -o /dev/null http://127.0.0.1:3000/api/auth/status && echo "✅ https://$(pct exec $CT -- tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')/"
