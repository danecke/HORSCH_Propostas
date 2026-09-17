#!/usr/bin/env bash
# Bootstrap do banco em homologação (D1 simulado pelo Miniflare).
#
# Na plataforma OpenAI Sites as migrações drizzle/*.sql são aplicadas pelo
# control plane. Rodando local/homologação ninguém as aplica — este script
# faz isso direto no arquivo SQLite do estado do Miniflare, de forma
# incremental (registra as aplicadas em _hom_migrations).
#
# Uso (dentro do container, com o app já no ar):
#   bash scripts/bootstrap-hom.sh
# Ou de fora:
#   docker exec <container> bash scripts/bootstrap-hom.sh
set -euo pipefail

app_url="${APP_URL:-http://localhost:3000}"
state_dir="${WRANGLER_STATE_DIR:-/app/.wrangler}"
migrations_dir="${MIGRATIONS_DIR:-/app/drizzle}"

echo "==> Aguardando o app responder em ${app_url} ..."
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "${app_url}/"; then break; fi
  sleep 2
  [[ "$i" == 60 ]] && { echo "App não respondeu em 120s" >&2; exit 1; }
done

# Toca um endpoint que abre o D1 para o Miniflare materializar o .sqlite
echo "==> Materializando o banco D1 local ..."
curl -s -o /dev/null -X POST "${app_url}/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"bootstrap@localhost","password":"bootstrap"}' || true
sleep 1

# O banco real do D1 é o arquivo com nome-hash; metadata.sqlite é interno do Miniflare.
db_file="$(find "${state_dir}" -name '*.sqlite' -path '*d1*' ! -name 'metadata.sqlite' | head -1)"
if [[ -z "${db_file}" ]]; then
  echo "Arquivo SQLite do D1 não encontrado em ${state_dir}" >&2
  exit 1
fi
echo "==> Banco: ${db_file}"

sqlite3 "${db_file}" "CREATE TABLE IF NOT EXISTS _hom_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"

applied=0
for f in $(ls "${migrations_dir}"/*.sql | sort); do
  name="$(basename "$f")"
  already="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM _hom_migrations WHERE name='${name}';")"
  if [[ "${already}" != "0" ]]; then
    continue
  fi
  echo "==> Aplicando ${name}"
  { echo "BEGIN;"; cat "$f"; echo ";"; echo "COMMIT;"; } | sqlite3 "${db_file}"
  sqlite3 "${db_file}" "INSERT INTO _hom_migrations (name) VALUES ('${name}');"
  applied=$((applied + 1))
done

seed_file="$(dirname "${BASH_SOURCE[0]}")/hom-seed.sql"
if [[ -f "${seed_file}" ]]; then
  seed_name="zzz_$(basename "${seed_file}")"
  already="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM _hom_migrations WHERE name='${seed_name}';")"
  if [[ "${already}" == "0" ]]; then
    echo "==> Aplicando seed de homologação (admin.hom@horsch.com.br)"
    { echo "BEGIN;"; cat "${seed_file}"; echo ";"; echo "COMMIT;"; } | sqlite3 "${db_file}"
    sqlite3 "${db_file}" "INSERT INTO _hom_migrations (name) VALUES ('${seed_name}');"
  fi
fi

echo "==> Concluído: ${applied} migração(ões) aplicada(s)."
sqlite3 "${db_file}" "SELECT 'Tabelas: ' || COUNT(*) FROM sqlite_master WHERE type='table';"
