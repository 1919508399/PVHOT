import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=15)

cmd = r"""python3 - <<'PYEOF'
import json
d = json.load(open('/var/www/pvhot/data.json'))
items = d['items']
print('=== reason 字段样本（应有实质内容，不再是模板）===')
for i in items[:6]:
    t = (i.get('title_cn') or i.get('title') or '')[:36]
    print(' ', i.get('pubTime','--:--'), '|', i.get('user',{}).get('name','-'), '|', t, '|')
    print('     reason:', i.get('reason','')[:120])
    print('     tags:  ', i.get('tags', []))
    print()
print('=== reason 长度分布 ===')
short = sum(1 for i in items if len(i.get('reason','')) < 30)
mid   = sum(1 for i in items if 30 <= len(i.get('reason','')) < 80)
long  = sum(1 for i in items if len(i.get('reason','')) >= 80)
print(f'  短<30: {short}  |  30-80: {mid}  |  ≥80: {long}  (总 {len(items)})')
print()
print('=== 旧模板检测（应该 0 条） ===')
old = sum(1 for i in items if '方向聚合' in i.get('reason',''))
print('  仍含"方向聚合"模板:', old)
PYEOF
"""

si, so, se = ssh.exec_command(cmd)
print(so.read().decode('utf-8', errors='ignore'))
ssh.close()
