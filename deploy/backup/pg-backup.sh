#!/usr/bin/env bash
# Ежедневный дамп БД пилота (AR-96).
#
# Сохранность отметок обеспечивается НЕ выбором СУБД, а бэкапом: Postgres в
# docker-compose на том же VPS, ежедневный `pg_dump` по крону, 30 копий локально
# плюс копия на втором носителе. Прогон восстановления из дампа — ЧАСТЬ ПРИЁМКИ,
# а не пожелание: бэкап, из которого ни разу не восстанавливались, — это не
# бэкап, а файл (`pg-restore-rehearsal.sh`).
#
# Крон (на хосте пилота):
#   0 3 * * *  /opt/edustore/deploy/backup/pg-backup.sh >> /var/log/edustore-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/edustore}"
KEEP="${KEEP:-30}"                       # 30 копий локально
SECONDARY_DIR="${SECONDARY_DIR:-}"       # второй носитель либо объектное хранилище
DB_URL="${DATABASE_URL:?нужен DATABASE_URL}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/edustore-$STAMP.dump"

echo "[$(date -u +%FT%TZ)] дамп → $FILE"
pg_dump --format=custom --no-owner --no-acl --file="$FILE" "$DB_URL"

SIZE=$(stat -c%s "$FILE")
if [ "$SIZE" -lt 10240 ]; then
  echo "ОШИБКА: дамп подозрительно мал ($SIZE байт) — не удаляем старые копии" >&2
  exit 1
fi
echo "[$(date -u +%FT%TZ)] готово, $SIZE байт"

# Копия на второй носитель: одна площадка — не бэкап.
if [ -n "$SECONDARY_DIR" ]; then
  mkdir -p "$SECONDARY_DIR"
  cp "$FILE" "$SECONDARY_DIR/"
  echo "[$(date -u +%FT%TZ)] копия на втором носителе: $SECONDARY_DIR"
fi

# Ротация: держим последние $KEEP копий.
ls -1t "$BACKUP_DIR"/edustore-*.dump | tail -n "+$((KEEP + 1))" | xargs -r rm -v
