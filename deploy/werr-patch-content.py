"""Fill missing WeChat article bodies via the WeRead /web/mp/content endpoint.

The list endpoint of WeRead only exposes the newest article per feed, so bodies
are fetched separately for every article that landed without one.
Run inside the pvhot-werrs container:
    docker exec -i -w /app pvhot-werrs /app/env_x86_64/bin/python3 - 30 < patch-content.py
"""
import sqlite3
import sys
import time

sys.path.insert(0, "/app")

from core.wx.model.weread_mp import MpsWereadMP, WereadMPAPIError  # noqa: E402
from tools.fix import fix_html  # noqa: E402

DB = "/app/data/db.db"
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 30

conn = sqlite3.connect(DB, timeout=30)
rows = conn.execute(
    """SELECT id, mp_id, url FROM articles
       WHERE mp_id LIKE 'MP_WXS_%'
         AND (has_content = 0 OR length(coalesce(content, '')) < 200)
       ORDER BY publish_time DESC LIMIT ?""",
    (LIMIT,),
).fetchall()
print("pending", len(rows))
if not rows:
    sys.exit(0)

wx = MpsWereadMP()
wx._load_weread_auth()

ok = fail = 0
for aid, mp_id, url in rows:
    short = (url or "").rsplit("/s/", 1)[-1].split("?")[0]
    if not short:
        fail += 1
        continue
    review_id = f"{mp_id}_{short}"
    try:
        html = wx._get_mp_content(review_id)
    except WereadMPAPIError as exc:
        print("skip", str(aid)[:34], exc)
        fail += 1
        continue
    except Exception as exc:  # noqa: BLE001
        print("err", str(aid)[:34], repr(exc))
        fail += 1
        continue
    if not html or len(html) < 100:
        print("empty", str(aid)[:34])
        fail += 1
        continue
    try:
        conn.execute(
            "UPDATE articles SET content = ?, content_html = ?, has_content = 1 WHERE id = ?",
            (html, fix_html(html), aid),
        )
        conn.commit()
        ok += 1
        print("ok", str(aid)[:40], len(html))
    except Exception as exc:  # noqa: BLE001
        print("db err", str(aid)[:34], repr(exc))
        fail += 1
    time.sleep(2)

print(f"done ok={ok} fail={fail}")
