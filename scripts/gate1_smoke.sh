#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8787}"
USER_TOKEN="${USER_TOKEN:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

if [[ -z "$USER_TOKEN" ]]; then
  echo "USER_TOKEN is required"
  exit 1
fi

auth_header=("Authorization: Bearer $USER_TOKEN")
admin_header=("Authorization: Bearer $ADMIN_TOKEN")

json() {
  jq -r '.'
}

echo "[1] accept terms"
curl -sS -X POST "$API_BASE/api/creator/terms/accept" \
  -H "${auth_header[0]}" \
  -H "Content-Type: application/json" \
  -d '{}' | json

echo "[2] create series"
create_res=$(curl -sS -X POST "$API_BASE/api/creator/series" \
  -H "${auth_header[0]}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Lure Starter","description":"Starter pack","purchase_url":"https://example.com/pay"}')
echo "$create_res" | json
series_id=$(echo "$create_res" | jq -r '.id')
slug=$(echo "$create_res" | jq -r '.slug')

echo "[3] add prize"
curl -sS -X POST "$API_BASE/api/creator/series/$series_id/prizes" \
  -H "${auth_header[0]}" \
  -H "Content-Type: application/json" \
  -d '{"name":"Lure A","image_url":"","stock":2,"weight":1,"is_active":true}' | json

echo "[4] publish"
curl -sS -X PATCH "$API_BASE/api/creator/series/$series_id" \
  -H "${auth_header[0]}" \
  -H "Content-Type: application/json" \
  -d '{"status":"published"}' | json

echo "[5] public get"
curl -sS "$API_BASE/api/public/series/$slug" | json

echo "[6] spin"
curl -sS -X POST "$API_BASE/api/public/series/$slug/spin" | json

if [[ -n "$ADMIN_TOKEN" ]]; then
  echo "[7] suspend"
  curl -sS -X POST "$API_BASE/api/admin/series/$series_id/suspend" \
    -H "${admin_header[0]}" | json

  echo "[8] public get after suspend (should be 404)"
  http_code=$(curl -sS -o /tmp/gate1_public_after_suspend.json -w '%{http_code}' "$API_BASE/api/public/series/$slug")
  echo "status=$http_code body=$(cat /tmp/gate1_public_after_suspend.json)"
fi
