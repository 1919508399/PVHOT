import json
from collections import Counter

with open('C:/Users/HUASUN/Desktop/新闻/data.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

# 模拟前端 fmtDay：key = iso.slice(0,10)，md 用本地时区 getMonth/getDate
# 北京时间 GMT+8，pubDate 是 UTC ISO
def fmtday(iso):
    from datetime import datetime, timedelta, timezone
    # 浏览器 new Date(iso) -> 本地时间
    dt = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=8)))
    md = f'{dt.month}月{dt.day}日'
    key = iso[:10]   # ← 与前端完全一致
    return md, key

groups = {}
for it in d['items']:
    md, k = fmtday(it.get('pubDate', ''))
    groups.setdefault(k, []).append((md, it.get('pubTime',''), it.get('title','')[:30]))

print('=== 按 fmtDay().key 分组（key = iso.slice(0,10) UTC 日期）===')
for k in sorted(groups.keys(), reverse=True):
    md_set = set(x[0] for x in groups[k])
    print(f'  key={k}  count={len(groups[k])}  显示日期={md_set}')
    for md, t, title in groups[k][:2]:
        print(f'      {md} {t} {title}')

print()
print('=== 但如果 key 改用本地时区（修复时区偏差）===')
groups2 = {}
for it in d['items']:
    md, _ = fmtday(it.get('pubDate', ''))
    k2 = md  # 用显示日期作 key
    groups2.setdefault(k2, []).append((it.get('pubTime',''), it.get('title','')[:30]))
for k in sorted(groups2.keys(), reverse=True):
    print(f'  显示日期={k}  count={len(groups2[k])}')
