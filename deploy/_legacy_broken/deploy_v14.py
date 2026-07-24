"""v14: 修 3 个问题
1) v2 fetch 脚本补写 data_fallback.js（fallback 不再滞后）
2) app.js fmtDay 日期重复修复
3) app.js 收藏图标统一（★/☆）+ 抽屉计数同步
"""
import paramiko, sys, time

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ROOT_LOCAL = r'C:\Users\HUASUN\Desktop\新闻'
REMOTE  = '/var/www/pvhot'
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)
sftp = ssh.open_sftp()

# 1) 上传 fetch_pv_news.js（v2 已修，追加写 fallback）
local_f = ROOT_LOCAL + r'\fetch_pv_news.js'
remote_f = REMOTE +
sftp.put(local_f, remote_f)
sftp.stat(remote_f)
print(f'[1/3] uploaded fetch_pv_news.js')

# 2) 上传 app.js
local_a = ROOT_LOCAL + r'\app.js'
remote_a = REMOTE +
sftp.put(local_a, remote_a)
print(f'[2/3] uploaded app.js')

sftp.close()

# 3) 立即跑一次 fetch 同步 data_fallback.js
print('[3/3] running fetch_pv_news.js to sync fallback...')
si, so, se = ssh.exec_command('cd ' + REMOTE + ' && /usr/bin/node fetch_pv_news.js')
t0 = time.time()
# 翻译 120 条要 30~60s
so.channel.settimeout(180)
out =
try:
    while True:
        chunk = so.read(4096)
        if not chunk:
            if time.time() - t0 > 180: break
            time.sleep(0.5)
            continue
        out += chunk.decode('utf-8', errors='ignore')
        if 'OK wrote' in out and 'wrote fallback' in out:
            break
except Exception as e:
    print('read err', e)
print('--- fetch stdout ---')
print(out[-2500:])

# 4) 验证 data_fallback.js 时间 + 大小
si, so, se = ssh.exec_command(f'ls -la {REMOTE}/data.json {REMOTE}/data_fallback.js {REMOTE}/app.js && echo --- && head -c 200 {REMOTE}/data_fallback.js')
print('--- ls + fallback head ---')
print(so.read().decode('utf-8', errors='ignore'))

# 5) 验证 HTTP
si, so, se = ssh.exec_command('curl -sI http://127.0.0.1/ | head -3 && echo --- && curl -sI http://127.0.0.1/data.json | head -3 && echo --- && curl -sI http://127.0.0.1/data_fallback.js | head -3')
print('--- HTTP check ---')
print(so.read().decode('utf-8', errors='ignore'))

ssh.close()
print('\n✅ v14 部署完成')
