#!/usr/bin/env bash
# install.sh — the Bastion core on a fresh Proxmox host, in one go:
#   curl -fsSL https://raw.githubusercontent.com/bastionlab/core/main/install.sh | bash
#   (or ./install.sh --dry-run to see every step without changing anything)
#   ./install.sh --from-backup dash-<host>-<time>.tar.gz   moves an install: the backup's config answers the
#   questions, its data, settings and (with the passphrase) secrets are restored, its add-ons reinstalled.
#
# What it does: clones the core to /root/dashboard, asks a few questions (tailnet, LAN, which CT id/IP the
# dashboard gets, your Tailscale login), writes /etc/dash/config.json, creates the dashboard CT (Debian,
# node 22, Tailscale, Caddy), sets a PIN and runs deploy.sh. Add-ons come later from the Add-ons page.
# Nothing existing is overwritten: it stops if the CT id is taken or /etc/dash/config.json already exists.
set -euo pipefail

REPO=${BASTION_REPO:-https://github.com/bastionlab/core}
DIR=${BASTION_DIR:-/root/dashboard}
CONF=/etc/dash/config.json
DRY=0; FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --from-backup) FROM=$(readlink -f "${2:?--from-backup needs a file}"); shift ;;
    *) echo "install.sh: unknown option $1" >&2; exit 1 ;;
  esac; shift
done

