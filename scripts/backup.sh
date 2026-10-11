#!/usr/bin/env bash
# Nightly SQLite backup, keeps the 7 newest copies. Installed by deploy/setup.sh.
set -euo pipefail
set -a; source /opt/smartair/.env; set +a
BACKUP_DIR=/opt/smartair/backups
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/smartair-$STAMP.db'"
ls -1t "$BACKUP_DIR"/smartair-*.db | tail -n +8 | xargs -r rm --
echo "Backup written: smartair-$STAMP.db"
