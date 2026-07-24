#!/usr/bin/env python3
"""E2E verification: check API, data.json source names, and nginx"""
import paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=30)

    # 1. Check API endpoint (nginx push rule)
    print('=== API endpoint check ===')
    stdin, stdout, stderr = ssh.exec_command(
        'curl -s -o /dev/null -w "%{http_code}" https://pvhot.bbroot.com/api/ping 2>&1'
    )
    code = stdout.read().decode().strip()
    print(f'GET /api/ping: HTTP {code}')
    if code == '200':
        print('[OK] API endpoint working!')
    else:
        print(f'[WARN] API returned {code}')

    # 2. Check data.json source names directly
    print('\n=== data.json source names ===')
    check_script = r"""
const d = require('./data.json');
const items = d.items || d;
console.log('Total items:', items.length);
const wcNames = ['光伏們','光伏头条','索比光伏网','PV-Tech','光伏资讯','风芒能源','储能与电力市场','北极星分布式光伏','光伏见闻','天合跟踪','天合光能系统解决方案','天合光能产品中心','中关村储能产业技术联盟','电能革新','维科网光伏','东吴光伏圈','ACMI硅基新材料','昱能科技','隆基氢能','阳光电源','国际能源网','微博搜索','微信搜索光伏'];
const wc = items.filter(it => wcNames.includes(it.source));
console.log('Wechat items:', wc.length);
console.log('\nSample items (source | title | link):');
items.slice(0, 10).forEach(it => {
    console.log('  [' + it.source + '] ' + (it.title || '').slice(0, 50) + ' | ' + (it.link || '').slice(0, 60));
});
console.log('\nWechat items sample:');
wc.slice(0, 5).forEach(it => {
    console.log('  [' + it.source + '] ' + (it.title || '').slice(0, 50));
    console.log('    link: ' + (it.link || '').slice(0, 80));
    console.log('    summary: ' + (it.summary || '').slice(0, 80));
});
"""
    sftp = ssh.open_sftp()
    with sftp.file('/var/www/pvhot/_e2e_check.js', 'w') as f:
        f.write(check_script)
    sftp.close()

    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node _e2e_check.js 2>&1',
        timeout=30
    )
    print(stdout.read().decode())

    # 3. Check that cron is still set correctly
    print('=== Cron check ===')
    stdin, stdout, stderr = ssh.exec_command('crontab -l 2>&1 | grep pvhot')
    print(stdout.read().decode())

    # 4. Check fetch.log tail
    print('=== fetch.log tail ===')
    stdin, stdout, stderr = ssh.exec_command('tail -10 /var/www/pvhot/fetch.log 2>&1')
    print(stdout.read().decode())

    # Cleanup
    ssh.exec_command('rm -f /var/www/pvhot/_e2e_check.js')
    ssh.close()
    print('=== E2E verification complete ===')

if __name__ == '__main__':
    main()
