#!/usr/bin/env bash
# Usage: bash scripts/smoke_test.sh http://<ELASTIC_IP>
set -uo pipefail
BASE="${1:?Usage: smoke_test.sh http://host}"
fail=0
check() { if [ "$2" = "ok" ]; then echo "PASS  $1"; else echo "FAIL  $1  ($2)"; fail=1; fi; }

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
[ "$code" = "200" ] && check "dashboard page" ok || check "dashboard page" "HTTP $code"

body=$(curl -s "$BASE/api/schedule/latest")
rows=$(python3 -c 'import sys,json; d=json.load(sys.stdin); r=d if isinstance(d,list) else (d.get("rows") or d.get("schedule") or d.get("items") or []); print(len(r))' <<<"$body" 2>/dev/null || echo 0)
[ "$rows" = "24" ] && check "schedule has 24 rows" ok || check "schedule has 24 rows" "found $rows (no successful run yet?)"

header=$(curl -s "$BASE/api/schedule/latest.csv" | head -1)
case "$header" in datetime,mode_label,*) check "CSV header" ok;; *) check "CSV header" "$header";; esac

for p in kpis/latest forecast/latest settings occupancy runs; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/$p")
  [ "$c" = "200" ] && check "GET /api/$p" ok || check "GET /api/$p" "HTTP $c"
done

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/run")
case "$c" in 401|403|422) check "admin route rejects no key" ok;; *) check "admin route rejects no key" "HTTP $c";; esac
exit $fail
