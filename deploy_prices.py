#!/usr/bin/env python3
"""
Deploy price fetch separation:
1. Upload fetch_prices.js (new standalone price fetcher)
2. Upload updated fetch_pv_news.js (removed price fetch, preserves existing prices)
3. Update cron: hourly news + daily 7am prices
4. Run fetch_prices.js immediately to update prices
5. Verify data.json has prices
"""
import paramiko, json, time

HOST = '47.250.92.231'
USER = 'root'
PASS = '369287zjb@1998'
LOCAL = r'C:\Users\HUASUN\Desktop\新闻'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)
sftp = ssh.open_sftp()

def run(cmd, label=''):
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(f'=== {label} ===')
    if out.strip(): print(out.strip())
    if err.strip(): print('STDERR:', err.strip()[:500])
    return out, err

# 1. Upload fetch_prices.js
print('[1/6] Uploading fetch_prices.js...')
sftp.put(f'{LOCAL}\\fetch_prices.js', '/var/www/pvhot/fetch_prices.js')
print('  OK')

# 2. Upload updated fetch_pv_news.js
print('[2/6] Uploading fetch_pv_news.js...')
sftp.put(f'{LOCAL}\\fetch_pv_news.js', '/var/www/pvhot/fetch_pv_news.js')
print('  OK')

# 3. Verify files uploaded
run('ls -la /var/www/pvhot/fetch_prices.js /var/www/pvhot/fetch_pv_news.js', 'verify files')

# 4. Update cron
# Old: 5 * * * * fetch_pv_news.js && merge.js
# New: 5 * * * * fetch_pv_news.js && merge.js  (hourly news, preserves prices)
#      0 7 * * * fetch_prices.js               (daily 7am prices, includes merge)
print('\n[4/6] Updating crontab...')
new_cron = (
    '5 * * * * /usr/bin/node /var/www/pvhot/fetch_pv_news.js && /usr/bin/node /var/www/pvhot/merge.js >> /var/www/pvhot/fetch.log 2>&1\n'
    '0 7 * * * /usr/bin/node /var/www/pvhot/fetch_prices.js >> /var/www/pvhot/fetch.log 2>&1\n'
)
# Write new crontab
stdin, stdout, stderr = ssh.exec_command(f'echo "{new_cron}" | crontab -')
out, err = stdout.read().decode(), stderr.read().decode()
if err: print('  ERR:', err)
run('crontab -l', 'new crontab')

# 5. Run fetch_prices.js immediately
print('\n[5/6] Running fetch_prices.js immediately...')
stdin, stdout, stderr = ssh.exec_command(
    'cd /var/www/pvhot && /usr/bin/node fetch_prices.js 2>&1',
    timeout=60
)
out = stdout.read().decode()
err = stderr.read().decode()
print(out)
if err: print('STDERR:', err[:500])

# 6. Verify data.json has prices
print('\n[6/6] Verifying prices in data.json...')
run('python3 -c "import json; d=json.load(open(\'/var/www/pvhot/data.json\')); p=d.get(\'prices\',{}); print(\'prices:\', \'YES\' if p else \'NO\'); print(\'pv groups:\', len(p.get(\'pv\',[]))); print(\'storage groups:\', len(p.get(\'storage\',[]))); print(\'pvDate:\', p.get(\'pvDate\',\'N/A\')); print(\'essDate:\', p.get(\'essDate\',\'N/A\'))"', 'verify prices')

# Also verify via /api/ping
run('curl -s https://pvhot.bbroot.com/api/ping', 'health check')

ssh.close()
print('\n[done] Deployment complete.')
