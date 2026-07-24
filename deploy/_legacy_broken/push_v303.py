#!/usr/bin/env python3
"""v3.0.3 deploy: fix freewechat history filter, shorten summaries, fix tags"""
import paramiko
import sys

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
LOCAL_FETCH = r'C:\Users\HUASUN\Desktop\新闻\fetch_pv_news.js'
LOCAL_APP = r'C:\Users\HUASUN\Desktop\新闻\app.js'
REMOTE_FETCH =
REMOTE_APP =
def main():
    print('=== v3.0.3 Deploy: history filter + summary trim + tag fix ===')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=30)
    print('[OK] SSH connected')

    # 1. Upload files
    sftp = ssh.open_sftp()
    sftp.put(LOCAL_FETCH, REMOTE_FETCH)
    fsize = sftp.stat(REMOTE_FETCH).st_size
    print(f'[OK] Uploaded fetch_pv_news.js ({fsize} bytes)')
    sftp.put(LOCAL_APP, REMOTE_APP)
    asize = sftp.stat(REMOTE_APP).st_size
    print(f'[OK] Uploaded app.js ({asize} bytes)')

    # Verify key changes
    stdin, stdout, stderr = ssh.exec_command(
        'grep -n "STOP_CHARS\\|STOP_WORDS\\|triCnt\\|v3.0.3" ' + REMOTE_FETCH
    )
    print('\n--- fetch_pv_news.js key changes ---')
    for line in stdout.read().decode().strip().split('\n'):
        print(f'  {line}')

    stdin, stdout, stderr = ssh.exec_command(
        'grep -n "v3.0.3\\|80\\|YYYY" ' + REMOTE_APP +
    )
    print('\n--- app.js key changes ---')
    for line in stdout.read().decode().strip().split('\n'):
        print(f'  {line}')
    sftp.close()

    # 2. Run fetch_pv_news.js
    print('\n=== Running fetch_pv_news.js (batched, ~5-8 min) ===')
    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node fetch_pv_news.js 2>&1',
        timeout=600
    )
    stdout.channel.settimeout(600)
    output =
    try:
        output = stdout.read().decode()
    except Exception as e:
        print(f'[WARN] stdout read: {e}')
        try:
            output = stdout.read().decode()
        except:
            output =
    lines = output.split('\n')
    print('--- Key output lines ---')
    for line in lines:
        if any(kw in line for kw in ['START', 'sources:', 'fresh(', 'lang:', 'aggregate:', 'OK wrote', 'WARN', 'ERROR', 'error', 'rsshub=']):
            print(f'  {line}')

    fetch_errors = [l for l in lines if 'fetchURL error' in l]
    if fetch_errors:
        print(f'\n--- fetchURL errors ({len(fetch_errors)} total, showing first 5) ---')
        for e in fetch_errors[:5]:
            print(f'  {e.strip()}')

    if 'OK wrote' in output:
        print('\n[OK] fetch_pv_news.js completed!')
    elif 'ReferenceError' in output or 'TypeError' in output:
        print('\n[ERROR] Script error!')
        print(output[-500:])
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
    print(merge_out.strip()[:500])

    # 4. Verify data.json - check summaries, tags, sources
    print('\n=== Verifying data.json ===')
    verify_script = r"""
const d = require('./data.json');
const items = d.items || d;
console.log('Total items:', items.length);

// Check for [YYYY-MM-DD] prefix in summaries
const datePrefix = items.filter(it => (it.summary || '').match(/^\[\d{4}-\d{2}-\d{2}\]/));
console.log('Items with [YYYY-MM-DD] prefix:', datePrefix.length);

// Check summary lengths
const sumLens = items.map(it => (it.summary || '').length);
const maxLen = Math.max(...sumLens);
const avgLen = Math.round(sumLens.reduce((a,b) => a+b, 0) / sumLens.length);
const over80 = sumLens.filter(l => l > 80).length;
console.log('Summary max length:', maxLen);
console.log('Summary avg length:', avgLen);
console.log('Summaries over 80 chars:', over80);

// Check tags for nonsense
const allTags = new Set();
items.forEach(it => (it.tags || []).forEach(t => allTags.add(t)));
console.log('Unique tags:', allTags.size);
const badTags = [...allTags].filter(t => t.length === 2 && /^(设|者|建|的|了|在|是|有|和|与|或|也|但|就|都|还)/.test(t));
console.log('Potentially bad tags:', badTags.join(', ') || 'none');
console.log('Sample tags:', [...allTags].slice(0, 15).join(', '));

// Check wechat sources
const wcNames = ['光伏們','光伏头条','索比光伏网','PV-Tech','光伏资讯','风芒能源','储能与电力市场','北极星分布式光伏','光伏见闻','天合跟踪','天合光能系统解决方案','天合光能产品中心','中关村储能产业技术联盟','电能革新','维科网光伏','东吴光伏圈','ACMI硅基新材料','昱能科技','隆基氢能','阳光电源','国际能源网','微博搜索','微信搜索光伏'];
const wc = items.filter(it => wcNames.includes(it.source));
console.log('\nWechat source items:', wc.length);
if (wc.length > 0) {
    const wcSrc = {};
    wc.forEach(it => { wcSrc[it.source] = (wcSrc[it.source] || 0) + 1; });
    Object.entries(wcSrc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + v + ' x ' + k));
}

// Check date range
const dates = items.map(it => (it.pubDate || '').slice(0, 10)).filter(Boolean).sort();
console.log('\nDate range:', dates[0], 'to', dates[dates.length - 1]);
const today = new Date().toISOString().slice(0, 10);
const todayItems = items.filter(it => (it.pubDate || '').slice(0, 10) === today);
console.log('Today items:', todayItems.length);

// Sample 3 items
console.log('\n--- Sample items ---');
items.slice(0, 3).forEach((it, i) => {
    console.log('Item ' + (i+1) + ':');
    console.log('  title:', (it.title || '').slice(0, 60));
    console.log('  source:', it.source);
    console.log('  summary:', (it.summary || '').slice(0, 90));
    console.log('  tags:', (it.tags || []).join(', '));
    console.log('  pubDate:', it.pubDate);
});
"""
    sftp = ssh.open_sftp()
    with sftp.file('/var/www/pvhot/_verify_v303.js', 'w') as f:
        f.write(verify_script)
    sftp.close()

    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node _verify_v303.js 2>&1',
        timeout=30
    )
    print(stdout.read().decode())

    # 5. Cleanup
    ssh.exec_command('rm -f /var/www/pvhot/_verify_v303.js /var/www/pvhot/_verify2.js')

    # 6. Verify nginx
    print('=== Nginx API check ===')
    stdin, stdout, stderr = ssh.exec_command(
        'curl -s -o /dev/null -w "%{http_code}" https://pvhot.bbroot.com/api/ping 2>&1'
    )
    code = stdout.read().decode().strip()
    print(f'GET /api/ping -> HTTP {code}')
    if code in ('200', '400'):
        print('[OK] API endpoint reachable')
    else:
        print(f'[WARN] API returned {code} - check nginx config!')

    ssh.close()
    print('\n=== Deploy complete ===')

if __name__ == '__main__':
    main()
