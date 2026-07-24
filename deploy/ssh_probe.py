import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=15)

cmds = [
    'cat /var/www/pvhot/fetch.log',
    'echo ---DATA_HEAD---',
    'head -80 /var/www/pvhot/data.json',
    'echo ---PY_PARSE---',
    "python3 -c \"import json; d=json.load(open('/var/www/pvhot/data.json')); items=d.get('items',[]); print('total:',len(items)); print('meta.date:',d['meta']['date']); print('meta.updated:',d['meta'].get('updated','')); [print(i.get('pubDate','')[:16], '|', i.get('title','')[:50], '|', i.get('source',''), '|', 'orig:'+(i.get('orig_title','')[:20] or '-')) for i in items[:8]]\"",
    'echo ---CACHE---',
    "head -c 500 /var/www/pvhot/translate_cache.json",
]
for c in cmds:
    print('==='*8, c[:60])
    si, so, se = ssh.exec_command(c)
    out = so.read().decode('utf-8', errors='ignore')
    err = se.read().decode('utf-8', errors='ignore')
    print(out[:5000])
    if err.strip(): print('STDERR:', err[:500])
ssh.close()
