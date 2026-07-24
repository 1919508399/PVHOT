import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=15)

cmd = r"""python3 - <<'PYEOF'
import json
from collections import Counter
d = json.load(open('/var/www/pvhot/data.json'))
items = d.get('items', [])
print('=== meta ===')
print('  date:', d['meta']['date'])
print('  updated:', d['meta'].get('updated',''))
print('  items:', len(items))
print()
print('=== top 10 by heat (current data.json) ===')
for i in sorted(items, key=lambda x: -x.get('heat', 0))[:10]:
    print(' ', i.get('pubDate','')[:16], '|', (i.get('title_cn','') or i.get('title',''))[:50].ljust(50), '|', i.get('source',''))
print()
print('=== day distribution ===')
ds = Counter(i.get('dateKey', i.get('pubDate','')[:10]) for i in items)
for k, v in ds.most_common(): print(' ', k, v)
print()
print('=== sample (first 3, full) ===')
for i in items[:3]:
    print('  TITLE :', i.get('title','')[:80])
    print('  T_CN  :', i.get('title_cn','')[:80])
    print('  SUMM  :', (i.get('summary','') or '')[:80])
    print('  SUMCN :', (i.get('summary_cn','') or '')[:80])
    print('  LANG  :', i.get('lang',''))
    print()
PYEOF
"""
si, so, se = ssh.exec_command(cmd)
print(so.read().decode('utf-8', errors='ignore'))
err = se.read().decode('utf-8', errors='ignore')
if err: print('STDERR:', err[:500])
ssh.close()