say() { printf '\033[1m→ %s\033[0m\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
run() { if [ $DRY = 1 ]; then printf '   [dry-run] %s\n' "$*"; else "$@"; fi; }
# questions come from the terminal even when the script itself is piped in through curl
ask() { local v; read -rp "$1 [$2]: " v </dev/tty || true; printf '%s' "${v:-$2}"; }

# --- checks -------------------------------------------------------------------------------------------
[ "$(id -u)" = 0 ] || die "run as root on the Proxmox host"
command -v pveversion >/dev/null || die "this is not a Proxmox host (no pveversion)"
[ -e "$CONF" ] && [ $DRY = 0 ] && die "$CONF exists already — this host is set up; use $DIR/deploy.sh"

# --- what this host looks like --------------------------------------------------------------------------
HOST_CIDR=$(ip -4 -o addr show vmbr0 2>/dev/null | awk '{print $4}' | head -1)
[ -n "$HOST_CIDR" ] || die "no IPv4 on vmbr0"
HOST_IP=${HOST_CIDR%/*}; BITS=${HOST_CIDR#*/}
GW=$(ip -4 route show default | awk '{print $3}' | head -1)
SUBNET=$(python3 -c "import ipaddress,sys; print(ipaddress.ip_interface(sys.argv[1]).network)" "$HOST_CIDR")
NEXT_ID=$(pvesh get /cluster/nextid)
# local-lvm when there is one (the Proxmox default), else the first active storage that takes CT disks
STORAGE=$(pvesm status --content rootdir 2>/dev/null | awk 'NR>1 && $3=="active"{print $1}' | grep -x local-lvm || \
  pvesm status --content rootdir 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')
PREFIX=${HOST_IP%.*}

# --from-backup: the old install's config.json (inside the backup's etc item) suggests the answers
OLD_CFG='{}'
if [ -n "$FROM" ]; then
  [ -f "$FROM" ] || die "no backup $FROM"
  OLD_CFG=$(python3 -c 'import io,json,sys,tarfile
o=tarfile.open(sys.argv[1]); i=tarfile.open(fileobj=io.BytesIO(o.extractfile("items/etc.tar.gz").read()))
print(json.dumps(json.load(i.extractfile("config.json"))))' "$FROM") || die "$FROM is not a dashboard backup"
fi
old() { jq -r "($1) // empty" <<<"$OLD_CFG"; }
OLD_CT=$(old .cts.dash.id); pct status "${OLD_CT:-0}" >/dev/null 2>&1 && OLD_CT=""

say "questions (Enter keeps the suggestion)"
TAILNET=$(ask "Tailnet name (admin console → DNS, e.g. tail1234.ts.net)" "$(old .tailnet || true)"); TAILNET=${TAILNET:-example.ts.net}
OWNER=$(ask "Your Tailscale login (who may open the dashboard)" "$(old '.owner_logins[0]')"); OWNER=${OWNER:-you@example.com}
CT=$(ask "CT id for the dashboard" "${OLD_CT:-$NEXT_ID}")
CT_IP=$(ask "Its LAN IP" "$PREFIX.$(( ${HOST_IP##*.} + 4 ))")
STORAGE=$(ask "Storage for its disk" "${STORAGE:-local-lvm}")
DEV_IDS=$(ask "Dev box id range" "200-299")

[[ "$CT" =~ ^[0-9]+$ ]] || die "CT id must be a number"
pct status "$CT" >/dev/null 2>&1 && die "CT $CT exists already"
[[ "$CT_IP" =~ ^[0-9.]+$ ]] || die "bad IP"
ping -c1 -W1 "$CT_IP" >/dev/null 2>&1 && die "$CT_IP answers already — pick a free one"

# --- core sources -------------------------------------------------------------------------------------
say "packages + core sources in $DIR"
run apt-get install -y -q git jq curl python3-yaml
if [ -d "$DIR/.git" ]; then run git -C "$DIR" pull -q --ff-only; else run git clone -q "$REPO" "$DIR"; fi
# add-ons are installed into addons/ from the Add-ons page (bastionlab/addons)
run mkdir -p "$DIR/addons"

# --- config.json ----------------------------------------------------------------------------------------
say "writing $CONF"
CFG=$(jq -n --arg tn "$TAILNET" --arg owner "$OWNER" --arg subnet "$SUBNET" --arg host "$HOST_IP" \
  --arg dir "$DIR" --argjson ct "$CT" --arg ctip "$CT_IP" --arg lo "${DEV_IDS%-*}" --arg hi "${DEV_IDS#*-}" --arg pfx "$PREFIX" '{
  name: "pve", tailnet: $tn, owner_logins: [$owner],
  lan: { subnet: $subnet, host_ip: $host },
  paths: { dashboard: $dir, devbox: "/root/devbox", backends: "/opt/bastion" },
  devbox: { ids: [($lo|tonumber), ($hi|tonumber)], ips: [($pfx + ".60"), ($pfx + ".99")] },
  cts: { dash: { id: $ct, ip: $ctip } },
  marketplace: { index: "https://raw.githubusercontent.com/bastionlab/addons/main/index.json",
                 repo: "https://github.com/bastionlab/addons", counter: "", share_installs: false } }')
if [ $DRY = 1 ]; then echo "$CFG" | sed 's/^/   /'; else mkdir -p /etc/dash; (umask 077; echo "$CFG" > "$CONF"); chmod 644 "$CONF"; fi

# --- the dashboard CT -------------------------------------------------------------------------------------
say "CT $CT (dash) at $CT_IP"
TPL=$(pveam available --section system 2>/dev/null | awk -v a="$(dpkg --print-architecture)" '$2 ~ "debian-13-standard_.*_" a {print $2}' | sort -V | tail -1)
[ -n "$TPL" ] || die "no Debian 13 template offered by pveam"
pveam list local 2>/dev/null | grep -q "$TPL" || run pveam download local "$TPL"
run pct create "$CT" "local:vztmpl/$TPL" --hostname dash --cores 2 --memory 2048 --rootfs "$STORAGE:8" \
  --net0 "name=eth0,bridge=vmbr0,ip=$CT_IP/$BITS,gw=$GW" --unprivileged 1 --features nesting=1 --onboot 1 --ostype debian
# Tailscale inside an unprivileged CT needs the tun device
if [ $DRY = 1 ]; then echo "   [dry-run] tun device lines → /etc/pve/lxc/$CT.conf"
else printf 'lxc.cgroup2.devices.allow: c 10:200 rwm\nlxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file\n' >> "/etc/pve/lxc/$CT.conf"; fi
run pct start "$CT"
run pct exec "$CT" -- sh -c 'for i in $(seq 30); do ping -c1 -W1 deb.debian.org >/dev/null 2>&1 && break; sleep 1; done
  apt-get update -q && apt-get install -y -q curl ca-certificates caddy
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -q nodejs
  curl -fsSL https://tailscale.com/install.sh | sh'
say "log the CT into your tailnet (open the link it prints)"
run pct exec "$CT" -- tailscale up --hostname dash

# --- agent, PIN, first deploy ----------------------------------------------------------------------------
if [ -n "$FROM" ]; then
  say "restoring $FROM"
  # the new host's own answers win over the backup's config: keep this config.json, restore everything else
  run cp "$CONF" "$CONF.new"
  read -rsp "Backup passphrase (Enter = skip the secrets): " DASH_BACKUP_PASS </dev/tty || true; echo
  if [ $DRY = 0 ]; then DASH_BACKUP_PASS="$DASH_BACKUP_PASS" python3 -I "$DIR/agent/dash-backup" restore "$FROM" --no-rebuild --skip-missing; fi
  run python3 -c 'import json,sys; old=json.load(open(sys.argv[1])); new=json.load(open(sys.argv[2])); old.update({k: new[k] for k in ("tailnet","owner_logins","lan","paths")}); old["cts"]={"dash": new["cts"]["dash"]}; open(sys.argv[1],"w").write(json.dumps(old, indent=2))' "$CONF" "$CONF.new"
  unset DASH_BACKUP_PASS
  ADDONS=$(python3 -c 'import json,sys,tarfile; print(" ".join(json.load(tarfile.open(sys.argv[1]).extractfile("manifest.json"))["addons"]))' "$FROM")
fi
say "agent token + PIN"
if [ $DRY = 0 ]; then (umask 077; [ -s "$DIR/agent/token" ] || openssl rand -hex 32 > "$DIR/agent/token"); fi
if [ -s "$DIR/agent/pin_hash" ]; then echo "   PIN from the backup"; else run "$DIR/set-pin" </dev/tty; fi
say "first deploy"
run "$DIR/deploy.sh"
if [ -n "${ADDONS:-}" ]; then
  # the backup's add-ons, in dependency order (addon-get refuses one whose depends_on is missing; retry those last)
  say "add-ons from the backup: $ADDONS"
  for pass in 1 2 3; do
    for a in $ADDONS; do [ -d "$DIR/addons/$a" ] || run python3 -I "$DIR/agent/addon-get" install "$a" --no-rebuild >/dev/null 2>&1 || true; done
  done
  run "$DIR/deploy.sh"
  echo "   add-on CTs are new and empty; their data comes back with: $DIR/agent/dash-backup restore $FROM --skip-missing"
fi
say "done: https://dash.$TAILNET/ — add-ons are on the Add-ons page"
