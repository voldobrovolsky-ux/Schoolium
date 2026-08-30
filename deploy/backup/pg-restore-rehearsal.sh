#!/usr/bin/env bash
# Прогон восстановления из дампа — ЧАСТЬ ПРИЁМКИ (AR-96), не пожелание.
#
# Критерий готовности версии сформулирован так: «когда база восстанавливается из
# вчерашнего pg_dump на чистом Postgres и все G-проверки на восстановленной базе
# зелёные — этап "сохранность" закрыт». Этот скрипт и есть его исполнение:
# поднимает пустую базу, разворачивает в неё дамп и гоняет по ней ворота.
#
#   DATABASE_URL=postgresql://…/edustore \
#   deploy/backup/pg-restore-rehearsal.sh /var/backups/edustore/edustore-….dump
set -euo pipefail

DUMP="${1:?укажите файл дампа}"
SRC_URL="${DATABASE_URL:?нужен DATABASE_URL}"
REHEARSAL_DB="${REHEARSAL_DB:-edustore_restore_rehearsal}"

BASE_URL="${SRC_URL%/*}"
ADMIN_URL="$BASE_URL/postgres"
TARGET_URL="$BASE_URL/$REHEARSAL_DB"

echo "→ чистая база $REHEARSAL_DB"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$REHEARSAL_DB\";"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$REHEARSAL_DB\";"

echo "→ восстановление из $DUMP"
pg_restore --no-owner --no-acl --dbname="$TARGET_URL" "$DUMP"

echo "→ ворота на ВОССТАНОВЛЕННОЙ базе"
DATABASE_URL="$TARGET_URL" npm --workspace apps/api run tenant:check
DATABASE_URL="$TARGET_URL" npm --workspace apps/api run authz:check
DATABASE_URL="$TARGET_URL" npm --workspace apps/api run schoolium:check

echo "✓ восстановление прогнано: база поднялась из дампа, ворота зелёные"
