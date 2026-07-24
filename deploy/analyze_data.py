import json
from collections import Counter

with open(r'C:\Users\HUASUN\Desktop\新闻\data.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

items = d.get('items', [])
print('total items:', len(items))
print('---dates count---')
dates = Counter(it.get('date', '') for it in items)
for k, v in sorted(dates.items(), reverse=True):
    print(f'  {k}: {v}')
print('---top sources---')
src = Counter(it.get('source', '') for it in items)
for k, v in src.most_common(20):
    print(f'  {k}: {v}')
print('---first items of each date (top 3)---')
byd = {}
for it in items:
    byd.setdefault(it.get('date', ''), []).append((it.get('time', ''), it.get('title', '')[:50]))
for k in sorted(byd.keys(), reverse=True)[:8]:
    print(f'  {k}:')
    for t, title in byd[k][:3]:
        print(f'    {t}  {title}')
print('---unique titles (no dups?)---')
titles = [it.get('title','') for it in items]
print('  total:', len(titles), 'unique:', len(set(titles)))
print('---unique links---')
links = [it.get('link','') for it in items]
print('  total:', len(links), 'unique:', len(set(links)))
