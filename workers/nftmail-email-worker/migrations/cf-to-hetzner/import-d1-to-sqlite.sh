#!/usr/bin/env bash
# import-d1-to-sqlite.sh — load the D1 data dump into the Hetzner Bun SQLite DB.
#
# RUN ON THE HETZNER BOX. The Bun worker must have been started at least once so
# that bun-sqlite-d1.ts initSchema() has created the tables. The D1 dump is
# data-only (INSERT statements) and uses ON CONFLICT DO NOTHING semantics for
# emails (blind_id UNIQUE), so re-running is safe/idempotent for emails.
#
# Usage:
#   ./import-d1-to-sqlite.sh /path/to/nftmail-d1-data.sql
#
# Env:
#   SQLITE_PATH  path to the Bun worker DB (default /opt/ghostagent/bun-worker/data/nftmail.db)
set -euo pipefail

DUMP="${1:?usage: import-d1-to-sqlite.sh <dump.sql>}"
DB="${SQLITE_PATH:-/opt/ghostagent/bun-worker/data/nftmail.db}"

if [ ! -f "$DUMP" ]; then echo "✗ dump not found: $DUMP"; exit 1; fi
if [ ! -f "$DB" ]; then
  echo "✗ SQLite DB not found at $DB — start the Bun worker once to create the schema first."; exit 1;
fi

echo "▶ Backing up current DB → ${DB}.bak.$(date +%s)"
cp "$DB" "${DB}.bak.$(date +%s)"

echo "▶ Row counts BEFORE import:"
sqlite3 "$DB" "SELECT 'agents', COUNT(*) FROM agents UNION ALL SELECT 'emails', COUNT(*) FROM emails UNION ALL SELECT 'tier_history', COUNT(*) FROM tier_history UNION ALL SELECT 'identities', COUNT(*) FROM identities;"

echo "▶ Importing $DUMP …"
# Wrap in a transaction; PRAGMA defers FK checks during bulk load.
sqlite3 "$DB" <<SQL
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;
.read $DUMP
COMMIT;
PRAGMA foreign_keys = ON;
SQL

echo "▶ Row counts AFTER import:"
sqlite3 "$DB" "SELECT 'agents', COUNT(*) FROM agents UNION ALL SELECT 'emails', COUNT(*) FROM emails UNION ALL SELECT 'tier_history', COUNT(*) FROM tier_history UNION ALL SELECT 'identities', COUNT(*) FROM identities;"

echo "✓ Import complete. Remember to shred the dump:  shred -u $DUMP"
