#!/usr/bin/env python3
"""
Deploy updated fetch_pv_news.js with 24 RSSHub routes (21 freewechat + 1 weibo + 1 sogou + 1 general)
and run fetch + merge to verify.
"""
import paramiko
import time
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=15)

def run(cmd, timeout=120):
    print(f"  > {cmd[:100]}...")
    sys.stdout.flush()
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    stdout.channel.settimeout(timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

# 1. Upload updated fetch_pv_news.js
print("=" * 60)
print("STEP 1: Upload updated fetch_pv_news.js")
print("=" * 60)
sys.stdout.flush()

sftp = ssh.open_sftp()
sftp.put(r'C:\Users\HUASUN\Desktop\新闻\fetch_pv_news.js', '/var/www/pvhot/fetch_pv_news.js')
sftp.close()
print("  [OK] Uploaded fetch_pv_news.js")
sys.stdout.flush()

# 2. Verify the file was uploaded correctly
out, _ = run("grep -c 'freewechat/profile' /var/www/pvhot/fetch_pv_news.js")
print(f"  freewechat routes in file: {out.strip()}")
sys.stdout.flush()

# 3. Run fetch_pv_news.js
print("\n" + "=" * 60)
print("STEP 2: Run fetch_pv_news.js")
print("=" * 60)
sys.stdout.flush()

out, err = run("cd /var/www/pvhot && /usr/bin/node fetch_pv_news.js 2>&1", timeout=300)
print(out[-2000:] if len(out) > 2000 else out)
if err:
    print(f"  STDERR: {err[:500]}")
sys.stdout.flush()

# 4. Check data_raw.json
print("\n" + "=" * 60)
print("STEP 3: Check data_raw.json")
print("=" * 60)
sys.stdout.flush()

out, _ = run("cd /var/www/pvhot && node -e \"const d=require('./data_raw.json'); console.log('items:', d.items.length); const sources={}; d.items.forEach(it=>{const s=it.source||'unknown'; sources[s]=(sources[s]||0)+1;}); console.log('sources:', JSON.stringify(sources, null, 2));\"")
print(out)
sys.stdout.flush()

# 5. Run merge.js
print("\n" + "=" * 60)
print("STEP 4: Run merge.js")
print("=" * 60)
sys.stdout.flush()

out, err = run("cd /var/www/pvhot && /usr/bin/node merge.js 2>&1", timeout=60)
print(out[-500:] if len(out) > 500 else out)
sys.stdout.flush()

# 6. Verify data.json
print("\n" + "=" * 60)
print("STEP 5: Verify data.json")
print("=" * 60)
sys.stdout.flush()

out, _ = run("cd /var/www/pvhot && node -e \"const d=require('./data.json'); console.log('items:', d.items.length); const sources={}; d.items.forEach(it=>{const s=it.source||'unknown'; sources[s]=(sources[s]||0)+1;}); const sorted=Object.entries(sources).sort((a,b)=>b[1]-a[1]); console.log('top sources:'); sorted.slice(0,15).forEach(([k,v])=>console.log('  '+k+': '+v)); console.log('total sources:', sorted.length);\"")
print(out)
sys.stdout.flush()

# 7. Verify API
print("\n" + "=" * 60)
print("STEP 6: Verify API endpoint")
print("=" * 60)
sys.stdout.flush()

out, _ = run("curl -s 'https://pvhot.bbroot.com/api/items' | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('API items:', d.items.length);\"")
print(out)
sys.stdout.flush()

ssh.close()
print("\n[Done]")
