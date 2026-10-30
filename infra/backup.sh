#!/bin/sh
# Backup harian database production. Dipasang di crontab VM:
#   0 2 * * * /opt/gedklin/backup.sh >> /opt/gedklin/backups/backup.log 2>&1
# Restore: gunzip -c FILE.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U gedklin gedklin
set -eu
cd /opt/gedklin
KEEP_DAYS=14
mkdir -p backups
FILE="backups/gedklin-$(date +%Y%m%d-%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U gedklin --clean --if-exists gedklin | gzip > "$FILE"
find backups -name 'gedklin-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Iseconds) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
