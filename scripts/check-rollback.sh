#!/usr/bin/env bash
# READ-ONLY rollback drill helper.
#
# HARD RULE: 唔准執行 `railway redeploy`，除非車主在場。
# This script never deploys, pushes, logs in, or connects to PostgreSQL.
set -euo pipefail

SERVICE="${RAILWAY_SERVICE:-kindcipe-backend}"
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"

if [[ "${1:-}" == "--redeploy" ]]; then
  echo "REFUSED: 唔准由 script 執行 railway redeploy；請車主在場手動處理。" >&2
  exit 1
fi

echo "=== Kindcipe rollback check (READ-ONLY) ==="
echo "service=${SERVICE} environment=${ENVIRONMENT}"
echo "HARD RULE: 唔准執行 railway redeploy，除非車主在場。"
echo

if ! command -v railway >/dev/null 2>&1; then
  echo "railway CLI 未安裝 → 需要車主手動跑 railway login，之後再查 deployment list。" >&2
elif ! railway whoami >/dev/null 2>&1; then
  echo "railway CLI 未登入 → 需要車主手動跑 railway login；script 唔會自行 login。" >&2
else
  if DEPLOY_JSON="$(railway deployment list -s "$SERVICE" -e "$ENVIRONMENT" --limit 10 --json 2>/dev/null)"; then
    printf '%s' "$DEPLOY_JSON" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
if not isinstance(rows, list):
    rows = rows.get("deployments", [])
if not rows:
    print("查唔到 deployment。")
    raise SystemExit(0)
def show(label, row):
    meta = row.get("meta") or {}
    print(label + ": id=" + str(row.get("id")) + " status=" + str(row.get("status")) + " created=" + str(row.get("createdAt")) + " commit=" + str(meta.get("commitHash")))

current = rows[0]
show("CURRENT", current)
current_commit = (current.get("meta") or {}).get("commitHash")
previous = next((r for r in rows[1:] if ((r.get("meta") or {}).get("commitHash") != current_commit)), None)
if previous is None and len(rows) > 1:
    previous = rows[1]
if previous is not None:
    show("PREVIOUS", previous)
else:
    print("PREVIOUS: none")
'
  else
    echo "查唔到 deployment list（Railway CLI 未 link / 權限不足）→ 需要車主手動跑 railway status + railway deployment list。" >&2
  fi
fi

cat <<'SQL'

=== Additive DB objects to verify after code rollback ===
-- 用 read-only 連線執行；唔好喺 production 做 write。
-- export PGURL="postgresql://..."

-- 0048/0049: meal state table / turn state columns
psql "$PGURL" -c "select to_regclass('public.ai_chef_meal_state') as meal_state_table;"
psql "$PGURL" -c "select column_name from information_schema.columns where table_name='ai_chef_meal_state' order by ordinal_position;"

-- 0050: user-declared scenario tags (both recipe tables)
psql "$PGURL" -c "select table_name, column_name from information_schema.columns where column_name='scenario_tags_user' and table_name in ('official_recipes','custom_recipes') order by table_name;"

-- 0051: legacy AI credits on families
psql "$PGURL" -c "select column_name, data_type, is_nullable from information_schema.columns where table_name='families' and column_name='legacy_ai_credits';"

-- 0052: family allergen safety table + allergens column
psql "$PGURL" -c "select to_regclass('public.ai_chef_family_safety') as allergen_table;"
psql "$PGURL" -c "select column_name, data_type, is_nullable from information_schema.columns where table_name='ai_chef_family_safety' order by ordinal_position;"

-- Expected: all objects exist after code rollback; code rollback does NOT drop them.
SQL

echo
echo "手動 rollback（只可由車主在場執行，script 唔會代跑）:"
echo "  railway redeploy -y <PREVIOUS_DEPLOYMENT_ID>"
echo "DB rollback 需要停 service + restore backup；additive columns 本身可以保留。"
