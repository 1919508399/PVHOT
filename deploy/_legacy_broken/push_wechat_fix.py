#!/usr/bin/env python3
"""Deploy fixed fetch_pv_news.js (log error fixed) and run fetch + merge"""
import paramiko
import sys

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
LOCAL_FILE = r'C:\Users\HUASUN\Desktop\新闻\fetch_pv_news.js'
REMOTE_FILE =
def main():
    print('=== Deploy fixed fetch_pv_news.js ===')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=30)
    print('[OK] SSH connected')

    # 1. Upload fixed file
    sftp = ssh.open_sftp()
    sftp.put(LOCAL_FILE, REMOTE_FILE)
    try:
        size = sftp.stat(REMOTE_FILE).st_size
    except:
        size =
    print(f'[OK] Uploaded fetch_pv_news.js ({size} bytes)')

    # Verify the fix is in place
    stdin, stdout, stderr = ssh.exec_command('grep -n "console.error.*fetchURL" ' + REMOTE_FILE)
    line = stdout.read().decode().strip()
    if line:
        print(f'[OK] Fix verified: {line}')
    else:
        print('[WARN] Fix line not found! Checking for old log() reference...')
        stdin, stdout, stderr = ssh.exec_command('grep -n "log.*fetchURL error" ' + REMOTE_FILE)
        old_line = stdout.read().decode().strip()
        if old_line:
            print(f'[ERROR] Old buggy line still present: {old_line}')
            sys.exit(1)

    # Count routes
    stdin, stdout, stderr = ssh.exec_command('grep -c "freewechat/profile" ' + REMOTE_FILE)
    count = stdout.read().decode().strip()
    print(f'[OK] freewechat routes: {count}')

    sftp.close()

    # 2. Run fetch_pv_news.js (timeout 6 min since 24 routes may take a while)
    print('\n=== Running fetch_pv_news.js (may take 2-4 min for 24 routes) ===')
    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node fetch_pv_news.js 2>&1',
        timeout=360
    )
    stdout.channel.settimeout(360)

    output =
    try:
        output = stdout.read().decode()
    except Exception as e:
        print(f'[WARN] stdout read issue: {e}')
        try:
            output = stdout.read().decode()
        except:
            output =
    err_output = stderr.read().decode()

    print('--- fetch_pv_news.js output (last 3000 chars) ---')
    print(output[-3000:] if len(output) > 3000 else output)
    if err_output:
        print('--- stderr (last 2000 chars) ---')
        print(err_output[-2000:] if len(err_output) > 2000 else err_output)

    # Check for success indicators
    if 'OK wrote' in output:
        print('\n[OK] fetch_pv_news.js completed successfully!')
    elif 'log is not defined' in output or 'ReferenceError' in output:
        print('\n[ERROR] log is not defined error still present!')
        sys.exit(1)
    else:
        print('\n[WARN] Could not confirm success from output')

    # 3. Run merge.js
    print('\n=== Running merge.js ===')
    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node merge.js 2>&1',
        timeout=60
    )
    merge_out = stdout.read().decode()
    merge_err = stderr.read().decode()
    print('--- merge.js output ---')
    print(merge_out[-2000:] if len(merge_out) > 2000 else merge_out)
    if merge_err:
        print('--- merge stderr ---')
        print(merge_err[-1000:])

    # 4. Check data_raw.json for wechat sources using a script file
    print('\n=== Verifying wechat sources in data_raw.json ===')
    verify_script = r"""
const d = require('./data_raw.json');
const items = d.items || d;
console.log('Total items:', items.length);
const sources = {};
items.forEach(it => { const s = it.source || 'unknown'; sources[s] = (sources[s] || 0) + 1; });
Object.entries(sources).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(v, k));
console.log('---');
const wcNames = ['光伏們','光伏头条','索比光伏网','PV-Tech','光伏资讯','风芒能源','储能与电力市场','北极星分布式光伏','光伏见闻','天合跟踪','天合光能系统解决方案','天合光能产品中心','中关村储能产业技术联盟','电能革新','维科网光伏','东吴光伏圈','ACMI硅基新材料','昱能科技','隆基氢能','阳光电源','国际能源网','微博搜索','微信搜索光伏'];
const wc = items.filter(it => wcNames.includes(it.source));
console.log('Wechat/RSSHub source items:', wc.length);
if (wc.length > 0) {
    console.log('Sample wechat items:');
    wc.slice(0, 8).forEach(it => console.log('  -', it.source, '|', (it.title || '').slice(0, 60)));
}
"""
    # Write verify script to server
    sftp = ssh.open_sftp()
    with sftp.file('/var/www/pvhot/_verify_sources.js', 'w') as f:
        f.write(verify_script)
    sftp.close()

    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node _verify_sources.js 2>&1',
        timeout=30
    )
    verify_out = stdout.read().decode()
    print(verify_out)

    # 5. Check data.json
    print('=== Verifying data.json ===')
    verify_script2 = r"""
const d = require('./data.json');
const items = d.items || d;
console.log('data.json total items:', items.length);
const wcNames = ['光伏們','光伏头条','索比光伏网','PV-Tech','光伏资讯','风芒能源','储能与电力市场','北极星分布式光伏','光伏见闻','天合跟踪','天合光能系统解决方案','天合光能产品中心','中关村储能产业技术联盟','电能革新','维科网光伏','东吴光伏圈','ACMI硅基新材料','昱能科技','隆基氢能','阳光电源','国际能源网','微博搜索','微信搜索光伏'];
const wc = items.filter(it => wcNames.includes(it.source));
console.log('Wechat source items in data.json:', wc.length);
if (wc.length > 0) {
    console.log('Sample wechat titles:');
    wc.slice(0, 8).forEach(it => console.log('  -', it.source, '|', (it.title || '').slice(0, 60)));
}
"""
    sftp = ssh.open_sftp()
    with sftp.file('/var/www/pvhot/_verify_data.js', 'w') as f:
        f.write(verify_script2)
    sftp.close()

    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node _verify_data.js 2>&1',
        timeout=30
    )
    data_out = stdout.read().decode()
    print(data_out)

    # Cleanup verify scripts
    ssh.exec_command('rm -f /var/www/pvhot/_verify_sources.js /var/www/pvhot/_verify_data.js')

    ssh.close()
    print('\n=== Deploy complete ===')

if __name__ == '__main__':
    main()
