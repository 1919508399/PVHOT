import json, paramiko
from collections import Counter

HOST = '47.250.92.231'; USER='root'; PASS='369287zjb@1998'
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)
sftp = ssh.open_sftp()
with sftp.open('/var/www/pvhot/data.json','r') as f:
    d = json.load(f)
sftp.close(); ssh.close()

items = d['items']
print('total:', len(items))
# 按北京时间 dateKey 分组
dk = Counter(it.get('dateKey','') for it in items)
print('--- 按 dateKey(北京时间) 分布（倒序）---')
for k,v in sorted(dk.items(), reverse=True)[:10]:
    print(f'  {k}: {v} 条')
print('  不同日期数:', len(dk))
# 翻译情况
translated = sum(1 for it in items if it.get('title_cn'))
print(f'\ntranslated(含title_cn): {translated}/{len(items)}')
# 分类分布
cat = Counter(it.get('category','') for it in items)
print('--- 分类分布 ---')
for k,v in cat.most_common():
    print(f'  {k}: {v}')
# 最近一天的具体标题抽样
latest = sorted(items, key=lambda x: x.get('pubDate',''), reverse=True)[:5]
print('\n--- 最新 5 条 ---')
for it in latest:
    print(f"  {it.get('pubDate','')} [{it.get('category','')}] {it.get('title_cn') or it.get('title','')[:40]}")
