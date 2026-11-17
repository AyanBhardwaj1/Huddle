#!/usr/bin/env bash
# Huddle box installer for Raspberry Pi 5 (Raspberry Pi OS Bookworm, 64-bit). PRD section 10.
#
# Installs Node 22 + pnpm, builds the UIs, creates the box signer key, and installs three systemd
# units: huddle-engine, huddle-bridge and huddle-kiosk (Chromium at http://localhost:8080/box).
# Optional: a Cloudflare Tunnel unit if CLOUDFLARE_TUNNEL_TOKEN is set.
#
# Usage (on the Pi, from the repo root):   sudo ./scripts/pi-setup.sh
# Re-running is safe.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo ./scripts/pi-setup.sh" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-pi}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
UNIT_SRC="$REPO_DIR/scripts/systemd"
ETC_DIR=/etc/huddle
DATA_DIR=/var/lib/huddle

echo "==> Huddle box setup (repo: $REPO_DIR, user: $RUN_USER)"

echo "==> System packages"
apt-get update -y
apt-get install -y curl ca-certificates git build-essential python3 chromium-browser unclutter alsa-utils \
  || apt-get install -y curl ca-certificates git build-essential python3 chromium unclutter alsa-utils

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pnpm >/dev/null; then
  echo "==> pnpm"
  npm install -g pnpm@9
fi

echo "==> Directories"
install -d -m 750 -o "$RUN_USER" -g "$RUN_USER" "$ETC_DIR" "$DATA_DIR"

if [[ ! -f "$ETC_DIR/huddle.env" ]]; then
  echo "==> Creating $ETC_DIR/huddle.env from .env.example (edit it to add keys)"
  install -m 600 -o "$RUN_USER" -g "$RUN_USER" /dev/null "$ETC_DIR/huddle.env"
  # systemd EnvironmentFile keeps inline "# comments" as part of the value (PORT=8080 # ... would
  # break the engine), so strip them; whole-line comments stay.
  sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^#]*[^#[:space:]])?[[:space:]]+#.*$/\1/; s/^([A-Za-z_][A-Za-z0-9_]*=)[[:space:]]+#.*$/\1/' \
    "$REPO_DIR/.env.example" > "$ETC_DIR/huddle.env"
  sed -i "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR|" "$ETC_DIR/huddle.env"
fi

echo "==> Install dependencies and build the UIs"
sudo -u "$RUN_USER" bash -lc "cd '$REPO_DIR' && pnpm install --frozen-lockfile && pnpm build"

# The box signer key never leaves the box (PRD section 10). The engine reads it from
# /etc/huddle/box-signer.json when BOX_SIGNER_SECRET_KEY is not set, and creates it on first start
# if it is missing. We only make sure the directory permissions are right here.
if [[ -f "$ETC_DIR/box-signer.json" ]]; then
  chmod 600 "$ETC_DIR/box-signer.json"
  chown "$RUN_USER:$RUN_USER" "$ETC_DIR/box-signer.json"
fi

echo "==> systemd units"
for unit in huddle-engine.service huddle-bridge.service huddle-kiosk.service; do
  sed -e "s|@REPO_DIR@|$REPO_DIR|g" -e "s|@RUN_USER@|$RUN_USER|g" -e "s|@RUN_HOME@|$RUN_HOME|g" \
    "$UNIT_SRC/$unit" > "/etc/systemd/system/$unit"
done

if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "==> Cloudflare Tunnel"
  if ! command -v cloudflared >/dev/null; then
    curl -fsSL -o /tmp/cloudflared.deb \
      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    dpkg -i /tmp/cloudflared.deb
  fi
  install -m 600 /dev/null "$ETC_DIR/tunnel.env"
  echo "TUNNEL_TOKEN=$CLOUDFLARE_TUNNEL_TOKEN" > "$ETC_DIR/tunnel.env"
  sed -e "s|@RUN_USER@|$RUN_USER|g" "$UNIT_SRC/huddle-tunnel.service" > /etc/systemd/system/huddle-tunnel.service
  systemctl enable huddle-tunnel.service
fi

systemctl daemon-reload
systemctl enable huddle-engine.service huddle-bridge.service huddle-kiosk.service
systemctl restart huddle-engine.service huddle-bridge.service

echo
echo "Done."
echo "  Engine:  systemctl status huddle-engine   (logs: journalctl -u huddle-engine -f)"
echo "  Bridge:  systemctl status huddle-bridge   (runs the mock until hardware.ts is implemented;"
echo "           set BRIDGE_ARGS= in $ETC_DIR/huddle.env to run the real bridge)"
echo "  Kiosk:   starts with the desktop session; reboot to see http://localhost:8080/box full screen"
echo "  Config:  $ETC_DIR/huddle.env   (set PUBLIC_ENGINE_URL to the tunnel URL for remote players)"
