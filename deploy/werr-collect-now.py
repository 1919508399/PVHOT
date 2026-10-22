import sys
import time

sys.path.insert(0, "/app")

import core.db as db
from jobs.mps import do_job

TARGETS = [
    "MP_WXS_2395007964",  # 北极星太阳能光伏网
    "MP_WXS_2393822661",  # 索比光伏网
    "MP_WXS_3096402184",  # 中国光伏行业协会CPIA
    "MP_WXS_3076412918",  # 光伏资讯
    "MP_WXS_3267200885",  # 光伏头条
    "MP_WXS_2390300250",  # 智汇光伏
]

allmps = {m.id: m for m in db.DB.get_all_mps()}
for i, mp_id in enumerate(TARGETS):
    mp = allmps.get(mp_id)
    if not mp:
        print("MISS", mp_id)
        continue
    if i:
        time.sleep(20)
    print("=====", mp.mp_name, mp_id)
    try:
        do_job(mp=mp)
    except Exception as exc:
        print("FAILED", mp.mp_name, repr(exc))
print("ALL DONE")
