#!/usr/bin/env python3
"""Redeploy fetch_pv_news.js with batch+timeout fix and run fetch + merge"""
import paramiko
import sys

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
LOCAL_FILE = r'C:\Users\HUASUN\Desktop\新闻\fetch_pv_news.js'
REMOTE_FILE =
def main():
    print('=== Redeploy fetch_pv_news.js (batch + timeout fix) ===')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=30)
    print('[OK] SSH connected')

    # 1. Upload fixed file
    sftp = ssh.open_sftp()
    sftp.put(LOCAL_FILE, REMOTE_FILE)
    size = sftp.stat(REMOTE_FILE).st_size
    print(f'[OK] Uploaded fetch_pv_news.js ({size} bytes)')

    # Verify fixes
    stdin, stdout, stderr = ssh.exec_command(
        'grep -n "batchFetch\\|reqTimeout\\|70000" ' + REMOTE_FILE
    )
    for line in stdout.read().decode().strip().split('\n'):
        print(f'  {line}')
    sftp.close()

    # 2. Run fetch_pv_news.js (timeout 10 min for batched 24 routes)
    print('\n=== Running fetch_pv_news.js (batched, 4 per batch, ~5-8 min) ===')
    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node fetch_pv_news.js 2>&1',
        timeout=600
    )
    stdout.channel.settimeout(600)

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

    # Show key lines from output
    lines = output.split('\n')
    print('--- Key output lines ---')
    for line in lines:
        if any(kw in line for kw in ['START', 'sources:', 'fresh(', 'lang:', 'aggregate:', 'OK wrote', 'WARN', 'ERROR', 'error']):
            print(f'  {line}')

    # Show fetchURL errors count
    fetch_errors = [l for l in lines if 'fetchURL error' in l]
    if fetch_errors:
        print(f'\n--- fetchURL errors ({len(fetch_errors)} total) ---')
        for e in fetch_errors[:10]:
            print(f'  {e.strip()}')
        if len(fetch_errors) > 10:
            print(f'  ... and {len(fetch_errors) - 10} more')

    if 'OK wrote' in output:
        print('\n[OK] fetch_pv_news.js completed successfully!')
    elif 'ReferenceError' in output:
        print('\n[ERROR] ReferenceError still present!')
        sys.exit(1)
    else:
        print('\n[WARN] Could not confirm success')

    # 3. Run merge.js
    print('\n=== Running merge.js ===')
    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node merge.js 2>&1',
        timeout=60
    )
    merge_out = stdout.read().decode()
    print(merge_out.strip())

    # 4. Verify wechat sources
    print('\n=== Verifying wechat sources ===')
    verify_script = r"""
const d = require('./data_raw.json');
const items = d.items || d;
console.log('Total items:', items.length);
const sources = {};
items.forEach(it => { const s = it.source || 'unknown'; sources[s] = (sources[s] || 0) + 1; });
const wcNames = ['光伏們','光伏头条','索比光伏网','PV-Tech','光伏资讯','风芒能源','储能与电力市场','北极星分布式光伏','光伏见闻','天合跟踪','天合光能系统解决方案','天合光能产品中心','中关村储能产业技术联盟','电能革新','维科网光伏','东吴光伏圈','ACMI硅基新材料','昱能科技','隆基氢能','阳光电源','国际能源网','微博搜索','微信搜索光伏'];
const wc = items.filter(it => wcNames.includes(it.source));
console.log('Wechat/RSSHub source items:', wc.length);
if (wc.length > 0) {
    console.log('\nWechat source breakdown:');
    const wcSrc = {};
    wc.forEach(it => { wcSrc[it.source] = (wcSrc[it.source] || 0) + 1; });
    Object.entries(wcSrc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + v + ' x ' + k));
    console.log('\nSample wechat items:');
    wc.slice(0, 10).forEach(it => console.log('  - [' + it.source + '] ' + (it.title || '').slice(0, 70)));
} else {
    console.log('NO wechat sources found!');
}
console.log('\nAll sources breakdown (top 15):');
Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log('  ' + v + ' x ' + k));
"""
    sftp = ssh.open_sftp()
    with sftp.file('/var/www/pvhot/_verify2.js', 'w') as f:
        f.write(verify_script)
    sftp.close()

    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node _verify2.js 2>&1',
        timeout=30
    )
    print(stdout.read().decode())

    # 5. Verify data.json
    print('=== Verifying data.json ===')
    verify_script2 = r"""
const d = require('./data.json');
const items = d.items || d;
console.log('data.json total:', items.length);
const wcNames = ['光伏們','光伏头条','索比光伏网','PV-Tech','光伏资讯','风芒能源','储能与电力市场','北极星分布式光伏','光伏见闻','天合跟踪','天合光能系统解决方案','天合光能产品中心','中关村储能产业技术联盟','电能革新','维科网光伏','东吴光伏圈','ACMI硅基新材料','昱能科技','隆基氢能','阳光电源','国际能源网','微博搜索','微信搜索光伏'];
const wc = items.filter(it => wcNames.includes(it.source));
console.log('Wechat items in data.json:', wc.length);
if (wc.length > 0) {
    wc.slice(0, 5).forEach(it => console.log('  - [' + it.source + '] ' + (it.title || '').slice(0, 70)));
}
"""
    sftp = ssh.open_sftp()
    with sftp.file('/var/www/pvhot/_verify3.js', 'w') as f:
        f.write(verify_script2)
    sftp.close()

    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node _verify3.js 2>&1',
        timeout=30
    )
    print(stdout.read().decode())

    # Cleanup
    ssh.exec_command('rm -f /var/www/pvhot/_verify2.js /var/www/pvhot/_verify3.js')
    ssh.close()
    print('=== Done ===')

if __name__ == '__main__':
    main()
