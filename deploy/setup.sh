#!/usr/bin/env bash
# One-time server setup on a fresh Ubuntu 22.04 EC2 instance.
#
#   sudo REPO_URL=https://github.com/<you>/<repo>.git \
#        ENERGYPLUS_URL=<Ubuntu 22.04 .sh installer URL for your pinned version> \
#        bash setup.sh
#
# Re-running is safe: finished steps are skipped.
set -euo pipefail

REPO_URL="${REPO_URL:?Set REPO_URL}"
ENERGYPLUS_URL="${ENERGYPLUS_URL:?Set ENERGYPLUS_URL (use the same installer you tested in Phase 1)}"
LAT="${LAT:-28.6139}"
LON="${LON:-77.2090}"
APP_USER=smartair
APP_DIR=/opt/smartair
WEB_ROOT=/var/www/smartair
EP_PREFIX=/opt/EnergyPlus

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }

echo "== 1/9 System packages"
apt-get update -y
apt-get install -y software-properties-common curl git nginx sqlite3 rsync ca-certificates openssl
if ! command -v python3.11 >/dev/null; then
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -y
fi
apt-get install -y python3.11 python3.11-venv python3.11-dev build-essential

echo "== 2/9 Service user and folders"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" "$WEB_ROOT"
chown "$APP_USER:$APP_USER" "$APP_DIR"

echo "== 3/9 EnergyPlus"
if ! find "$EP_PREFIX" -maxdepth 2 -name energyplus -type f 2>/dev/null | grep -q .; then
  curl -fL "$ENERGYPLUS_URL" -o /tmp/energyplus-installer.sh
  chmod +x /tmp/energyplus-installer.sh
  # If this flag set differs from what you used in Phase 1, copy your Phase 1 commands here.
  /tmp/energyplus-installer.sh --skip-license --prefix="$EP_PREFIX" --exclude-subdir
  rm -f /tmp/energyplus-installer.sh
fi
EP_BIN="$(find "$EP_PREFIX" -maxdepth 2 -name energyplus -type f | head -1)"
[ -n "$EP_BIN" ] || { echo "EnergyPlus binary not found under $EP_PREFIX"; exit 1; }
EP_DIR="$(dirname "$EP_BIN")"
echo "EnergyPlus at $EP_DIR"

echo "== 4/9 Code"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
else
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
fi
sudo -u "$APP_USER" mkdir -p "$APP_DIR/runs" "$APP_DIR/backups" "$APP_DIR/data"

echo "== 5/9 Python environment"
sudo -u "$APP_USER" python3.11 -m venv "$APP_DIR/.venv"
sudo -u "$APP_USER" "$APP_DIR/.venv/bin/pip" install --upgrade pip
sudo -u "$APP_USER" "$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

echo "== 6/9 .env"
if [ ! -f "$APP_DIR/.env" ]; then
  ADMIN_KEY="$(openssl rand -hex 24)"
  cat > "$APP_DIR/.env" <<ENVEOF
ENERGYPLUS_DIR=$EP_DIR
ENERGYPLUS_IDD=$EP_DIR/Energy+.idd
DB_PATH=$APP_DIR/data/smartair.db
RUNS_DIR=$APP_DIR/runs
LAT=$LAT
LON=$LON
TIMEZONE=Asia/Kolkata
ADMIN_KEY=$ADMIN_KEY
FORECAST_SOURCE=live
FIXTURE_PATH=$APP_DIR/data/fixtures
SIM_TIMEOUT_S=300
PIPELINE_TIMEOUT_S=900
ENVEOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo ">>> ADMIN_KEY (save it now, it is the password for the Settings page): $ADMIN_KEY"
else
  echo ".env already exists, left unchanged"
fi

echo "== 7/9 Database seed"
# Adjust this line if your Phase 4 seed entry point has a different name.
sudo -u "$APP_USER" bash -c "cd $APP_DIR && .venv/bin/python -m db.seed"

echo "== 8/9 systemd"
cp "$APP_DIR/deploy/smartair-api.service" /etc/systemd/system/
cp "$APP_DIR/deploy/smartair-worker.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now smartair-api smartair-worker

echo "== 9/9 nginx and nightly backup"
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/smartair
ln -sf /etc/nginx/sites-available/smartair /etc/nginx/sites-enabled/smartair
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx
chmod +x "$APP_DIR/scripts/backup.sh"
echo "30 2 * * * $APP_USER $APP_DIR/scripts/backup.sh >> $APP_DIR/backups/backup.log 2>&1" > /etc/cron.d/smartair-backup
chmod 644 /etc/cron.d/smartair-backup

echo
echo "Done. Next, from your laptop: .\\scripts\\deploy_frontend.ps1 -HostIp <ELASTIC_IP> -KeyPath <key.pem>"
echo "Check services: systemctl status smartair-api smartair-worker --no-pager"
