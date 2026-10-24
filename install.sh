#!/usr/bin/env bash
# install.sh — the pvedash core on a fresh Proxmox host, in one go:
#   curl -fsSL https://raw.githubusercontent.com/pvedash/core/main/install.sh | bash
#   (or ./install.sh --dry-run to see every step without changing anything)
#
# What it does: clones the core to /root/dashboard, asks a few questions (tailnet, LAN, which CT id/IP the
# dashboard gets, your Tailscale login), writes /etc/dash/config.json, creates the dashboard CT (Debian,
# node 22, Tailscale, Caddy), sets a PIN and runs deploy.sh. Add-ons come later from the Add-ons page.
# Nothing existing is overwritten: it stops if the CT id is taken or /etc/dash/config.json already exists.
set -euo pipefail

REPO=${PVEDASH_REPO:-https://github.com/pvedash/core}
DIR=${PVEDASH_DIR:-/root/dashboard}
CONF=/etc/dash/config.json
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

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

say "questions (Enter keeps the suggestion)"
TAILNET=$(ask "Tailnet name (admin console → DNS, e.g. tail1234.ts.net)" "example.ts.net")
OWNER=$(ask "Your Tailscale login (who may open the dashboard)" "you@example.com")
CT=$(ask "CT id for the dashboard" "$NEXT_ID")
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
# add-ons are installed into addons/ from the Add-ons page (pvedash/addons)
run mkdir -p "$DIR/addons"

# --- config.json ----------------------------------------------------------------------------------------
say "writing $CONF"
CFG=$(jq -n --arg tn "$TAILNET" --arg owner "$OWNER" --arg subnet "$SUBNET" --arg host "$HOST_IP" \
  --arg dir "$DIR" --argjson ct "$CT" --arg ctip "$CT_IP" --arg lo "${DEV_IDS%-*}" --arg hi "${DEV_IDS#*-}" --arg pfx "$PREFIX" '{
  name: "pve", tailnet: $tn, owner_logins: [$owner],
  lan: { subnet: $subnet, host_ip: $host },
  paths: { dashboard: $dir, devbox: "/root/devbox" },
  devbox: { ids: [($lo|tonumber), ($hi|tonumber)], ips: [($pfx + ".60"), ($pfx + ".99")] },
  cts: { dash: { id: $ct, ip: $ctip } },
  marketplace: { index: "https://raw.githubusercontent.com/pvedash/addons/main/index.json",
                 repo: "https://github.com/pvedash/addons", counter: "", share_installs: false } }')
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
say "agent token + PIN"
if [ $DRY = 0 ]; then (umask 077; [ -s "$DIR/agent/token" ] || openssl rand -hex 32 > "$DIR/agent/token"); fi
run "$DIR/set-pin" </dev/tty
say "first deploy"
run "$DIR/deploy.sh"
say "done: https://dash.$TAILNET/ — add-ons are on the Add-ons page"
