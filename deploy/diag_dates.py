#!/usr/bin/env python3
"""Diagnose why wechat items are filtered out - check dates and source assignment"""
import paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=30)

    # Test individual freewechat routes and check item dates
    diag_script = r"""
const http = require('http');

const routes = [
  { route: '/freewechat/profile/MzAxNjU2NjAyNA==', name: '光伏們' },
  { route: '/freewechat/profile/MzI2NzIwMDg4NQ==', name: '光伏头条' },
  { route: '/freewechat/profile/MjM5MzgyMjY2MQ==', name: '索比光伏网' },
  { route: '/freewechat/profile/MjM5NTAyMTI1NQ==', name: '国际能源网' },
];

async function fetchRoute(route) {
  return new Promise((resolve) => {
    const url = 'http://127.0.0.1:1200' + route;
    http.get(url, { timeout: 70000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(''); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => buf += c);
      res.on('end', () => resolve(buf));
    }).on('error', e => { console.error('ERR:', e.message); resolve(''); });
  });
}

function parseDates(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const titleM = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const dateM = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const linkM = block.match(/<link>([\s\S]*?)<\/link>/);
    items.push({
      title: (titleM ? titleM[1] : '').trim().slice(0, 60),
      pubDate: dateM ? dateM[1].trim() : 'NONE',
      link: (linkM ? linkM[1] : '').trim().slice(0, 50),
    });
  }
  return items;
}

(async () => {
  for (const r of routes) {
    console.log('\n=== ' + r.name + ' ===');
    const xml = await fetchRoute(r.route);
    if (!xml) { console.log('  FAILED to fetch'); continue; }
    const items = parseDates(xml);
    console.log('  Items returned: ' + items.length);
    items.slice(0, 5).forEach((it, i) => {
      console.log('  [' + (i+1) + '] date=' + it.pubDate + ' | ' + it.title);
    });
    if (items.length > 5) console.log('  ... ' + (items.length - 5) + ' more');
    // Check date freshness
    const now = Date.now();
    const cutoff = now - 14 * 86400 * 1000;
    let fresh = 0, old = 0, noDate = 0;
    items.forEach(it => {
      const t = new Date(it.pubDate).getTime();
      if (isNaN(t)) noDate++;
      else if (t >= cutoff) fresh++;
      else old++;
    });
    console.log('  Freshness: ' + fresh + ' fresh, ' + old + ' old (>14d), ' + noDate + ' no date');
  }
  process.exit(0);
})();
"""

    sftp = ssh.open_sftp()
    with sftp.file('/var/www/pvhot/_diag_dates.js', 'w') as f:
        f.write(diag_script)
    sftp.close()

    print('=== Diagnosing freewechat item dates ===')
    stdin, stdout, stderr = ssh.exec_command(
        'cd /var/www/pvhot && /usr/bin/node _diag_dates.js 2>&1',
        timeout=120
    )
    stdout.channel.settimeout(120)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err:
        print('STDERR:', err[:500])

    ssh.exec_command('rm -f /var/www/pvhot/_diag_dates.js')
    ssh.close()

if __name__ == '__main__':
    main()
