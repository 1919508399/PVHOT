#!/usr/bin/env python3
"""Get fresh Sogou cookie and test WeChat search + try feeddd"""
import paramiko
import json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 1. Get fresh Sogou cookies by visiting weixin.sogou.com
print("=== Getting fresh Sogou cookies ===")
out, err = run('curl -s -D - -o /dev/null "https://weixin.sogou.com/" -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" 2>/dev/null | grep -i "set-cookie"')
print(f"Set-Cookie headers:\n{out}")

# Extract cookie values
cookie_parts = []
for line in out.split('\n'):
    if 'set-cookie' in line.lower():
        # Extract name=value before first ;
        val = line.split(':', 1)[1].strip().split(';')[0].strip()
        cookie_parts.append(val)

fresh_cookie = '; '.join(cookie_parts)
print(f"\nFresh cookie: {fresh_cookie}")

# 2. Test Sogou search with fresh cookie for specific accounts
print("\n=== Testing Sogou search with fresh cookie ===")
test_accounts = ['光伏們', '光伏头条', '隆基Longi', '晶科能源', 'TCL中环', '华晟新能源', '阳光电源', '通威股份', '天合光能', '索比光伏网']

for acc in test_accounts:
    # Use --cookie to send the fresh cookie
    cmd = f'curl -s "https://weixin.sogou.com/weixin?type=2&query={acc}&ie=utf8" -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" -H "Cookie: {fresh_cookie}" 2>/dev/null | grep -c "news-list"'
    out2, _ = run(cmd)
    has_results = out2.strip()
    print(f"  {acc}: news-list blocks = {has_results.strip() if has_results else '0'}")

# 3. Try feeddd (feed.hamibot.com) - check available feeds
print("\n=== Testing feeddd (feed.hamibot.com) ===")
out, err = run('curl -s "https://feed.hamibot.com/api/feeds" 2>/dev/null | head -200')
print(f"Feeddd API: {out[:500]}")

# 4. Try to search on feed.hamibot.com
out, err = run('curl -s "https://feed.hamibot.com/" -H "User-Agent: Mozilla/5.0" 2>/dev/null | head -100')
print(f"\nFeeddd homepage: {out[:300]}")

# 5. Try wechat2rss.xlab.app - check available feeds
print("\n=== Testing wechat2rss.xlab.app ===")
out, err = run('curl -s "https://wechat2rss.xlab.app/posts/list/" -H "User-Agent: Mozilla/5.0" 2>/dev/null | head -100')
print(f"Wechat2RSS: {out[:300]}")

# 6. Try freewechat.com with proper URL encoding
print("\n=== Testing freewechat.com with proper encoding ===")
out, err = run('python3 -c "import urllib.parse; print(urllib.parse.quote(\'光伏們\'))"')
encoded = out.strip()
if encoded:
    out2, err2 = run(f'curl -s -L "https://freewechat.com/search?q={encoded}" -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" 2>/dev/null | head -100')
    print(f"Freewechat search for 光伏們: {out2[:400]}")

ssh.close()
print("\n[Done]")
