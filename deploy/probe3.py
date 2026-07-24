import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=15)

# 1) 搜截图里 5 条英文标题是否在 data.json
needle_titles = [
    "NLC India",
    "UPERC",
    "MERC Approves Provisional",
    "Gautam Solar",
    "Adani Electricity",
]
cmd = r"""python3 - <<'PYEOF'
import json
d = json.load(open('/var/www/pvhot/data.json'))
items = d.get('items', [])
print('=== search screenshot titles in current data.json ===')
for needle in ["NLC India","UPERC","MERC Approves Provisional","Gautam Solar","Adani Electricity"]:
    matches = [i for i in items if needle.lower() in (i.get('title','')+i.get('title_cn','')).lower()]
    print(f'  {needle}: {len(matches)} matches')
    for m in matches[:2]:
        print('   ', m.get('pubDate','')[:16], '|', m.get('title','')[:60])
        print('   T_CN:', m.get('title_cn','')[:60])
print()
print('=== items where title is ASCII-ish (likely EN) ===')
en_count = 0
for i in items:
    t = i.get('title','')
    cn_chars = sum(1 for c in t if '一' <= c <= '鿿')
    if cn_chars < 5 and t:
        en_count += 1
        if en_count <= 8:
            print('  ', i.get('pubDate','')[:16], '|', t[:60], '|', i.get('source',''), '| T_CN:', i.get('title_cn','')[:40])
print(f'  TOTAL ENGLISH titles: {en_count}/{len(items)}')
print()
print('=== items where title_cn is ASCII-ish but title is not (翻译反过来) ===')
weird = 0
for i in items:
    tcn = i.get('title_cn','')
    cn_chars = sum(1 for c in tcn if '一' <= c <= '鿿')
    if tcn and cn_chars < 5:
        weird += 1
        if weird <= 5:
            print('  ', i.get('pubDate','')[:16], '|', tcn[:60])
print(f'  TOTAL where title_cn looks EN: {weird}')
print()
print('=== check fmtDay duplicate bug in app.js ===')
PYEOF
"""
si, so, se = ssh.exec_command(cmd)
print(so.read().decode('utf-8', errors='ignore'))
err = se.read().decode('utf-8', errors='ignore')
if err: print('STDERR:', err[:500])

# 2) 看服务器 fetch_pv_news.js 头部
print('=== /var/www/pvhot/fetch_pv_news.js (first 80 lines) ===')
si, so, se = ssh.exec_command('head -80 /var/www/pvhot/fetch_pv_news.js')
print(so.read().decode('utf-8', errors='ignore'))
err = se.read().decode('utf-8', errors='ignore')
if err: print('STDERR:', err[:500])

ssh.close()
