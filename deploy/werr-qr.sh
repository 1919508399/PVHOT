#!/bin/bash
# Reset the we-mp-rss admin password to a known value, log in, and fetch the WeChat login QR image.
set -e
PASS="$1"
OUT="${2:-/tmp/werr-qr.png}"

sudo docker exec pvhot-werrs /app/env_x86_64/bin/python3 - "$PASS" <<'PY'
import sys, sqlite3, bcrypt
pw = sys.argv[1].encode()
h = bcrypt.hashpw(pw, bcrypt.gensalt()).decode()
c = sqlite3.connect('/app/data/db.db')
cur = c.execute("UPDATE users SET password_hash=? WHERE username='pvhot'", (h,))
if cur.rowcount == 0:
    print("no pvhot user updated")
else:
    print("password updated for pvhot")
c.commit()
PY

TOKEN=$(curl -s -m 20 -X POST http://127.0.0.1:8001/api/v1/wx/auth/login \
  -d "username=pvhot&password=$PASS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('access_token') or d.get('token') or '')")

if [ -z "$TOKEN" ]; then echo "LOGIN FAILED"; exit 1; fi
echo "login ok"

echo "--- qr/code ---"
curl -s -m 30 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8001/api/v1/wx/auth/qr/code | head -c 800
echo
echo "--- qr/image ---"
curl -s -m 40 -H "Authorization: Bearer $TOKEN" -o "$OUT" -w "http=%{http_code} type=%{content_type} size=%{size_download}\n" \
  http://127.0.0.1:8001/api/v1/wx/auth/qr/image
echo "--- status ---"
curl -s -m 20 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8001/api/v1/wx/auth/qr/status | head -c 400
echo
echo "$TOKEN" > /tmp/werr-token
