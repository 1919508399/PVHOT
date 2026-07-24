import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=15)

cmds = [
    'curl -sI http://127.0.0.1/data.json | head -10',
    'echo ---SIZE---',
    'ls -la /var/www/pvhot/data.json /var/www/pvhot/data_fallback.js',
    'echo ---FALLBACK_HEAD---',
    'head -3 /var/www/pvhot/data_fallback.js | head -c 500',
    'echo',
    'echo ---FALLBACK_STATS---',
    "python3 -c \"import re, sys; s=open('/var/www/pvhot/data_fallback.js').read(); m=re.search(r'__PV_FALLBACK_DATA = (\\{.*\\})', s, re.S); import json; d=json.loads(m.group(1)); items=d.get('items',[]); print('fallback items:', len(items)); print('date:', d['meta']['date']); [print(' ', i.get('pubDate','')[:16], '|', i.get('title','')[:50]) for i in items[:6]]\"",
    'echo ---V2_SCRIPT_TAIL---',
    'tail -100 /var/www/pvhot/fetch_pv_news.js',
    'echo ---V2_WRITE_FUNCS---',
    "grep -n 'writeFile\\|data_fallback\\|writeOut\\|JSON.stringify' /var/www/pvhot/fetch_pv_news.js",
]
for c in cmds:
    print('==='*8, c[:60])
    si, so, se = ssh.exec_command(c)
    out = so.read().decode('utf-8', errors='ignore')
    err = se.read().decode('utf-8', errors='ignore')
    print(out[:4000])
    if err.strip(): print('STDERR:', err[:500])
ssh.close()
