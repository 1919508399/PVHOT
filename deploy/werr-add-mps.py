"""Add WeChat public accounts to we-mp-rss: search each name, then subscribe to the exact match."""
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8001/api/v1/wx"
TOKEN = sys.argv[1]
NAMES = sys.argv[2:]


def call(path, method="GET", body=None, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


for name in NAMES:
    try:
        found = call("/mps/search/" + urllib.parse.quote(name))
        items = (found.get("data") or {}).get("list") or []
        if not items:
            print(f"[miss] {name}: no search result")
            continue
        hit = next((x for x in items if x.get("nickname") == name), items[0])
        body = {
            "mp_name": hit.get("nickname") or name,
            "mp_id": hit.get("fakeid") or "",
            "mp_cover": hit.get("round_head_img") or "",
            "avatar": hit.get("round_head_img") or "",
            "mp_intro": (hit.get("signature") or "")[:255],
        }
        res = call("/mps", method="POST", body=body)
        ok = res.get("code") == 0
        exact = "exact" if hit.get("nickname") == name else f"closest={hit.get('nickname')}"
        print(f"[{'ok' if ok else 'fail'}] {name} -> {body['mp_id']} ({exact}) {res.get('message','')}")
    except Exception as e:  # noqa: BLE001 - one account must not stop the batch
        print(f"[error] {name}: {e}")
